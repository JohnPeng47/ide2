import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { canvasMutationResult, type CanvasMutationResult } from '../../../../domain/mapping/agent/mutationReceipt';
import { parseHighlightReference } from '../../../../domain/mapping/agent-chat/highlightReference';
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
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Service\n[A] Alpha\n[B] Beta\n[C] Gamma')), initialCanvasState());
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
  const ascii = 'Service\n|-- [A] Alpha\n|-- [B] Beta\n`-- [C] Gamma';
  const scene = singleDiagramScene(ascii);
  scene.contents = { ...scene.contents, overview: revisionFixture().create({id:'overview', revision:0, ascii, structureKind:'tree'}).diagram };
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
  const commands: string[] = [];
  const receipts = new Map<string, unknown>();
  let loseReply = false;
  const batches: any[] = [];
  const bridge: CanvasSessionPort = {
    register() {}, unregister() {}, dispose() {}, poll: async () => [], reply() {},
    list: () => [{ canvasId: 'browser', documents: [{ documentId: 'doc', name: 'Canvas' }, { documentId: 'other', name: 'Other' }] }],
    async dispatch(_canvas, command) {
      commands.push(command.method);
      if (command.method === 'snapshot') return { ...controller.getSnapshot(), documentId: command.documentId };
      if (command.method === 'identity') return { version: controller.getSnapshot().version, documentId: command.documentId };
      if (command.method === 'read') return { documentId: command.documentId, ...currentCanvasRead(controller.getSnapshot(), command.payload as any) };
      if (command.method === 'apply') {
        const input = command.payload as any;
        batches.push(structuredClone(input));
        if (!receipts.has(input.requestId)) {
          const result = controller.applyUpdate(input.expectedVersion, input.operations);
          receipts.set(input.requestId, input.resultFormat === 'receipt' ? canvasMutationResult(command.documentId!, input.operations, result) : result);
          if (loseReply) { loseReply = false; throw Error('CANVAS_TIMEOUT: lost acknowledgement'); }
        }
        return receipts.get(input.requestId);
      }
      throw Error(`Unexpected archive/snapshot read: ${command.method}`);
    }
  };
  const agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  return { controller, agent, bridge, commands, batches, loseReply: () => { loseReply = true; } };
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
  expect(controller.getSnapshot().document.diagramPresentations?.overview.highlights).toHaveLength(1);
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

async function boundFixture() {
  const f = liveFixture();
  const token = f.agent.chatBindings.create();
  f.agent.chatBindings.bind(token, { workspaceInstanceId: 'browser', documentId: 'doc' }, false);
  let serial = 0;
  const exec = (code: string, extra = {}) => f.agent.callBound(token, 'exec', { requestId: `batch-${++serial}`,
    expectedVersion: f.controller.getSnapshot().version, code, ...extra }) as Promise<{ value: any; transaction: CanvasMutationResult }>;
  const read = await exec('return canvas.read({});');
  const node = read.value.nodes[0];
  const targets = Object.values(node.content.structure.nodes).slice(0, 3).map((anchor: any) => ({ nodeId: node.id, contentNodeId: anchor.id, color: 'blue' }));
  const code = `for (const target of ${JSON.stringify(targets)}) nodes.highlight(target);`;
  return { ...f, exec, targets, code };
}

it('batches ordinary highlight calls into one commit with compact links, one undo, and no snapshot read', async () => {
  const f = await boundFixture();
  const result = await f.exec(f.code);
  expect(f.batches).toHaveLength(1);
  expect(f.batches[0].operations).toHaveLength(3);
  expect(result.transaction).toMatchObject({ version: 1, receipts: Array.from({ length: 3 }, () => ({ method: 'highlight', nodeId: 'grid:overview', color: 'blue', status: 'active' })) });
  const highlights = f.controller.getSnapshot().document.diagramPresentations?.overview.highlights!;
  expect(result.transaction.receipts.map(receipt => parseHighlightReference(receipt.markdownUrl!)))
    .toEqual(highlights.map(h => ({ documentId: 'doc', nodeId: 'grid:overview', highlightId: h.id })));
  expect(JSON.stringify(result).length).toBeLessThan(4096);
  expect(result.transaction).not.toHaveProperty('nodes');
  expect(f.commands).not.toContain('snapshot');
  const updated = await f.exec(f.code.replaceAll('blue', 'pink'));
  expect(updated.transaction.receipts.map(r => r.highlightId)).toEqual(highlights.map(h => h.id));
  f.controller.undo();
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual(highlights);
  f.controller.undo();
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights ?? []).toEqual([]);
});

it('discards pending edits on script errors and rejects an invalid batch without committing valid siblings', async () => {
  const f = await boundFixture(), before = f.controller.getSnapshot();
  await expect(f.exec(`${f.code} throw Error('stop');`)).rejects.toThrow('stop');
  expect(f.batches).toHaveLength(0);
  expect(f.controller.getSnapshot()).toBe(before);
  await expect(f.exec(`${f.code} nodes.highlight({nodeId:'grid:missing'});`)).rejects.toThrow('diagram GridBox');
  expect(f.controller.getSnapshot()).toBe(before);
  await expect(f.exec(`${f.code} nodes.highlight({nodeId:'grid:overview',color:'invalid'});`)).rejects.toThrow();
  expect(f.controller.getSnapshot()).toBe(before);
});

it('flushes before reads and preserves already committed batches after a later failure', async () => {
  const f = await boundFixture();
  const result = await f.exec(`${f.code} const read=canvas.read({}); nodes.highlight({nodeId:'grid:overview'}); return read.version;`);
  expect(result.value).toBe(1);
  expect(f.batches.map(batch => batch.operations.length)).toEqual([3, 1]);
  expect(result.transaction.version).toBe(2);
  expect(result.transaction.receipts).toHaveLength(4);
  await expect(f.exec(`nodes.removeHighlights({nodeId:'grid:overview'}); canvas.read({}); nodes.highlight({nodeId:'grid:missing'});`)).rejects.toThrow();
  expect(f.controller.getSnapshot().version).toBe(3);
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual([]);
});

it('retries a lost batch reply with identical IDs and version, including a caught timeout', async () => {
  const f = await boundFixture(); f.loseReply();
  const input = { requestId: 'lost', expectedVersion: 0 };
  const code = `${f.code} try { canvas.read({}); } catch(e) {} return 'done';`;
  await expect(f.exec(code, input)).rejects.toThrow('CANVAS_TIMEOUT');
  expect(f.controller.getSnapshot().version).toBe(1);
  await expect(f.exec(code + ' nodes.highlight({nodeId:"grid:overview"});', input)).rejects.toThrow('REQUEST_ID_CONFLICT');
  const recovered = await f.exec(code, input);
  expect(f.batches).toHaveLength(2);
  expect(f.batches[0]).toEqual(f.batches[1]);
  expect(recovered.transaction.receipts).toHaveLength(3);
  expect(f.controller.getSnapshot().version).toBe(1);
  expect(await f.exec(code, input)).toEqual(recovered);
  expect(f.batches).toHaveLength(2);
});

it('supports dependent writes with queued IDs and reads their committed state', async () => {
  const f = await boundFixture();
  const result = await f.exec(`const node=nodes.draw({ascii:'New'}); nodes.move({nodeId:node.id,position:{column:40,row:0}}); return nodes.get({nodeId:node.id});`);
  expect(f.batches.map(batch => batch.operations.length)).toEqual([2]);
  expect(result.value.content.ascii).toBe('New');
  expect(result.transaction.version).toBe(1);
});

it('rejects a concurrent edit at the batch boundary without applying any queued operations', async () => {
  const f = await boundFixture();
  const original = f.bridge.dispatch.bind(f.bridge);
  f.bridge.dispatch = async (canvas, command) => {
    if (command.method === 'apply') f.controller.applyUpdate(f.controller.getSnapshot().version,
      [{method:'highlight',nodeId:'grid:overview',highlightId:'user-highlight',color:'green'}]);
    return original(canvas, command);
  };
  await expect(f.exec(f.code)).rejects.toThrow('VERSION_CONFLICT');
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual([{id:'user-highlight',color:'green'}]);
});

it('keeps saved highlight links when later operations rebase anchors in the same batch', async () => {
  const f = await boundFixture();
  const first = await f.exec(f.code);
  const patch = {nodeId:'grid:overview', start:4, end:4, patch:'|-- Added\n`-- [C] Gamma'};
  const result = await f.exec(`${f.code} nodes.patchDiagram(${JSON.stringify(patch)});`);
  expect(result.transaction.receipts.slice(0,3).map(r => r.highlightId)).toEqual(first.transaction.receipts.map(r => r.highlightId));
  expect(result.transaction.receipts.slice(0,3).every(r => r.markdownUrl && r.status === 'active')).toBe(true);
});

it('saves an explicit node set as one highlight, reuses its ID regardless of order, and removes it as a group', async () => {
  const f = await boundFixture();
  const target = { nodeId: f.targets[0].nodeId, contentNodeIds: f.targets.map(t => t.contentNodeId), color: 'blue' };
  const result = await f.exec(`nodes.highlight(${JSON.stringify(target)});`);
  const saved = f.controller.getSnapshot().document.diagramPresentations?.overview.highlights!;
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ color: 'blue', contentNodeIds: f.batches[0].operations[0].contentNodeIds });
  expect(saved[0].contentNodeIds).toHaveLength(3);
  expect(result.transaction.receipts).toEqual([{ method: 'highlight', nodeId: 'grid:overview', highlightId: saved[0].id,
    color: 'blue', status: 'active', markdownUrl: `highlight:doc/grid%3Aoverview/${saved[0].id}` }]);
  expect(f.batches[0].operations).toHaveLength(1);
  const updated = await f.exec(`nodes.highlight(${JSON.stringify({ ...target, contentNodeIds: [...target.contentNodeIds].reverse(), color: 'pink' })});`);
  expect(updated.transaction.receipts[0].highlightId).toBe(saved[0].id);
  const read = await f.exec('return canvas.read({});');
  const group = read.value.nodes[0].diagram.highlights[0];
  expect(group.contentNodeIds).toHaveLength(3);
  expect(group.contentNodeIds.every((id: string) => read.value.nodes[0].content.structure.nodes[id])).toBe(true);
  const fromRead = await f.exec(`nodes.highlight(${JSON.stringify({ nodeId: read.value.nodes[0].id, contentNodeIds: group.contentNodeIds, color: 'green' })});`);
  expect(fromRead.transaction.receipts[0].highlightId).toBe(saved[0].id);
  await f.exec(`nodes.removeHighlights({nodeId:'grid:overview',highlightIds:['${saved[0].id}']});`);
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual([]);
  f.controller.undo();
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toHaveLength(1);
});

it('rejects empty, duplicate, ambiguous, and stale highlight groups without saving any targets', async () => {
  const f = await boundFixture(), before = f.controller.getSnapshot();
  for (const fields of [
    { contentNodeIds: [] },
    { contentNodeIds: [f.targets[0].contentNodeId, f.targets[0].contentNodeId] },
    { contentNodeId: f.targets[0].contentNodeId, contentNodeIds: [f.targets[1].contentNodeId] },
    { contentNodeIds: [f.targets[0].contentNodeId, 'missing'] }
  ]) {
    await expect(f.exec(`nodes.highlight(${JSON.stringify({ nodeId: f.targets[0].nodeId, ...fields })});`)).rejects.toThrow();
    expect(f.controller.getSnapshot()).toBe(before);
  }
});

it('rebases group members together and marks the whole saved highlight stale when a member changes', async () => {
  const f = await boundFixture();
  const result = await f.exec(`nodes.highlight(${JSON.stringify({ nodeId: f.targets[0].nodeId, contentNodeIds: f.targets.map(t => t.contentNodeId) })});`);
  const id = result.transaction.receipts[0].highlightId;
  await f.exec(`nodes.patchDiagram({nodeId:'grid:overview',start:4,end:4,patch:'|-- Added\\n\x60-- [C] Gamma'});`);
  const read = await f.exec('return canvas.read({});');
  expect(read.value.nodes[0].diagram.highlights).toHaveLength(1);
  expect(read.value.nodes[0].diagram.highlights[0]).toMatchObject({ status: 'active' });
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights![0].id).toBe(id);
  await f.exec(`nodes.patchDiagram({nodeId:'grid:overview',start:2,end:2,patch:'|-- Changed'});`);
  const stale = await f.exec('return canvas.read({});');
  expect(stale.value.nodes[0].diagram.highlights[0]).toMatchObject({ status: 'stale' });
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights![0]).toMatchObject({ id, contentNodeIds: expect.any(Array) });
});
