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
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('[Original]'), {}), initialCanvasState(), 7);
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
