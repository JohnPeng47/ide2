import { MappingDocumentController } from '../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState, type MappingWorkspaceSnapshot } from '../../domain/mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../../domain/core/diagrams/projectDiagramCanvas';
import { revisionFixture } from './diagramRevisions';

export function compareWorkspaceFixture(projectId: string): MappingWorkspaceSnapshot {
  const issued = revisionFixture(), scene = singleDiagramScene('Domain\n|-- Shared feature\n`-- First implementation');
  scene.contents = { ...scene.contents, overview: issued.create({ id: 'overview', revision: 0,
    ascii: 'Domain\n|-- Shared feature\n`-- First implementation', structureKind: 'tree' }).diagram };
  const controller = new MappingDocumentController({ scene, edges: [], sections: {} },
    { ...initialCanvasState(), viewport: { offset: { x: -150, y: -24 }, scale: 1 } });
  controller.canvasView(0, { operation: 'create', name: 'First view' });
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:overview',
    ascii: 'Domain\n|-- Shared feature\n`-- Second implementation', structureKind: 'tree' }]);
  controller.canvasView(controller.getSnapshot().version, { operation: 'create', name: 'Second view' });
  const state = controller.getSnapshot();
  return { schemaVersion: 3, projectId, activeDocumentId: 'canvas-domain', documents: [{
    representationId: 'canvas-domain', name: 'CanvasDomain', savedName: 'CanvasDomain', revisionId: 'saved-domain',
    savedScene: JSON.stringify(state.document.scene), savedEdges: '[]', document: state.document,
    canvas: state.canvas, history: controller.exportHistory()
  }] };
}
