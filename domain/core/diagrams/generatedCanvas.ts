import type { CanvasGeneration } from './canvasGeneration';

/** Ownership is the AgentContext; source canvases are provenance, not parents. */
export interface GeneratedCanvas {
  key: string;
  agentContextId: string;
  contextName: string;
  stage: 'r2' | 'g2' | 'alternative' | 'legacy';
  workflow?: 'roll-up' | 'alternatives';
  /** Absent for legacy canvases: their prompt is unknown. */
  prompt?: { id: string; version: number; name: string };
  runId?: string;
  pass?: number;
  source?: { documentId: string; viewId?: string; checkpointId: string };
  generation?: CanvasGeneration;
  /** The internal CanvasView encoding the changes over the pinned parent. */
  storageViewId?: string;
}

/** Older canvases predate the workflow field; their stage still says which workflow made them. */
export const generatedWorkflow = (generated: Pick<GeneratedCanvas, 'workflow' | 'stage'>) =>
  generated.workflow ?? (generated.stage === 'r2' || generated.stage === 'g2' ? 'roll-up' : 'alternatives');

export interface GeneratedCanvasRecord {
  id: string; name: string; generated: GeneratedCanvas;
  history: import('./canvasHistory').CanvasHistoryRecord;
}
