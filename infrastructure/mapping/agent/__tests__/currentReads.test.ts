import { expect, it, vi } from 'vitest';
import { CanvasReadAliases } from '../../../../application/mapping/agent/readAliases';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { CanvasSessionBridge } from '../canvasSessionBridge';
import { QuickJsAgentRuntime } from '../execRuntime';
import { currentCanvasRead } from '../../../../domain/mapping/agent/currentCanvasRead';
import { canvasReply } from '../../../../domain/mapping/agent/canvasReply';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';

it('keeps both current reads independent of a >100 MiB archive; small omits geometry and hashes', () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Service')), initialCanvasState());
  const state = controller.getSnapshot();
  const small = JSON.stringify(currentCanvasRead(state, { level: 'small' }));
  const full = JSON.stringify(currentCanvasRead(state, { level: 'full' }));
  const archive = { payload: 'x'.repeat(101 * 1024 * 1024) };
  expect(archive.payload.length).toBeGreaterThan(100 * 1024 * 1024);
  const heavy = { ...state, get history() { throw Error('Must not read archive'); }, archive };
  expect(JSON.stringify(currentCanvasRead(heavy, { level: 'small' }))).toBe(small);
  expect(JSON.stringify(currentCanvasRead(heavy, { level: 'full' }))).toBe(full);
  expect(small.length).toBeLessThan(5000);
  expect(small).not.toMatch(/geometry|asciiSha256|contentHash|history|archive/);
  expect(full).toContain('geometry'); expect(full).toContain('edges');
});

it('keeps immutable aliases, rejects wrong documents/expired reads, and preserves literal text', () => {
  const aliases = new CanvasReadAliases(1);
  const read = aliases.project({ nodeId: 'uuid', content: { ascii: 'uuid', nodes: { uuid: { id: 'uuid', label: 'uuid' } } } }, 'browser/doc');
  expect(read.nodeId).toMatch(/^@r.*\.node:1$/);
  expect(read.content.ascii).toBe('uuid');
  expect(aliases.resolve(read, 'browser/doc').nodeId).toBe('uuid');
  expect(() => aliases.resolve({ nodeId: read.nodeId }, 'other/doc')).toThrow('READ_BINDING_MISMATCH');
  const next = aliases.project({ nodeId: 'other' }, 'browser/doc');
  expect(next.nodeId).not.toBe(read.nodeId);
  expect(() => aliases.resolve({ nodeId: read.nodeId }, 'browser/doc')).toThrow('STALE_READ');
});

it('measures full UTF8 reply and settles oversized commands without waiting for timeout', async () => {
  const bridge = new CanvasSessionBridge(); bridge.register({ canvasId: 'browser', documents: [] });
  const pending = bridge.dispatch('browser', { method: 'snapshot' });
  const [command] = await bridge.poll('browser');
  const value = 'é'.repeat(100);
  const reply = canvasReply(command, { value }, 100);
  expect(reply.bytes).toBe(Buffer.byteLength(JSON.stringify({ commandId: command.id, value })));
  expect(reply.oversized).toBe(true);
  bridge.reply('browser', command.id, JSON.parse(reply.body));
  await expect(pending).rejects.toThrow(/CANVAS_REPLY_TOO_LARGE.*actualBytes=.*limitBytes=100/);
  bridge.dispose();
});

function liveFixture() {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Service')), initialCanvasState());
  const commands: string[] = [];
  const receipts = new Map<string, unknown>();
  const bridge: CanvasSessionPort = {
    register() {}, unregister() {}, dispose() {}, poll: async () => [], reply() {},
    list: () => [{ canvasId: 'browser', documents: [{ documentId: 'doc', name: 'Canvas' }, { documentId: 'other', name: 'Other' }] }],
    async dispatch(_canvas, command) {
      commands.push(command.method);
      if (command.method === 'identity') return { version: controller.getSnapshot().version, documentId: command.documentId };
      if (command.method === 'read') return { documentId: command.documentId, ...currentCanvasRead(controller.getSnapshot(), command.payload as any) };
      if (command.method === 'apply') {
        const input = command.payload as any;
        if (!receipts.has(input.requestId)) receipts.set(input.requestId, controller.applyUpdate(input.expectedVersion, input.operations));
        return receipts.get(input.requestId);
      }
      throw Error(`Unexpected archive/snapshot read: ${command.method}`);
    }
  };
  const agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  return { controller, agent, bridge, commands };
}

it('uses small read aliases for highlight and move, checks stale versions, and retries without duplicating mutations', async () => {
  const { agent, controller, commands } = liveFixture();
  const token = agent.chatBindings.create(); agent.chatBindings.bind(token, { workspaceInstanceId: 'browser', documentId: 'doc' }, false);
  const read = await agent.callBound(token, 'exec', { requestId: 'read', code: 'return canvas.read({});' }) as any;
  const node = read.value.nodes[0], anchor = Object.values(node.content.structure.nodes)[0] as any;
  const input = { requestId: 'highlight', expectedVersion: read.value.version, code: `return nodes.highlight(${JSON.stringify({ nodeId: node.id, contentNodeId: anchor.id, color: 'blue' })});` };
  const result = await agent.callBound(token, 'exec', input);
  expect(await agent.callBound(token, 'exec', input)).toEqual(result);
  expect(controller.getSnapshot().version).toBe(1);
  expect(controller.getSnapshot().document.scene.contents.overview.highlights).toHaveLength(1);
  await expect(agent.callBound(token, 'exec', { ...input, requestId: 'stale' })).rejects.toThrow('VERSION_CONFLICT');
  await agent.callBound(token, 'exec', { requestId: 'move', expectedVersion: 1, code: `return nodes.move({nodeId:${JSON.stringify(node.id)},position:{column:5,row:2}});` });
  expect(commands).not.toContain('snapshot');
  agent.chatBindings.bind(token, { workspaceInstanceId: 'browser', documentId: 'other' }, false);
  await expect(agent.callBound(token, 'exec', { ...input, requestId: 'wrong', expectedVersion: 2 })).rejects.toThrow('READ_BINDING_MISMATCH');
  agent.chatBindings.clear(token);
  await expect(agent.callBound(token, 'exec', { requestId: 'inactive', code: 'return canvas.read({});' })).rejects.toThrow('CHAT_BINDING_UNAVAILABLE');
});

it('captures a binding before awaits and enforces read-only access inside exec', async () => {
  const { agent, bridge } = liveFixture();
  const original = bridge.dispatch.bind(bridge);
  let release!: () => void;
  const delay = new Promise<void>(resolve => { release = resolve; });
  bridge.dispatch = vi.fn(async (canvas, command) => { if (command.method === 'identity') await delay; return original(canvas, command); });
  const token = agent.chatBindings.create(); agent.chatBindings.bind(token, { workspaceInstanceId: 'browser', documentId: 'doc' }, true);
  const pending = agent.callBound(token, 'exec', { requestId: 'read', code: 'return canvas.read({});' });
  agent.chatBindings.bind(token, { workspaceInstanceId: 'browser', documentId: 'other' }, false);
  release(); const result = await pending as any;
  expect(result.value.documentId).toMatch(/^@r/);
  expect(vi.mocked(bridge.dispatch).mock.calls.filter(([, c]) => c.method === 'read').map(([, c]) => c.documentId)).toEqual(['doc']);
  agent.chatBindings.bind(token, { workspaceInstanceId: 'browser', documentId: 'doc' }, true);
  await expect(agent.callBound(token, 'exec', { requestId: 'write', expectedVersion: 0, code: 'return nodes.remove({nodeId:"grid:overview"});' })).rejects.toThrow('READ_ONLY');
});
