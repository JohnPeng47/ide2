import { canvasMutationResult } from '../../../../domain/mapping/agent/mutationReceipt';
import { currentCanvasRead } from '../../../../domain/mapping/agent/currentCanvasRead';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { CanvasApiProjection } from '../../../../application/mapping/agent/apiProjection';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { LiveCanvasService } from '../../../../application/mapping/agent/liveCanvasService';
import { attachLiveCanvasSockets } from '../../../../src/server/routes/mapping/liveCanvasRoutes';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import { QuickJsAgentRuntime } from '../execRuntime';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { MappingDocumentController, type DiagramOperation } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import type { ApiDisplayNode } from '../../../../domain/mapping/agent/apiRepresentation';
import { ProjectCatalogStore } from '../../../core/persistence/projectCatalogStore';
import { canvasSaveFixture } from '../../../../tests/support/mappingDiagram';

function fixture(store = {} as DiagramRepository) {
  const scene = singleDiagramScene('Root\n|-- Same\n|   `-- Leaf\n`-- Same');
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 0,
    ascii: scene.contents.overview.content.ascii, structureKind: 'tree' }).diagram };
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
  const descriptors = [{ canvasId: 'canvas', documents: [{ documentId: 'doc', name: 'Test' }] }];
  const receipts = new Map<string, unknown>();
  let loseNextReply = false;
  const bridge: CanvasSessionPort = {
    register() {}, list: () => descriptors, poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_id, command) {
      if (command.method === 'read') return currentCanvasRead(controller.getSnapshot(), command.payload as any);
      if (command.method === 'snapshot' || command.method === 'identity') return { ...controller.getSnapshot(), name: 'Test' };
      const p = command.payload as { expectedVersion: number; operations: DiagramOperation[]; requestId: string; resultFormat?: string };
      const prior = receipts.get(p.requestId);
      if (prior) return prior;
      const applied = controller.transact(p.expectedVersion, p.operations);
      const result = p.resultFormat === 'receipt' ? canvasMutationResult(command.documentId!, p.operations, applied) : applied;
      receipts.set(p.requestId, result);
      if (loseNextReply) { loseNextReply = false; throw Error('CANVAS_TIMEOUT: lost reply'); }
      return result;
    }
  };
  const projection = new CanvasApiProjection();
  const agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, store,
    new QuickJsAgentRuntime(), undefined, undefined, undefined, projection);
  let request = 0;
  const call = (name: Parameters<typeof agent.call>[0], input: unknown) => agent.call(name, input) as Promise<any>;
  const attach = async () => (await call('exec', { requestId: `attach-${++request}`, code: 'return canvas.attach({canvasId:"canvas",documentId:"doc"});' })).value.sessionId as string;
  const exec = (sessionId: string, code: string, extra = {}) => call('exec', { mode: 'immediate', sessionId, requestId: `r${++request}`,
    expectedVersion: controller.getSnapshot().version, code, ...extra });
  return { controller, projection, agent, call, attach, exec, descriptors, loseReply: () => { loseNextReply = true; } };
}
const nodeCode = 'nodes.get({nodeId:"grid:overview"})';
const rootCode = 'Object.values(n.content.structure.nodes)[0]';
function assertCompact(nodes: ApiDisplayNode[]) {
  for (const node of nodes) {
    expect(node.apiFormatVersion).toBe(1);
    expect(node).not.toHaveProperty('contentNodes');
    expect(node).not.toHaveProperty('diagram.content');
  }
}

it('uses the same editable compact anchors through real WebSocket attach/refresh and exec reads/writes', async () => {
  const f = fixture(), sessionId = await f.attach();
  const live = new LiveCanvasService(() => f.descriptors, async () => ({ version: f.controller.getSnapshot().version, name: 'Test',
    nodes: f.controller.nodes(), edges: f.controller.getSnapshot().document.edges }), undefined, f.projection);
  const owner = {};
  live.publish(owner, 'canvas');
  live.update(owner, 'canvas', { documentId: 'doc', canvasEpoch: 'epoch', sequence: 0, documentVersion: 0, regions: [] });
  const server = createServer(), dispose = attachLiveCanvasSockets(server, live);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as { port: number }).port}/api/mapping/live`);
  const send = async (body: unknown) => { const result = once(ws, 'message'); ws.send(JSON.stringify(body)); return JSON.parse(String((await result)[0])); };
  try {
    await once(ws, 'open');
    const attached = await send({ type: 'attach', protocolVersion: 2, workspaceInstanceId: 'canvas', documentId: 'doc', includeContext: true });
    expect(attached.context.apiFormatVersion).toBe(1);
    assertCompact(attached.context.nodes);
    const node = attached.context.nodes.find((n: ApiDisplayNode) => n.id === 'grid:overview');
    const read = await f.exec(sessionId, `return ${nodeCode};`);
    expect(read.value).toEqual(node);
    const anchor = Object.values(node.content.structure.nodes)[0] as { id: string };
    const edge = (await f.exec(sessionId, `return edges.create({source:${JSON.stringify({ kind: 'content-node', displayNodeId: node.id,
      contentNodeId: anchor.id, revisionId: node.content.revisionId })},target:{kind:'box',displayNodeId:'grid:overview'},appearance:{}});`)).value;
    expect(edge.source.contentNodeId).toBe(anchor.id);
    expect(f.controller.getSnapshot().document.edges[0].source.contentNodeId).toBe(f.projection.resolveAnchorId(anchor.id));
    const refreshed = await send({ type: 'context.get', requestId: 'refresh' });
    expect(refreshed).toMatchObject({ type: 'context.snapshot', context: { version: 1, apiFormatVersion: 1, edges: [edge] } });
    assertCompact(refreshed.context.nodes);
    const result = await f.exec(sessionId, `const n=${nodeCode}; nodes.collapse({nodeId:n.id,contentNodeId:${rootCode}.id,collapsed:true}); return nodes.list();`);
    assertCompact(result.value.nodes); assertCompact(result.transaction.nodes);
    expect(f.controller.getSnapshot().canvas.diagramViews?.['grid:overview'].collapsedContentNodeIds).toContain(f.projection.resolveAnchorId(anchor.id));
    const search = await f.call('diagram-search', { operation: 'search', mode: 'node', sessionId, query: anchor.id });
    expect(search.hits).toHaveLength(1); expect(search.hits[0].contentNodeId).toBe(anchor.id);
    const liveRead = await f.call('diagram-search', { operation: 'read', sessionId, nodeId: node.id });
    assertCompact([liveRead.node]);
  } finally {
    ws.terminate(); dispose(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it('rejects stale/cross-diagram handles, accepts full IDs, preserves stale edge updates and restores handles on undo', async () => {
  const f = fixture(), session = await f.attach();
  const before = (await f.exec(session, `return ${nodeCode};`)).value;
  const anchor = Object.values(before.content.structure.nodes)[0] as { id: string };
  await f.exec(session, `const n=${nodeCode}; return nodes.setJumps({nodeId:n.id,jumps:[{id:'j',source:{revisionId:n.content.revisionId,contentHash:n.content.asciiSha256,line:1,startColumn:1,endColumn:4,contentNodeId:${rootCode}.id},target:{representationId:'elsewhere'}}]});`);
  const jumpRead = (await f.exec(session, `return ${nodeCode};`)).value;
  expect(jumpRead.diagram.jumps[0].source.contentNodeId).toBe(anchor.id);
  const rawId = f.projection.resolveAnchorId(anchor.id);
  expect(f.controller.getSnapshot().document.scene.contents.overview.jumps![0].source.contentNodeId).toBe(rawId);
  await f.exec(session, `nodes.collapse({nodeId:'grid:overview',contentNodeId:${JSON.stringify(rawId)},collapsed:true});`);
  const second = (await f.exec(session, "return nodes.draw({ascii:'Root\\n`-- Other',structureKind:'tree'});")).value;
  const bad = { kind: 'content-node', displayNodeId: second.id, contentNodeId: anchor.id, revisionId: second.content.revisionId };
  await expect(f.exec(session, `return edges.create({source:${JSON.stringify(bad)},target:{kind:'box',displayNodeId:'grid:overview'},appearance:{}});`)).rejects.toThrow('STALE_CONTENT_NODE');
  const edge = (await f.exec(session, `const n=${nodeCode}; return edges.create({source:{kind:'content-node',displayNodeId:n.id,contentNodeId:${rootCode}.id,revisionId:n.content.revisionId},target:{kind:'box',displayNodeId:n.id},appearance:{}});`)).value;
  await f.exec(session, "return nodes.replace({nodeId:'grid:overview',ascii:'New\\n`-- Leaf',structureKind:'tree'});");
  await expect(f.exec(session, `return nodes.collapse({nodeId:'grid:overview',contentNodeId:${JSON.stringify(anchor.id)},collapsed:true});`)).rejects.toThrow('STALE_CONTENT_NODE');
  await f.exec(session, `return edges.update({...${JSON.stringify(edge)},appearance:{label:'Stale endpoint retained'}});`);
  expect(f.controller.getSnapshot().document.edges[0].source.contentNodeId).toBe(rawId);
  f.controller.undo(); f.controller.undo();
  expect(Object.keys((await f.exec(session, `return ${nodeCode};`)).value.content.structure.nodes)).toEqual(Object.keys(before.content.structure.nodes));
  f.controller.undo(true);
  expect(Object.keys((await f.exec(session, `return ${nodeCode};`)).value.content.structure.nodes)).not.toContain(anchor.id);
});

it('replays compact read results and resolves identical anchors when a mutation acknowledgement is lost', async () => {
  const f = fixture(), session = await f.attach();
  f.loseReply();
  const input = { mode: 'immediate', requestId: 'retry-anchor', sessionId: session, expectedVersion: 0, code: `const n=${nodeCode}; const a=${rootCode};
    return edges.create({source:{kind:'content-node',displayNodeId:n.id,contentNodeId:a.id,revisionId:n.content.revisionId},target:{kind:'box',displayNodeId:n.id},appearance:{}});` };
  await expect(f.call('exec', input)).rejects.toThrow('CANVAS_TIMEOUT');
  const recovered = await f.call('exec', input);
  expect(await f.call('exec', input)).toEqual(recovered);
  expect(f.controller.getSnapshot().document.edges).toHaveLength(1);
  expect(f.controller.getSnapshot().version).toBe(1);
  assertCompact(recovered.transaction.nodes);
  const full = f.projection.resolveAnchorId(recovered.value.source.contentNodeId);
  expect(f.controller.getSnapshot().document.edges[0].source.contentNodeId).toBe(full);
});

it('projects top-level mutation responses and validates short jump targets against saved diagram revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compact-api-catalog-'));
  try {
    const catalog = new ProjectCatalogStore(root);
    const store = { loadProject: async () => ({ id: 'project' }), projectCatalogs: catalog } as unknown as DiagramRepository;
    const targetScene = singleDiagramScene('[Target]');
    const saved = await catalog.saveMappingDiagram('project', canvasSaveFixture({ name: 'Target', scene: targetScene }));
    const wrong = await catalog.saveMappingDiagram('project', canvasSaveFixture({ name: 'Other', scene: singleDiagramScene('[Other]') }));
    const f = fixture(store), session = await f.attach();
    const savedRead = await f.call('diagram-search', { operation: 'read', representationId: saved.representation.id });
    assertCompact(savedRead.nodes);
    const target = savedRead.nodes.find((node: ApiDisplayNode) => node.id === 'grid:overview');
    const targetId = Object.keys(target.content.structure.nodes)[0];
    const makeJump = (representationId: string) => `const n=${nodeCode}; return nodes.setJumps({nodeId:n.id,jumps:[{id:'jump',
      source:{revisionId:n.content.revisionId,contentHash:n.content.asciiSha256,line:1,startColumn:1,endColumn:4,contentNodeId:${rootCode}.id},
      target:{representationId:${JSON.stringify(representationId)},displayNodeId:'grid:overview',contentNodeId:${JSON.stringify(targetId)}}}]});`;
    await expect(f.exec(session, makeJump(wrong.representation.id))).rejects.toThrow('STALE_CONTENT_NODE');
    const jumped = await f.exec(session, makeJump(saved.representation.id));
    expect(jumped.value.diagram.jumps[0].target.contentNodeId).toBe(targetId);
    expect(f.controller.getSnapshot().document.scene.contents.overview.jumps![0].target.contentNodeId).toBe(f.projection.resolveAnchorId(targetId));
    const mappings = await f.call('set_diagram_source_mappings', { sessionId: session, requestId: 'mappings', expectedVersion: jumped.transaction.version,
      nodeId: 'grid:overview', mappings: [], evidence: {} });
    assertCompact(mappings.nodes);
    const drawn = await f.call('draw_diagram', { sessionId: session, requestId: 'draw', expectedVersion: mappings.version, ascii: '[Another]' });
    assertCompact(drawn.nodes);
    // Saved exports and persisted documents continue to use full canonical IDs.
    expect(await catalog.loadRepresentationCatalog('project')).toEqual(wrong.catalog);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('persists multiple colored node highlights, updates targets in place, and restores selective removal through history', async () => {
  const f = fixture(), session = await f.attach();
  const before = (await f.exec(session, `return ${nodeCode};`)).value;
  const anchors = Object.values(before.content.structure.nodes) as { id: string }[];
  const highlight = async (index: number, color?: string) => (await f.exec(session,
    `return nodes.highlight(${JSON.stringify({ nodeId: before.id, contentNodeId: anchors[index].id, color })});`)).value;
  await highlight(0, 'blue');
  let node = await highlight(1);
  expect(node.diagram.highlights.map((h: any) => h.color)).toEqual(['blue', 'yellow']);
  const first = node.diagram.highlights[0].id;
  node = await highlight(0, '#12abEF');
  expect(node.diagram.highlights.find((h: any) => h.id === first).color).toBe('#12abEF');
  expect(node.content).toEqual(before.content);
  expect(node.diagram.highlights).toHaveLength(2);
  const snapshot = f.controller.getSnapshot();
  const restored = new MappingDocumentController(snapshot.document, snapshot.canvas, snapshot.version, undefined, undefined, f.controller.exportHistory());
  expect(restored.nodes().find(n => n.layout === 'grid' && n.id === before.id)).toMatchObject({ diagram: { highlights: expect.arrayContaining([expect.objectContaining({ id: first })]) } });
  await f.exec(session, `return nodes.removeHighlights({nodeId:'grid:overview',highlightIds:[${JSON.stringify(first)}]});`);
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toHaveLength(1);
  f.controller.undo();
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toHaveLength(2);
  f.controller.undo(true);
  await f.exec(session, "return nodes.removeHighlights({nodeId:'grid:overview'});");
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual([]);
  await expect(highlight(0, 'expression(alert(1))')).rejects.toThrow();
  await expect(f.exec(session, "nodes.removeHighlights({nodeId:'grid:overview',highlightIds:['missing']});")).rejects.toThrow('Unknown highlight');
  const version = f.controller.getSnapshot().version;
  await expect(f.exec(session, "nodes.highlight({nodeId:'grid:overview'});", { expectedVersion: version - 1 })).rejects.toThrow('VERSION_CONFLICT');
  expect(f.controller.getSnapshot().version).toBe(version);
});

it('rebases untouched highlights on patches, retains stale targets without rendering them, and rejects stale handles', async () => {
  const f = fixture(), session = await f.attach();
  const node = (await f.exec(session, `return ${nodeCode};`)).value;
  const anchors = Object.values(node.content.structure.nodes) as { id: string; line: number }[];
  const first = anchors.find(n => n.line === 1)!, last = anchors.find(n => n.line === 4)!;
  await f.exec(session, `nodes.highlight({nodeId:'grid:overview',contentNodeId:${JSON.stringify(first.id)},color:'green'}); nodes.highlight({nodeId:'grid:overview',contentNodeId:${JSON.stringify(last.id)},color:'pink'});`);
  const old = f.controller.getSnapshot().document.diagramPresentations?.overview.highlights!;
  await f.exec(session, "nodes.patchDiagram({nodeId:'grid:overview',start:2,end:2,patch:'|-- Updated\\n|-- Inserted'});");
  const updated = (await f.exec(session, `return ${nodeCode};`)).value;
  expect(updated.diagram.highlights).toHaveLength(2);
  const lastHighlight = updated.diagram.highlights.find((h: any) => h.id === old[1].id);
  expect(updated.content.structure.nodes[lastHighlight.contentNodeId].line).toBe(5);
  await expect(f.exec(session, `nodes.highlight({nodeId:'grid:overview',contentNodeId:${JSON.stringify(first.id)}});`)).rejects.toThrow('STALE_CONTENT_NODE');
  await f.exec(session, "nodes.replace({nodeId:'grid:overview',ascii:'Entirely new'});");
  const currentNode = f.controller.nodes().find(n => n.layout === 'grid' && n.id === 'grid:overview')!;
  const diagram = currentNode.layout === 'grid' ? currentNode.diagram! : undefined!;
  const { activeDiagramHighlights } = await import('../../../../domain/core/diagrams/diagramHighlight');
  expect(diagram.highlights).toHaveLength(2);
  expect(activeDiagramHighlights(diagram.content, diagram.highlights)).toEqual([]);
  await f.exec(session, `nodes.removeHighlights({nodeId:'grid:overview',highlightIds:${JSON.stringify(old.map(h => h.id))}});`);
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual([]);
});

it('makes native chat highlight links from saved IDs, supports selected nodes, and retries without adding history', async () => {
  const f = fixture();
  const { ChatDiagramTools } = await import('../../../../application/mapping/agent-chat/chatDiagramTools');
  const { parseHighlightReference } = await import('../../../../domain/mapping/agent-chat/highlightReference');
  const diagram = f.controller.getSnapshot().document.scene.contents.overview;
  const { diagramContentNodes } = await import('../../../../domain/core/diagrams/diagramContentNodes');
  const ids = diagramContentNodes(diagram.content).slice(0, 2).map(n => n.id);
  const tools = new ChatDiagramTools(f.agent);
  const session = { id: 'chat', settings: { model: '', effort: '', sandbox: 'workspace-write' as const },
    canvasContext: { canvas: { workspaceInstanceId: 'canvas', documentId: 'doc' }, references: [{
      canvas: { workspaceInstanceId: 'canvas', documentId: 'doc' }, canvasName: 'Test', displayNodeId: 'grid:overview', ascii: diagram.content.ascii,
      reference: { kind: 'nodes' as const, label: 'Root', diagramId: diagram.diagramId, revisionId: diagram.revisionId,
        nodeIds: ids, range: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 20 } }
    }] } };
  const input = { reference: 1, color: 'purple', requestId: 'chat-highlight' };
  const result = await tools.call('highlight-node', input, session) as any;
  expect(result.highlights).toHaveLength(1);
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights![0].contentNodeIds).toEqual(ids);
  expect(parseHighlightReference(result.highlights[0].markdownUrl)).toEqual({ documentId: 'doc', nodeId: 'grid:overview', highlightId: result.highlights[0].id });
  const version = f.controller.getSnapshot().version;
  expect(await tools.call('highlight-node', input, session)).toEqual(result);
  expect(f.controller.getSnapshot().version).toBe(version);
  await expect(tools.call('highlight-node', { ...input, color: 'orange' }, session)).rejects.toThrow('REQUEST_ID_CONFLICT');
  await expect(tools.call('highlight-node', { ...input, requestId: 'read-only' }, { ...session, settings: { ...session.settings, sandbox: 'read-only' } })).rejects.toThrow('Workspace access');
  const explicit = await tools.call('highlight-node', { nodeId: 'grid:overview', contentNodeIds: [...ids].reverse(), color: 'green', requestId: 'explicit-group' }, session) as any;
  expect(explicit.highlights[0]).toMatchObject({ id: result.highlights[0].id, color: 'green' });
  const removed = await tools.call('remove-highlights', { nodeId: 'grid:overview', highlightIds: [result.highlights[0].id], requestId: 'remove-one' }, session) as any;
  expect(removed.highlights).toEqual([]);
  expect(f.controller.getSnapshot().document.diagramPresentations?.overview.highlights).toEqual([]);
});

it('updates presentation settings through compact node aliases without issuing content revisions', async () => {
  const f = fixture(), session = await f.attach();
  const before = f.controller.getSnapshot().document.scene.contents.overview.revisionId;
  await f.exec(session, `const n=${nodeCode}; const root=${rootCode}; return nodes.setPresentation({nodeId:n.id,settings:{
    markerRules:[{id:'review',marker:'!!'}], markerStyles:{review:{color:'blue',underline:true}},
    highlights:[{id:'annotation',color:'yellow',contentNodeId:root.id}]
  }});`);
  const state = f.controller.getSnapshot();
  expect(state.document.scene.contents.overview.revisionId).toBe(before);
  expect(state.document.diagramPresentations?.overview.highlights?.[0].nodeRefs).toHaveLength(1);
  expect(state.document.diagramPresentations?.overview.markerRules).toEqual([{ id: 'review', marker: '!!' }]);
  const read = await f.exec(session, `return ${nodeCode};`);
  expect(read.value.diagram.highlights).toContainEqual(expect.objectContaining({ id: 'annotation' }));
  f.controller.undo();
  expect(f.controller.getSnapshot().document.diagramPresentations).toBeUndefined();
});
