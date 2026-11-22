import { DefaultCanvasHistoryService } from '../../../../domain/core/diagrams/canvasHistoryService';
import { documentFromHistory, type CanvasHistoryRecord } from '../../../../domain/core/diagrams/canvasHistory';
import { promotedCanvasName, singleBoxScene } from '../../../../domain/core/diagrams/promoteDiagram';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { saveMappingProjectDiagram } from '../workspace/mappingProjectApi';
import { canvasAgentContextId } from '../../../../domain/core/diagrams/generatedCanvas';
import { listGenerated } from './evalsApi';

/** One diagram of a canvas as its own document with a fresh history. */
export function singleDiagramDocument(sourceHistory: CanvasHistoryRecord, boxId: string) {
  const source = documentFromHistory(sourceHistory);
  // A fresh history resolves diagrams through the revision registry, so the source's revisions must enter it first,
  // whether or not this source has been displayed. Older revisions stay unvalidated until something reads them.
  new DefaultCanvasHistoryService('current').openContext(source, sourceHistory.snapshots[sourceHistory.headId].view, sourceHistory);
  const scene = singleBoxScene(source.scene, boxId);
  const document = mappingDocumentFromScene(scene);
  const histories = new DefaultCanvasHistoryService();
  return { scene, document, history: histories.exportContext(histories.openContext(document, initialCanvasState())) };
}

/** Copy one diagram of a generated canvas into a new standard canvas with its own fresh history. */
export async function promoteDiagramToCanvas(canvasId: string, sourceHistory: CanvasHistoryRecord, boxId: string, canvasName: string) {
  const { scene, document, history } = singleDiagramDocument(sourceHistory, boxId);
  // The generated canvas's repository keeps source navigation working on the promoted copy.
  const source = (await listGenerated()).find(record => record.id === canvasId);
  const result = await saveMappingProjectDiagram({ name: promotedCanvasName(scene, boxId, canvasName), type: 'standard',
    history, scene: document.scene, edges: [], repositoryId: source?.repositoryId, agentContextId: canvasAgentContextId(source) });
  return result.representation;
}
