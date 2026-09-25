import { createDiagram } from '../../../../domain/core/diagrams/diagram';
import { defaultArrowAppearance } from '../../../../domain/core/diagrams/diagramConnection';
import { expect, it } from 'vitest';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import { QuickJsAgentRuntime } from '../execRuntime';
import { MappingDocumentController, type DiagramOperation } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';

it('uses one committed version for staged results, live reads, undo, and request deduplication', async () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('[Original]')), initialCanvasState(), 7);
  const bridge: CanvasSessionPort = {
    register() {}, list: () => [{canvasId:'canvas',documents:[{documentId:'doc',name:'Test'}]}], poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_canvasId, command) {
      if (command.method === 'snapshot') return {...controller.getSnapshot(),name:'Test'};
      if (command.method === 'apply') { const payload = command.payload as {expectedVersion:number;operations:DiagramOperation[]}; return controller.transact(payload.expectedVersion,payload.operations); }
      throw new Error('Unexpected command');
    }
  };
  const service = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  const attached = await service.call('exec',{requestId:'attach',code:'return canvas.attach({canvasId:"canvas",documentId:"doc"});'}) as {value:{sessionId:string;version:number}};
  const sessionId = attached.value.sessionId;
  expect(attached.value.version).toBe(7);
  const result = await service.call('exec',{sessionId,requestId:'batch',expectedVersion:7,code:'nodes.draw({ascii:"A"}); const b = nodes.draw({ascii:"B"}); return nodes.get({nodeId:b.id});'}) as {value:{id:string;version:number};transaction:{version:number}};
  expect(result.value.version).toBe(8); expect(result.transaction.version).toBe(8);
  const read = await service.call('diagram-search',{operation:'read',sessionId,nodeId:result.value.id}) as {version:number;node:{version:number}};
  expect(read.node.version).toBe(read.version); expect(read.version).toBe(8);
  controller.undo(); expect(controller.nodes().filter(node => node.kind === 'diagram')).toHaveLength(1);
  const input = {sessionId,requestId:'draw',expectedVersion:controller.getSnapshot().version,ascii:'C'};
  const first = await service.call('draw_diagram',input);
  expect(await service.call('draw_diagram',input)).toEqual(first);
  expect(controller.nodes().filter(node => node.kind === 'diagram')).toHaveLength(2);
  await expect(service.call('draw_diagram',{...input,ascii:'Different'})).rejects.toThrow('REQUEST_ID_CONFLICT');
  const version = controller.getSnapshot().version;
  await expect(service.call('exec',{sessionId,requestId:'rollback',expectedVersion:version,code:'nodes.draw({ascii:"Temporary"}); nodes.move({nodeId:"grid:overview",position:{x:2,y:4}});'})).rejects.toThrow('cell coordinates');
  expect(controller.getSnapshot().version).toBe(version);
});

it('sets source mappings through MCP with atomic validation, stable anchors, history and live reads', async () => {
  const scene = singleDiagramScene('Root\n`-- Child');
  scene.contents = { ...scene.contents, overview: createDiagram({ id: 'overview', revision: 0, ascii: 'Root\n`-- Child', structureKind: 'tree' }) };
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
  const node = controller.nodes().find(n => n.id === 'grid:overview')!;
  if (node.layout !== 'grid') throw Error('Expected grid');
  controller.transact(0, [{ method: 'edge-create', edge: { id: 'edge', source: { kind: 'content-node', displayNodeId: node.id,
    contentNodeId: node.contentNodes![0].id, revisionId: node.content!.revisionId, side: 'auto' }, target: { kind: 'box', displayNodeId: node.id, side: 'auto' }, appearance: defaultArrowAppearance } }]);
  const before = structuredClone(controller.getSnapshot());
  const stableIds = controller.resolveDiagram('overview').nodes.map(n => n.id);
  const bridge: CanvasSessionPort = { register() {}, list: () => [{canvasId:'canvas',documents:[{documentId:'doc',name:'Test'}]}], poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_id, command) {
      if (command.method === 'snapshot') return {...controller.getSnapshot(), history: controller.exportHistory(), name:'Test'};
      const p = command.payload as {expectedVersion:number;operations:DiagramOperation[]};
      return controller.transact(p.expectedVersion, p.operations);
    } };
  const service = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  const attached = await service.call('exec', {requestId:'attach',code:'return canvas.attach({canvasId:"canvas",documentId:"doc"});'}) as {value:{sessionId:string}};
  const input = { sessionId: attached.value.sessionId, requestId: 'map', expectedVersion: 1, nodeId: node.id, expectedContentHash: node.content!.asciiSha256,
    mappings: [{id:'m',entityId:'e',sourceRangeIndex:0,sourceRangeId:'r',line:2,startColumn:5,endColumn:9}],
    evidence: {e:{id:'e',handle:'Child',label:'Child',category:'operation',summary:'Child declaration',sourceRanges:[{id:'r',path:'child.ts',startLine:1,endLine:1,originalLines:['function Child() {}']}]}} };
  const result = await service.call('set_diagram_source_mappings', input);
  expect(await service.call('set_diagram_source_mappings', input)).toEqual(result);
  const current = controller.getSnapshot();
  expect(current.version).toBe(2);
  expect(current.document.scene.contents.overview.content).toEqual(before.document.scene.contents.overview.content);
  expect(current.document.scene.root).toEqual(before.document.scene.root);
  expect(current.document.edges).toEqual(before.document.edges);
  expect(controller.resolveDiagram('overview').nodes.map(n=>n.id)).toEqual(stableIds);
  const read = await service.call('diagram-search', {operation:'read',sessionId:input.sessionId,nodeId:node.id}) as any;
  expect(read.node.diagram.sourceContext.mappings).toEqual(input.mappings);
  const restored = new MappingDocumentController(current.document, current.canvas, 0, undefined, undefined, controller.exportHistory());
  expect(restored.resolveDiagram('overview').sourceContext.mappings).toEqual(input.mappings);
  restored.undo(); expect(restored.resolveDiagram('overview').sourceContext.mappings).toEqual([]);
  restored.undo(true); expect(restored.resolveDiagram('overview').sourceContext.mappings).toEqual(input.mappings);
  for (const [suffix, override, error] of [
    ['version', {expectedVersion:1}, 'VERSION_CONFLICT'],
    ['hash', {expectedContentHash:'0'.repeat(64)}, 'CONTENT_HASH_CONFLICT'],
    ['evidence', {evidence:{}}, 'unknown diagram evidence'],
    ['bounds', {mappings:[{...input.mappings[0],line:99}]}, 'Invalid diagram-local source mapping']
  ] as const) {
    await expect(service.call('set_diagram_source_mappings', Object.assign({...input,requestId:suffix,expectedVersion:2},override))).rejects.toThrow(error);
    expect(controller.getSnapshot()).toEqual(current);
  }
  const clear = { nodeId: node.id, expectedContentHash: input.expectedContentHash, mappings: [], evidence: {} };
  await service.call('exec', {sessionId:input.sessionId,requestId:'clear',expectedVersion:2,code:`return nodes.setSourceMappings(${JSON.stringify(clear)});`});
  expect(controller.resolveDiagram('overview').sourceContext.mappings).toEqual([]);
});
