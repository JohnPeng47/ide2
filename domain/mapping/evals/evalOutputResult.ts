import { placementSnapshot, type PlacementSnapshot } from '../../core/diagrams/diagramPlacement';
import { summarizeChangeSession, validateChangeSession, type ChangePreviewDocument, type ChangeSessionSummary, type DiagramChangeSession } from '../changes/diagramChangeSession';
import { CanvasHistory } from '../../core/diagrams/canvasHistory';
import type { DiagramRevision } from '../../core/diagrams/diagramRevision';

/** One execution result, regardless of the number of affected canvases. */
export interface EvalOutputResult {
  placementSnapshot?: PlacementSnapshot;
  schemaVersion: 1;
  canvases: ChangePreviewDocument[];
  /** Portable revision dependencies, including logical node identities and selected variants. */
  diagramRevisions: Record<string, DiagramRevision>;
  /** Frozen review metadata. Never dereference this ID to render an eval output. */
  changeSession?: ChangeSessionSummary;
}

export interface EvalOutputSummary {
  canvases: { id: string; name: string; kind: 'existing' | 'new' }[];
  changeSession?: { id: string; version: number; title: string };
}

export function summarizeEvalOutput(result: EvalOutputResult): EvalOutputSummary {
  const session = result.changeSession;
  return { canvases: result.canvases.map(doc => ({ id: doc.id, name: doc.name, kind: doc.baseline ? 'existing' : 'new' })),
    ...(session ? { changeSession: { id: session.id, version: session.version, title: session.title } } : {}) };
}

/** Copy the complete before/after evidence, excluding undo history and mutation receipts. */
export function captureChangeSessionOutput(source: DiagramChangeSession): EvalOutputResult {
  const session = validateChangeSession(source);
  if (!session.documents.length) throw Error('An output must contain at least one canvas.');
  const diagramRevisions: Record<string, DiagramRevision> = {};
  for (const doc of session.documents) for (const state of [doc.baseline, doc.proposed]) if (state)
    Object.assign(diagramRevisions, new CanvasHistory(state.document, state.canvas).export(true).diagramRevisions);
  return structuredClone({ schemaVersion: 1, placementSnapshot: placementSnapshot(session.documents.map(doc => ({ id: doc.id, scene: doc.proposed.document.scene }))), diagramRevisions, changeSession: summarizeChangeSession(session),
    canvases: session.documents.map(({ history: _history, past: _past, future: _future, ...doc }) => doc) });
}
