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
import { endpointKey } from '../../../../domain/mapping/workspace/endpointGeometry';

it('exposes anchored edge CRUD to agents with immediate edits, partial failures, version checks and undo', async () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('[Source]')), initialCanvasState());
  controller.configureLayout({ width: 11, height: 23 }, { width: 1000, height: 800 });
  const original = structuredClone(controller.getSnapshot().document.scene);
  const bridge: CanvasSessionPort = {
    register() {}, list: () => [{ canvasId: 'canvas', documents: [{ documentId: 'doc', name: 'Test' }] }], poll: async () => [], reply() {}, unregister() {}, dispose() {},
    async dispatch(_id, command) {
      if (command.method === 'snapshot' || command.method === 'identity') return { ...controller.getSnapshot(), name: 'Test' };
      if (command.method === 'apply') { const p = command.payload as { expectedVersion: number; operations: DiagramOperation[] }; return controller.transact(p.expectedVersion, p.operations); }
      throw new Error('Unexpected command');
    }
  };
  const service = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, {} as DiagramRepository, new QuickJsAgentRuntime());
  const attached: any = await service.call('exec', { requestId: 'attach', code: 'return canvas.attach({canvasId:"canvas",documentId:"doc"});' });
  const sessionId = attached.value.sessionId;
  let sequence = 0;
  const exec = (code: string, expectedVersion = controller.getSnapshot().version) => service.call('exec', { mode: 'immediate', sessionId, requestId: `request-${++sequence}`, expectedVersion, code }) as Promise<any>;
  const create = `const n = nodes.get({nodeId:'grid:overview'}); return edges.create({source:{kind:'content-node',displayNodeId:n.id,contentNodeId:Object.values(n.content.structure.nodes)[0].id,revisionId:n.content.revisionId},target:{kind:'box',displayNodeId:n.id},appearance:{}});`;
  const result = await exec(create);
  expect(result.transaction.version).toBe(1);
  const edge = result.value;
  const canonicalEdge = controller.getSnapshot().document.edges[0];
  expect((await exec('return edges.list();')).value.edges).toEqual([edge]);
  const rendered = (await exec(`return nodes.get({nodeId:${JSON.stringify(`floating:edge:${edge.id}`)}});`)).value;
  expect(rendered.value.source).toMatchObject({ x: 88, y: 11.5 });
  controller.configureEndpointBounds({
    [endpointKey(canonicalEdge.source)]: { x: 50.25, y: 20.5, width: 75.125, height: 16.75 },
    [endpointKey(canonicalEdge.target)]: { x: 200.25, y: 40.5, width: 120.125, height: 80.75 }
  });
  const measured = (await exec(`return nodes.get({nodeId:${JSON.stringify(`floating:edge:${edge.id}`)}});`)).value;
  expect(measured.value).toMatchObject({ geometrySource: 'measured', status: 'resolved', source: { x: 125.375, y: 28.875 } });
  expect(measured).toEqual(service.projection.node(controller.nodes().find(node => node.id === rendered.id)!));
  expect(controller.getSnapshot().document.scene).toEqual(original);
  const before = controller.getSnapshot();
  await expect(exec(`edges.remove({edgeId:${JSON.stringify(edge.id)}}); nodes.remove({nodeId:'grid:root'});`)).rejects.toThrow('protected');
  expect(controller.getSnapshot().version).toBe(before.version + 1);
  expect(controller.getSnapshot().document.edges).toEqual([]);
  controller.undo(); expect(controller.getSnapshot().document.edges).toEqual([canonicalEdge]);
  await expect(exec(`edges.remove({edgeId:${JSON.stringify(edge.id)}});`, 0)).rejects.toThrow('VERSION_CONFLICT');
  await exec(`const e=edges.list().edges[0]; edges.update({...e,appearance:{...e.appearance,label:'Calls'}}); edges.remove({edgeId:e.id});`);
  expect(controller.getSnapshot().document.edges).toEqual([]);
  controller.undo(); expect(controller.getSnapshot().document.edges[0].appearance.label).toBe('Calls');
  controller.undo(); expect(controller.getSnapshot().document.edges).toEqual([canonicalEdge]);
  expect(controller.getSnapshot().document.scene).toEqual(original);
  const positioned = { text: 'Calls', position: { x: 150.5, y: -20.25 } };
  await exec(`const e=edges.list().edges[0]; return edges.update({...e,appearance:{...e.appearance,label:${JSON.stringify(positioned)}}});`);
  expect((await exec('return edges.list();')).value.edges[0].appearance.label).toEqual(positioned);
  controller.configureEndpointBounds({
    [endpointKey(canonicalEdge.source)]: { x: 50.25, y: 20.5, width: 75.125, height: 16.75 },
    [endpointKey(canonicalEdge.target)]: { x: 200.25, y: 40.5, width: 120.125, height: 80.75 }
  });
  expect((await exec(`return nodes.get({nodeId:${JSON.stringify(rendered.id)}});`)).value.value.label).toEqual(positioned);
  const positionedVersion = controller.getSnapshot().version;
  await expect(exec(`const e=edges.list().edges[0]; return edges.update({...e,appearance:{...e.appearance,label:{text:'Bad',position:{x:1}}}});`)).rejects.toThrow();
  expect(controller.getSnapshot().version).toBe(positionedVersion);
  controller.undo(); expect(controller.getSnapshot().document.edges).toEqual([canonicalEdge]);
  controller.undo(true); expect(controller.getSnapshot().document.edges[0].appearance.label).toEqual(positioned);
  controller.undo();
  const jumpResult = await exec(`const n=nodes.get({nodeId:'grid:overview'}); return nodes.setJumps({nodeId:n.id,jumps:[{
    id:'jump', source:{revisionId:n.content.revisionId,contentHash:n.content.asciiSha256,line:1,startColumn:1,endColumn:8},
    target:{representationId:'saved-canvas'}}]});`);
  expect(jumpResult.value.diagram.jumps[0].target.representationId).toBe('saved-canvas');
  expect(controller.getSnapshot().document.scene.contents.overview.content.ascii).toBe('[Source]');
  const withJump = controller.getSnapshot();
  await expect(exec(`nodes.setJumps({nodeId:'grid:overview',jumps:[]}); nodes.remove({nodeId:'grid:root'});`)).rejects.toThrow('protected');
  expect(controller.getSnapshot().version).toBe(withJump.version + 1);
  expect(controller.getSnapshot().document.scene.contents.overview.jumps).toEqual([]);
  controller.undo(); expect(controller.getSnapshot().document.scene.contents.overview.jumps).toEqual(withJump.document.scene.contents.overview.jumps);
  controller.undo(); expect(controller.getSnapshot().document.scene.contents.overview.jumps).toBeUndefined();

});
