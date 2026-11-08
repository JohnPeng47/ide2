import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { sha256 } from '../../../../domain/core/sha256';
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
it('updates group metadata across restarts without changing legacy context content or creation receipts', async () => {
  const f = await library();
  const input = { requestId: crypto.randomUUID(), name: 'Legacy', context: 'Original evidence' };
  const created = await f.library.create(input);
  const file = path.join(f.root, 'agent-contexts', `${created.agentContextId}.json`);
  const before = JSON.parse(await readFile(file, 'utf8'));
  expect(before.requestHash).toBe(sha256(JSON.stringify([input.name, '', created.contentHash])));
  expect(before).not.toHaveProperty('group');
  await f.library.update({ agentContextId: created.agentContextId, group: ' YC Demo Group ' });
  const restarted = new AgentContextLibrary(new FileAgentContextRepository(f.root));
  expect(await restarted.read(created.agentContextId)).toMatchObject({ group: 'YC Demo Group', contentHash: created.contentHash, snapshot: before.snapshot });
  expect((await restarted.list()).items).toEqual([{ ...created, group: 'YC Demo Group' }]);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ...before, group: 'YC Demo Group' });
  expect(await restarted.create(input)).toEqual({ ...created, group: 'YC Demo Group' });
  await expect(restarted.update({ agentContextId: created.agentContextId, group: ' ' })).rejects.toThrow();
  await expect(restarted.update({ agentContextId: `saved-agent-context-${crypto.randomUUID()}`, group: 'Demo' })).rejects.toThrow('AGENT_CONTEXT_NOT_FOUND');
  await restarted.update({ agentContextId: created.agentContextId, group: null });
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(before);
});
it.each(['plain text', [{ type: 'text', text: 'constituent text' }]])('includes initial group in creation retry identity for %j', async context => {
  const f = await library();
  const input = { requestId: crypto.randomUUID(), name: 'Grouped', group: 'YC Demo Group', context };
  const receipt = await f.library.create(input);
  expect(receipt.group).toBe('YC Demo Group');
  expect(await f.library.create(input)).toEqual(receipt);
  await expect(f.library.create({ ...input, group: 'Other' })).rejects.toThrow('REQUEST_ID_CONFLICT');
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
  const input = { requestId: crypto.randomUUID(), name: 'Reusable', context: [{ type: 'section', name: 'Shared facts', content: [{ type: 'text', text: 'Facts shared across eval prompts' }] }] };
  const token = first.chatBindings.create(); first.chatBindings.bind(token, undefined, false);
  const receipt = await first.callBound(token, 'create-agent-context', input) as { agentContextId: string; contentHash: string };
  const metadata = { agentContextId: receipt.agentContextId, group: 'YC Demo Group' };
  expect(await first.callBound(token, 'update-agent-context', metadata)).toMatchObject({ ...receipt, group: metadata.group });
  expect(dispatch).not.toHaveBeenCalled();
  first.chatBindings.bind(token, undefined, true);
  expect(await first.callBound(token, 'list-agent-contexts', {})).toMatchObject({ items: [receipt] });
  await expect(first.callBound(token, 'create-agent-context', input)).rejects.toThrow('READ_ONLY');
  await expect(first.callBound(token, 'update-agent-context', metadata)).rejects.toThrow('READ_ONLY');
  const forkInput = { requestId: crypto.randomUUID(), agentContextId: receipt.agentContextId, expectedContentHash: receipt.contentHash, name: 'Tool fork' };
  await expect(first.callBound(token, 'fork-agent-context', forkInput)).rejects.toThrow('READ_ONLY');
  const commentInput = { requestId: crypto.randomUUID(), agentContextId: receipt.agentContextId, expectedContentHash: receipt.contentHash, text: 'Reviewed the evidence.' };
  await expect(first.callBound(token, 'add-agent-context-comment', commentInput)).rejects.toThrow('READ_ONLY');
  expect(await first.callBound(token, 'read-agent-context-lineage', { agentContextId: receipt.agentContextId })).toMatchObject({ items: [receipt] });
  first.chatBindings.bind(token, undefined, false);
  const fork = await first.callBound(token, 'fork-agent-context', forkInput) as { agentContextId: string };
  expect(await first.callBound(token, 'add-agent-context-comment', { ...commentInput, agentContextId: fork.agentContextId })).toMatchObject({ comments: [{ text: commentInput.text }] });
  first.chatBindings.bind(token, undefined, true);
  expect(await first.callBound(token, 'read-agent-context-lineage', { agentContextId: fork.agentContextId })).toMatchObject({ items: [receipt, { ...fork, parentMatches: true }] });
  expect(dispatch).not.toHaveBeenCalled();
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

it('forks pinned context with ancestry, survives disk edits, and traces parent drift across restarts', async () => {
  const f = await library();
  const parent = await f.library.create({ requestId: crypto.randomUUID(), name: 'Original', group: 'Corpus', description: 'Evidence', context: 'Original facts' });
  await f.library.addComment({ agentContextId: parent.agentContextId, expectedContentHash: parent.contentHash, requestId: crypto.randomUUID(), text: 'Original review.' });
  const parentPath = path.join(f.root, 'agent-contexts', `${parent.agentContextId}.json`);
  const parentBytes = await readFile(parentPath, 'utf8');
  const input = { requestId: crypto.randomUUID(), agentContextId: parent.agentContextId, expectedContentHash: parent.contentHash, name: 'Focused fork' };
  const fork = await f.library.fork(input);
  expect(fork).toMatchObject({ group: 'Corpus', description: 'Evidence', contentHash: parent.contentHash,
    lineage: { parentAgentContextId: parent.agentContextId, parentContentHash: parent.contentHash } });
  expect(fork).not.toHaveProperty('comments');
  expect(await readFile(parentPath, 'utf8')).toBe(parentBytes);
  const original = await f.library.read(parent.agentContextId);
  const editPath = path.join(f.root, 'agent-contexts', `${fork.agentContextId}.json`);
  const edited = JSON.parse(await readFile(editPath, 'utf8'));
  edited.snapshot = AgentContext.fromSnapshot(edited.snapshot).withMessages([{ role: 'user', timestamp: 0, content: [{ type: 'text', text: 'Selected facts' }] }]).toSnapshot();
  await writeFile(editPath, JSON.stringify(edited));
  const restarted = new AgentContextLibrary(new FileAgentContextRepository(f.root));
  expect((await restarted.read(fork.agentContextId)).snapshot.messages[0].content).toEqual([{ type: 'text', text: 'Selected facts' }]);
  expect((await restarted.fork(input)).contentHash).toBe(edited.snapshot.contentHash);
  await expect(restarted.fork({ ...input, name: 'Conflicting retry' })).rejects.toThrow('REQUEST_ID_CONFLICT');
  await expect(restarted.fork({ ...input, requestId: crypto.randomUUID(), expectedContentHash: 'a'.repeat(64) })).rejects.toThrow('AGENT_CONTEXT_CHANGED');
  const child = await restarted.fork({ requestId: crypto.randomUUID(), agentContextId: fork.agentContextId, expectedContentHash: edited.snapshot.contentHash, name: 'Child', group: null });
  expect(child).not.toHaveProperty('group');
  expect((await restarted.lineage({ agentContextId: child.agentContextId })).items.map(i => i.agentContextId)).toEqual([parent.agentContextId, fork.agentContextId, child.agentContextId]);
  expect((await restarted.lineage({ agentContextId: child.agentContextId })).items.slice(1).every(i => i.parentMatches)).toBe(true);
  expect(await readFile(parentPath, 'utf8')).toBe(parentBytes);
  // A later external parent edit does not silently rewrite its child's fork point.
  const changedParent = JSON.parse(parentBytes);
  changedParent.snapshot = AgentContext.fromSnapshot(original.snapshot).withMessages(edited.snapshot.messages).toSnapshot();
  await writeFile(parentPath, JSON.stringify(changedParent));
  const lineage = await restarted.lineage({ agentContextId: child.agentContextId });
  expect(lineage.items[1]).toMatchObject({ parentMatches: false, lineage: { parentContentHash: parent.contentHash } });
  expect(lineage.items[2].parentMatches).toBe(true);
  expect((await restarted.fork(input)).agentContextId).toBe(fork.agentContextId);
});

it('appends idempotent hash-bound comments concurrently without losing comments or group metadata', async () => {
  const f = await library(), other = new AgentContextLibrary(new FileAgentContextRepository(f.root));
  const context = await f.library.create({ requestId: crypto.randomUUID(), name: 'Commented', context: 'Evidence' });
  const before = (await f.library.read(context.agentContextId)).snapshot;
  const input = { agentContextId: context.agentContextId, expectedContentHash: context.contentHash, requestId: crypto.randomUUID(), text: 'Removed duplicate evidence to focus the sample.' };
  await Promise.all([f.library.addComment(input), other.addComment(input),
    other.addComment({ ...input, requestId: crypto.randomUUID(), text: 'Verified the retained source ranges.' }),
    f.library.update({ agentContextId: context.agentContextId, group: 'Reviewed' })]);
  const saved = await other.read(context.agentContextId);
  expect(saved).toMatchObject({ group: 'Reviewed', contentHash: context.contentHash, snapshot: before });
  expect(saved.comments).toHaveLength(2);
  expect(saved.comments![0]).toMatchObject({ contentHash: context.contentHash });
  expect((await other.list({ query: 'Commented' })).items[0].comments).toEqual(saved.comments);
  await expect(other.addComment({ ...input, text: 'Different comment' })).rejects.toThrow('REQUEST_ID_CONFLICT');
  await expect(other.addComment({ ...input, requestId: crypto.randomUUID(), expectedContentHash: 'a'.repeat(64) })).rejects.toThrow('AGENT_CONTEXT_CHANGED');
  expect((await other.read(context.agentContextId)).comments).toEqual(saved.comments);
});

it('reports missing and cyclic lineage explicitly', async () => {
  const f = await library();
  const parent = await f.library.create({ requestId: crypto.randomUUID(), name: 'Root', context: 'Facts' });
  const fork = await f.library.fork({ requestId: crypto.randomUUID(), agentContextId: parent.agentContextId, expectedContentHash: parent.contentHash, name: 'Fork' });
  const file = path.join(f.root, 'agent-contexts', `${parent.agentContextId}.json`);
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.lineage = { parentAgentContextId: fork.agentContextId, parentContentHash: fork.contentHash };
  await writeFile(file, JSON.stringify(record));
  await expect(f.library.lineage({ agentContextId: fork.agentContextId })).rejects.toThrow('cyclic');
  await rm(file);
  await expect(f.library.lineage({ agentContextId: fork.agentContextId })).rejects.toThrow('ancestor is unavailable');
});
