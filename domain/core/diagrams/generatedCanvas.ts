import type { CanvasGeneration } from './canvasGeneration';

import { savedAgentContextIdSchema } from '../agents/savedAgentContext';

/** Some older generated canvases have a synthetic owner rather than a saved context. */
export function canvasAgentContextId(canvas?: { agentContextId?: string; generated?: GeneratedCanvas }) {
  const id = savedAgentContextIdSchema.safeParse(canvas?.agentContextId ?? canvas?.generated?.agentContextId);
  return id.success ? id.data : undefined;
}

/** Ownership is the AgentContext; source canvases are provenance, not parents. */
export interface GeneratedCanvas {
  layoutTemplate?: import('./layoutTemplate').LayoutTemplate;
  layoutPlacements?: import('./layoutTemplate').LayoutPlacement[];
  key: string;
  agentContextId: string;
  contextName: string;
  stage: 'r2' | 'g2' | 'alternative' | 'proposal' | 'legacy';
  workflow?: 'roll-up' | 'alternatives' | 'few-shot-refinement' | 'diagram-change-proposal' | 'linked-canvases' | 'canvas-layout' | 'diagram-history';
  /** Absent for legacy canvases: their prompt is unknown. */
  prompt?: { id: string; version?: number; name: string };
  /** Immutable text captured at generation time, independent of the prompt library. */
  promptStages?: Record<string, string>;
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
  placementSnapshot?: import("./diagramPlacement").PlacementSnapshot;
  id: string; name: string; generated: GeneratedCanvas;
  history: import('./canvasHistory').CanvasHistoryRecord;
}
