import { DefaultCanvasHistoryService } from '../../../../domain/core/diagrams/canvasHistoryService';
import { documentFromHistory, type CanvasHistoryRecord } from '../../../../domain/core/diagrams/canvasHistory';
import { promotedCanvasName, singleBoxScene } from '../../../../domain/core/diagrams/promoteDiagram';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { saveMappingProjectDiagram } from '../workspace/mappingProjectApi';
import { listGenerated } from './evalsApi';

/** Copy one diagram of a generated canvas into a new standard canvas with its own fresh history. */
export async function promoteDiagramToCanvas(canvasId: string, sourceHistory: CanvasHistoryRecord, boxId: string, canvasName: string) {
  const scene = singleBoxScene(documentFromHistory(sourceHistory).scene, boxId);
  const document = mappingDocumentFromScene(scene);
  const histories = new DefaultCanvasHistoryService();
  const history = histories.exportContext(histories.openContext(document, initialCanvasState()));
  // The generated canvas's repository keeps source navigation working on the promoted copy.
  const repositoryId = (await listGenerated()).find(record => record.id === canvasId)?.repositoryId;
  const result = await saveMappingProjectDiagram({ name: promotedCanvasName(scene, boxId, canvasName), type: 'standard',
    history, scene: document.scene, edges: [], ...(repositoryId ? { repositoryId } : {}) });
  return result.representation;
}
