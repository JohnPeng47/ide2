import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { AgentContextLibrary } from '../../../../application/mapping/agent/agentContextLibrary';
import { AgentContextService } from '../../../../application/mapping/agent/agentContextService';
import { FileAgentContextRepository } from '../../../core/persistence/fileAgentContextRepository';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { QuickJsAgentRuntime } from '../execRuntime';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { DiagramGenerationRequest } from '../../../../domain/core/diagrams/diagramGeneration';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { DiagramRevisionReceiver } from '../../../../src/features/mapping/agent/diagramRevisionReceiver';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function library() {
  const root = await mkdtemp(path.join(tmpdir(), 'saved-agent-context-')); directories.push(root);
  return { root, library: new AgentContextLibrary(new FileAgentContextRepository(root)) };
}
it('persists immutable, discoverable context across restarts with concurrent retry safety', async () => {
  const f = await library(), other = new AgentContextLibrary(new FileAgentContextRepository(f.root));
  const input = { requestId: crypto.randomUUID(), name: 'Architecture', description: 'Codebase facts', context: 'Services communicate through events.' };
  const [a, b] = await Promise.all([f.library.create(input), other.create(input)]);
  expect(a).toEqual(b);
  expect(await other.list({ query: 'CODEBASE' })).toMatchObject({ items: [a], nextOffset: null });
  const saved = await other.read(a.agentContextId);
  expect(saved.snapshot.messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: input.context }] });
  expect(saved.contentHash).toBe(AgentContext.fromSnapshot(saved.snapshot).contentHash);
  await expect(other.create({ ...input, context: 'Different' })).rejects.toThrow('REQUEST_ID_CONFLICT');
  expect(await other.create(input)).toEqual(a);
  await other.create({ ...input, requestId: crypto.randomUUID(), name: 'Other' });
  const page = await other.list({ limit: 1 });
  expect(page.nextOffset).toBe(1);
  expect((await other.list({ offset: 1, limit: 1 })).items[0].agentContextId).not.toBe(page.items[0].agentContextId);
  expect((await readdir(path.join(f.root, 'agent-contexts'))).every(name => name.endsWith('.json'))).toBe(true);
  await expect(other.read('../../outside')).rejects.toThrow();
  await expect(other.read(`saved-agent-context-${crypto.randomUUID()}`)).rejects.toThrow('AGENT_CONTEXT_NOT_FOUND');
  const file = path.join(f.root, 'agent-contexts', `${a.agentContextId}.json`);
  const corrupt = JSON.parse(await readFile(file, 'utf8')); corrupt.snapshot.messages[0].content[0].text = 'tampered';
  await writeFile(file, JSON.stringify(corrupt));
  await expect(other.read(a.agentContextId)).rejects.toThrow();
});
it('validates supplied snapshots and keeps legacy uploads scoped while saved IDs are global', async () => {
  const f = await library();
  const snapshot = AgentContext.fromMessages('original-chat', [{ role: 'user', content: [{ type: 'text', text: 'Facts' }], timestamp: 0 }]).toSnapshot();
  const input = { requestId: crypto.randomUUID(), name: 'Snapshot', context: snapshot };
  const receipt = await f.library.create(input);
  expect((await f.library.read(receipt.agentContextId)).snapshot).toEqual(snapshot);
  await expect(f.library.create({ ...input, requestId: crypto.randomUUID(), context: { ...snapshot, contentHash: 'a'.repeat(64) } })).rejects.toThrow();
  const service = new AgentContextService(undefined, f.library);
  for (const scope of [{ workspaceInstanceId: 'a', documentId: 'one' }, { workspaceInstanceId: 'b', documentId: 'two' }])
    expect(await service.resolve(scope, receipt.agentContextId)).toEqual(snapshot);
  await expect(service.resolve({ workspaceInstanceId: 'a', documentId: 'one' }, 'agent-context-unknown')).rejects.toThrow('unavailable');
});
it('creates and reads through tools without a canvas, then reuses the ID in single and batched generation after restart', async () => {
  const f = await library();
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), initialCanvasState());
  const receiver = new DiagramRevisionReceiver();
  const dispatch = vi.fn(async (_id: string, command: any) => {
    if (command.method === 'identity' || command.method === 'snapshot') return { ...controller.getSnapshot(), name: 'Test' };
    if (command.method === 'create-diagrams') return receiver.batch('doc', { requestId: command.payload.requestId, expectedVersion: command.payload.expectedVersion, edits: [], creations: command.payload.diagrams }, controller, async () => {});
    if (command.method === 'apply-diagram-batch') return receiver.batch('doc', command.payload, controller, async () => {});
    throw Error(`Unexpected ${command.method}`);
  });
  const bridge: CanvasSessionPort = { dispatch, register() {}, list: () => [{ canvasId: 'canvas', documents: [{ documentId: 'doc', name: 'Test' }] }], poll: async () => [], reply() {}, unregister() {}, dispose() {} };
  const generate = vi.fn(async (_request: DiagramGenerationRequest) => ({ ascii: 'Generated', structureKind: 'tree' as const }));
  const makeService = () => new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime(), undefined, { generate }, new AgentContextService(undefined, new AgentContextLibrary(new FileAgentContextRepository(f.root))));
  const first = makeService();
  const input = { requestId: crypto.randomUUID(), name: 'Reusable', context: 'Facts shared across eval prompts' };
  const token = first.chatBindings.create(); first.chatBindings.bind(token, undefined, false);
  const receipt = await first.callBound(token, 'create-agent-context', input) as { agentContextId: string; contentHash: string };
  expect(dispatch).not.toHaveBeenCalled();
  first.chatBindings.bind(token, undefined, true);
  expect(await first.callBound(token, 'list-agent-contexts', {})).toMatchObject({ items: [receipt] });
  await expect(first.callBound(token, 'create-agent-context', input)).rejects.toThrow('READ_ONLY');
  first.chatBindings.clear(token);
  await expect(first.callBound(token, 'read-agent-context', { agentContextId: receipt.agentContextId })).rejects.toThrow('CHAT_BINDING_UNAVAILABLE');
  first.dispose();
  const service = makeService();
  try {
    const saved = await service.call('read-agent-context', { agentContextId: receipt.agentContextId }, true) as any;
    const attached = await service.call('exec', { requestId: 'attach', code: 'return canvas.attach({canvasId:"canvas", documentId:"doc"});' }) as any;
    const base = { nodeId: 'canvas', baseRevisionId: 'canvas', agentContextId: receipt.agentContextId, llmSessionId: 'different-composer-panel', prompt: 'Generate overview' };
    for (const batch of [false, true]) {
      const envelope = { sessionId: attached.value.sessionId, expectedVersion: controller.getSnapshot().version, requestId: crypto.randomUUID() };
      const run = await service.call('create-diagram', batch ? { ...envelope, operations: [base] } : { ...envelope, ...base }) as any;
      let complete: any;
      await vi.waitFor(async () => {
        complete = await service.call('edit-diagram-status', { runId: run.runId });
        expect(complete.error).toBeUndefined(); expect(complete.status).toBe('completed');
      });
      expect(batch ? complete.results[0] : complete).toMatchObject({ agentContextId: receipt.agentContextId, agentContextHash: receipt.contentHash });
      expect(generate.mock.calls.at(-1)![0]).toMatchObject({ agentContext: saved.snapshot, instruction: base.prompt });
    }
    expect(generate).toHaveBeenCalledTimes(2);
    await expect(service.call('create-diagram', { ...base, sessionId: attached.value.sessionId, expectedVersion: controller.getSnapshot().version, requestId: 'missing', agentContextId: `saved-agent-context-${crypto.randomUUID()}` })).rejects.toThrow('AGENT_CONTEXT_NOT_FOUND');
    expect(generate).toHaveBeenCalledTimes(2);
  } finally { service.dispose(); }
});
