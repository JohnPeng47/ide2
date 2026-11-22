import { CanvasHistory, documentFromHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { flattenGrid, resolveScene } from '../../../domain/core/diagrams/lineGrid';
import { importDiagramRevision } from '../../../domain/core/diagrams/diagramRevisionStore';
import { sha256 } from '../../../domain/core/sha256';
import type { MappingDocumentSnapshot } from '../../../domain/mapping/workspace/mappingWorkspace';
import type { HistoryCanvasSet } from './historyMaterializer';

export interface CapturedHistoryCanvas {
  key: string; name: string; documentId: string; representationId?: string | null;
  diagrams: { key: string; ascii: string; asciiSha256: string }[];
  edges: { edges: { id: string }[] };
}
/** Recover verified saved documents, including their real placement and anchor identities. */
export function historyBaseline(captured: CapturedHistoryCanvas[], documents: Pick<MappingDocumentSnapshot, 'representationId' | 'history'>[], namespace: string) {
  const result: HistoryCanvasSet = {}, provenance: { canvas: string; sourceDocumentId: string; checkpointId: string }[] = [];
  const ids = new Map(captured.flatMap(c => [c.documentId, c.representationId].filter((id): id is string => !!id).map(id => [id, `${namespace}-${c.key}`])));
  for (const canvas of captured) {
    const source = documents.find(doc => doc.representationId === canvas.documentId);
    if (!source?.history) throw Error(`No saved history for ${canvas.key}; do not invent a baseline layout`);
    const history: CanvasHistoryRecord = source.history;
    const doc = documentFromHistory(history), boxes = flattenGrid(resolveScene(doc.scene)).filter(item => item.box.kind === 'diagram');
    if (boxes.length !== canvas.diagrams.length) throw Error(`Baseline diagram count changed for ${canvas.key}`);
    const diagramIds: Record<string, string> = {}, used = new Set<string>();
    for (const diagram of canvas.diagrams) {
      if (sha256(diagram.ascii) !== diagram.asciiSha256) throw Error('Captured baseline hash mismatch');
      const matches = boxes.filter(item => !used.has(item.box.id) && doc.scene.contents[item.contentId!].content.asciiSha256 === diagram.asciiSha256);
      if (matches.length !== 1) throw Error(`Cannot unambiguously recover ${diagram.key} from the saved history`);
      used.add(matches[0].box.id); diagramIds[diagram.key.split('/').at(-1)!] = matches[0].box.id;
    }
    const expectedEdges = canvas.edges.edges.map(edge => edge.id).sort();
    if (JSON.stringify(doc.edges.map(edge => edge.id).sort()) !== JSON.stringify(expectedEdges)) throw Error(`Baseline connections changed for ${canvas.key}`);
    Object.values(history.diagramRevisions).forEach(importDiagramRevision);
    const remap = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (typeof object.representationId === 'string' && ids.has(object.representationId)) object.representationId = ids.get(object.representationId);
      Object.values(object).forEach(remap);
    };
    remap(doc.jumps); // Keep included cross-canvas navigation inside the isolated baseline set.
    const next = new CanvasHistory(doc, history.snapshots[history.headId].view);
    next.canvasView({ operation: 'create', name: 'Verified baseline' });
    result[canvas.key] = { id: ids.get(canvas.documentId)!, name: canvas.name, history: next.export(), diagramIds };
    provenance.push({ canvas: canvas.key, sourceDocumentId: canvas.documentId, checkpointId: history.headId });
  }
  return { canvases: result, provenance };
}
