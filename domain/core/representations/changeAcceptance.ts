import type { CanvasHistoryRecord, ResolvedCanvasDocument } from '../diagrams/canvasHistory';

export interface AcceptedCanvasRevision {
  revisionId: string;
  checkpointId: string;
}
/** Checkpoint IDs resolve in the published after revision's retained history. */
export interface AcceptedCanvasChange {
  documentId: string;
  representationId: string;
  before: AcceptedCanvasRevision | null;
  after: AcceptedCanvasRevision;
  proposedCheckpointId: string;
}
export interface ChangeSessionAcceptance {
  changeSessionId: string;
  sessionVersion: number;
  requestId: string;
  acceptedAt: string;
  changeIds: string[];
  documents: AcceptedCanvasChange[];
}
export interface AcceptCanvasChangesInput {
  changeSessionId: string;
  sessionVersion: number;
  requestId: string;
  changeIds: string[];
  documents: {
    documentId: string;
    representationId?: string;
    expectedRevisionId?: string;
    name: string;
    document: ResolvedCanvasDocument;
    history: CanvasHistoryRecord;
  }[];
}
