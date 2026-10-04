import { RevisionedDiagramService } from '../../../../domain/core/diagrams/diagramService';
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

it('routes document copies through the live bridge and retries a lost reply without duplicating the copy', async () => {
  const source = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Unsaved source')), initialCanvasState(), 3);
  const before = source.getSnapshot();
  let copied: MappingDocumentController | undefined, loseReply = true;
  const receipts = new Map<string, { documentId: string }>();
  const attempts: unknown[] = [];
  const bridge: CanvasSessionPort = {
    // The browser descriptor deliberately has not caught up with the newly created draft.
    register() {}, list: () => [{canvasId:'canvas',documents:[{documentId:'source',name:'Source'}]}], poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(canvasId, command) {
      expect(canvasId).toBe('canvas');
      if (command.method === 'snapshot') return { ...(command.documentId === 'copy' ? copied! : source).getSnapshot(), name:'Test' };
      expect(command.method).toBe('copy-document');
      expect(command.documentId).toBe('source');
      const payload = command.payload as {name:string;expectedVersion:number;requestId:string};
      expect(payload).toMatchObject({name:'Independent copy',expectedVersion:3});
      attempts.push(payload);
      if (!receipts.has(payload.requestId)) {
        copied = new MappingDocumentController(before.document, before.canvas, 0, undefined, undefined, source.forkHistory());
        receipts.set(payload.requestId, { documentId:'copy' });
      }
      if (loseReply) { loseReply = false; throw Error('CANVAS_TIMEOUT: lost copy acknowledgement'); }
      return receipts.get(payload.requestId);
    }
  };
  const service = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  const input = {requestId:'copy',code:'return canvas.copyDocument({canvasId:"canvas",documentId:"source",name:"Independent copy",expectedVersion:3});'};
  await expect(service.call('exec', input)).rejects.toThrow('CANVAS_TIMEOUT');
  const result = await service.call('exec', input) as {value:{sessionId:string;documentId:string;version:number}};
  expect(result.value).toMatchObject({documentId:'copy',version:0});
  expect(await service.call('exec', input)).toEqual(result);
  expect(attempts).toHaveLength(2); expect(attempts[0]).toEqual(attempts[1]);
  expect(receipts.size).toBe(1);
  const read = await service.call('exec', {sessionId:result.value.sessionId,requestId:'read-copy',code:'return nodes.list();'}) as {value:{nodes:unknown[]}};
  expect(read.value.nodes).toEqual(service.projection.nodes(copied!.nodes()));
  expect(source.getSnapshot()).toBe(before);
  await expect(service.call('exec', {...input,requestId:'bound-copy',sessionId:result.value.sessionId})).rejects.toThrow('unbound exec');
  await expect(service.call('exec', {...input,requestId:'proposal-copy',changeSessionId:'proposal'})).rejects.toThrow('live canvases only');
  await expect(service.call('exec', {...input,requestId:'missing-copy',code:input.code.replace('"source"','"missing"')})).rejects.toThrow('Unknown live document');
  expect(receipts.size).toBe(1);
});

it('commits each exec edit immediately with distinct versions, undo entries and request deduplication', async () => {
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
  expect(result.value.version).toBe(9); expect(result.transaction.version).toBe(9);
  const read = await service.call('diagram-search',{operation:'read',sessionId,nodeId:result.value.id}) as {version:number;node:{version:number}};
  expect(read.node.version).toBe(read.version); expect(read.version).toBe(9);
  controller.undo(); expect(controller.nodes().filter(node => node.kind === 'diagram')).toHaveLength(2);
  controller.undo(); expect(controller.nodes().filter(node => node.kind === 'diagram')).toHaveLength(1);
  const input = {sessionId,requestId:'draw',expectedVersion:controller.getSnapshot().version,ascii:'C'};
  const first = await service.call('draw_diagram',input);
  expect(await service.call('draw_diagram',input)).toEqual(first);
  expect(controller.nodes().filter(node => node.kind === 'diagram')).toHaveLength(2);
  await expect(service.call('draw_diagram',{...input,ascii:'Different'})).rejects.toThrow('REQUEST_ID_CONFLICT');
  const version = controller.getSnapshot().version;
  await expect(service.call('exec',{sessionId,requestId:'partial',expectedVersion:version,code:'nodes.draw({ascii:"Temporary"}); nodes.move({nodeId:"grid:overview",position:{x:2,y:4}});'})).rejects.toThrow('cell coordinates');
  expect(controller.getSnapshot().version).toBe(version + 1);
  expect(controller.nodes().some(node => node.layout === 'grid' && node.content?.ascii === 'Temporary')).toBe(true);
});

it('sets source mappings through MCP with atomic validation, stable anchors, history and live reads', async () => {
  const scene = singleDiagramScene('Root\n`-- Child');
  scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii: 'Root\n`-- Child', structureKind: 'tree' }).diagram };
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

it('retries a lost acknowledgement without repeating earlier edits or changing generated IDs', async () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), initialCanvasState());
  const receipts = new Map<string, ReturnType<typeof controller.applyUpdate>>();
  const attempts: { requestId: string; operations: DiagramOperation[] }[] = [];
  let loseReply = true;
  const bridge: CanvasSessionPort = {
    register() {}, list: () => [{canvasId:'canvas',documents:[{documentId:'doc',name:'Test'}]}], poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_id, command) {
      if (command.method === 'snapshot') return {...controller.getSnapshot(),name:'Test'};
      const p = command.payload as { expectedVersion: number; operations: DiagramOperation[]; requestId: string };
      attempts.push({requestId:p.requestId,operations:p.operations});
      if (receipts.has(p.requestId)) return receipts.get(p.requestId);
      expect(p.operations).toHaveLength(1);
      const result = controller.applyUpdate(p.expectedVersion,p.operations);
      receipts.set(p.requestId,result);
      if (loseReply && receipts.size === 2) { loseReply = false; throw Error('CANVAS_TIMEOUT: lost reply'); }
      return result;
    }
  };
  const service = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  const attached = await service.call('exec',{requestId:'attach',code:'return canvas.attach({canvasId:"canvas",documentId:"doc"});'}) as {value:{sessionId:string}};
  const input = { sessionId:attached.value.sessionId, expectedVersion:0, requestId:'retry', code:
    'const a=nodes.draw({ascii:"A"}); const read=nodes.get({nodeId:a.id}); try { nodes.move({nodeId:a.id,position:{column:-1,row:0}}); } catch(e) {} const b=nodes.draw({ascii:"B"}); const c=nodes.draw({ascii:"C"}); return {a,read,b,c};' };
  await expect(service.call('exec',input)).rejects.toThrow('CANVAS_TIMEOUT');
  expect(controller.getSnapshot().version).toBe(2);
  expect(controller.nodes().filter(n=>n.kind==='diagram')).toHaveLength(3);
  await expect(service.call('exec',{...input,code:input.code+' nodes.draw({ascii:"Different"});'})).rejects.toThrow('REQUEST_ID_CONFLICT');
  // The conflicting request must not erase the original execution's retry state.
  const result = await service.call('exec',input) as {value:Record<string,{id:string;version:number}>;transaction:{version:number}};
  expect(Object.fromEntries(Object.entries(result.value).map(([key,node])=>[key,node.version]))).toEqual({a:1,read:1,b:2,c:3});
  expect(result.value.read.id).toBe(result.value.a.id);
  expect(result.transaction.version).toBe(3);
  expect(controller.nodes().filter(n=>n.kind==='diagram')).toHaveLength(4);
  expect(attempts).toHaveLength(4);
  expect(attempts[2]).toEqual(attempts[1]);
  expect(await service.call('exec',input)).toEqual(result);
  expect(attempts).toHaveLength(4);
});

it('keeps committed edits on a later conflict and lets scripts catch individual operation errors', async () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original')), initialCanvasState());
  let concurrentEdit = true;
  const bridge: CanvasSessionPort = {
    register() {}, list: () => [{canvasId:'canvas',documents:[{documentId:'doc',name:'Test'}]}], poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_id, command) {
      if (command.method === 'snapshot') return {...controller.getSnapshot(),name:'Test'};
      const p = command.payload as {expectedVersion:number;operations:DiagramOperation[]};
      const result = controller.applyUpdate(p.expectedVersion,p.operations);
      if (concurrentEdit) {
        concurrentEdit = false;
        controller.applyUpdate(result.version,[{method:'diagram-create',id:'external',ascii:'External'}]);
      }
      return result;
    }
  };
  const service = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  const attached = await service.call('exec',{requestId:'attach',code:'return canvas.attach({canvasId:"canvas",documentId:"doc"});'}) as {value:{sessionId:string}};
  const sessionId=attached.value.sessionId;
  await expect(service.call('exec',{sessionId,requestId:'conflict',expectedVersion:0,code:'nodes.draw({ascii:"A"}); nodes.draw({ascii:"B"});'})).rejects.toThrow('VERSION_CONFLICT');
  expect(controller.nodes().filter(n=>n.layout==='grid'&&n.content).map(n=>n.layout==='grid'&&n.content?.ascii)).toEqual(['Original','A','External']);
  const result=await service.call('exec',{sessionId,requestId:'catch',expectedVersion:2,code:'try { nodes.remove({nodeId:"grid:root"}); } catch(e) {} const c=nodes.draw({ascii:"C"}); return nodes.get({nodeId:c.id});'}) as {value:{version:number}};
  expect(result.value.version).toBe(3);
  const version=controller.getSnapshot().version;
  await service.call('exec',{sessionId,requestId:'read',code:'return nodes.list();'});
  expect(controller.getSnapshot().version).toBe(version);
});
