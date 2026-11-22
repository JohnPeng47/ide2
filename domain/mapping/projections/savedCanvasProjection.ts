import { documentFromHistory, type CanvasHistoryRecord } from '../../core/diagrams/canvasHistory';
import type { DiagramRevision } from '../../core/diagrams/diagramRevision';
import type { ChangePreviewDocument } from '../changes/diagramChangeSession';
import type { CompareCanvasCopy } from '../compare/comparePageSession';
import type { EvalOutputResult } from '../evals/evalOutputResult';
import { type ProjectionType } from './projectionType';
import { projectCanvas } from './canvasProjection';

export function projectCheckpoint(history: CanvasHistoryRecord, projectionType: ProjectionType, checkpointId = history.headId) {
  return { checkpointId, projectionType, canvas: projectCanvas(documentFromHistory(history, checkpointId), projectionType, history.diagramRevisions) };
}

export function projectCopy(copy: CompareCanvasCopy, type: ProjectionType) {
  return { id: copy.id, name: copy.canvasName, source: copy.source, ...projectCheckpoint(copy.history, type, copy.source.checkpointId) };
}

export function projectCopies<T extends { canvases: CompareCanvasCopy[] }>(resource: T, type?: ProjectionType) {
  return type ? { ...resource, canvases: resource.canvases.map(copy => projectCopy(copy, type)) } : resource;
}

export function projectChangeDocument(doc: ChangePreviewDocument, type: ProjectionType, revisions?: Record<string, DiagramRevision>) {
  return { id: doc.id, name: doc.name, representationId: doc.representationId, version: doc.version, projectionType: type,
    baseline: doc.baseline && projectCanvas(doc.baseline.document, type, revisions),
    proposed: projectCanvas(doc.proposed.document, type, revisions) };
}

export function projectOutput(result: EvalOutputResult, type?: ProjectionType) {
  if (!type || result.format === 'markdown' || result.format === 'canvas-layout') return result;
  return { schemaVersion: result.schemaVersion, projectionType: type,
    canvases: result.canvases.map(doc => projectChangeDocument(doc, type, result.diagramRevisions)) };
}
