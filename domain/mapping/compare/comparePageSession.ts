import { z } from 'zod';
import type { CanvasHistoryRecord } from '../../core/diagrams/canvasHistory';
import type { CanvasView } from '../../core/diagrams/canvasView';
import { generatedWorkflow } from '../../core/diagrams/generatedCanvas';
import type { CanvasTransform } from '../../core/diagrams/diagramCanvas';

const id = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
export const compareSourceSchema = z.object({ documentId: id, viewId: id.optional(), checkpointId: id }).strict();
export type CompareSource = z.infer<typeof compareSourceSchema>;
export const compareRangeSchema = z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() }).strict()
  .refine(range => range.endLine >= range.startLine, 'Slice end precedes its start');
export const compareRangesSchema = z.array(compareRangeSchema).min(1).max(20)
  .refine(ranges => ranges.every((range, i) => !i || range.startLine > ranges[i - 1].endLine), 'Slices must be ordered and non-overlapping');
export type CompareRange = z.infer<typeof compareRangeSchema>;
const diagramTargetSchema = z.object({ diagramId: id, revisionId: id, nodeRef: id.optional(), ranges: compareRangesSchema.optional() }).strict()
  .refine(target => !target.nodeRef || !target.ranges, 'Choose subtree or line slices');
const paneSourceSchema = compareSourceSchema.extend({ diagram: diagramTargetSchema.optional() });
export const createCompareSessionSchema = z.object({
  requestId: z.string().uuid(), title: z.string().trim().min(1).max(120),
  pairs: z.array(z.object({ A: paneSourceSchema, B: paneSourceSchema,
    title: z.string().trim().min(1).max(200).optional(), explanation: z.string().trim().min(1).max(5000).optional(),
    focusPairs: z.array(z.object({ title: z.string().trim().min(1).max(200), A: id, B: id }).strict()).min(1).max(100).optional()
  }).strict().refine(pair => !!pair.A.diagram === !!pair.B.diagram && (!pair.A.diagram || !pair.focusPairs),
    'Choose two diagrams or two canvases; camera focuses belong to canvas pairs.')).min(1).max(40)
}).strict();
export type CreateCompareSession = z.infer<typeof createCompareSessionSchema>;
export interface CompareDiagramTarget { diagramId: string; revisionId: string; name: string }
export interface CompareCandidate extends CompareSource { name: string; canvasName: string; diagrams: CompareDiagramTarget[]; generated?: import('../../core/diagrams/generatedCanvas').GeneratedCanvas }
/** Cameras use the existing persisted Mapping camera convention. */
export interface CameraView { transform: CanvasTransform }
export interface CompareCanvasCopy {
  id: string; source: CompareSource; canvasName: string;
  view: CanvasView; history: CanvasHistoryRecord;
  /** Provenance of Evals-generated canvases, copied at capture. */
  generated?: import('../../core/diagrams/generatedCanvas').GeneratedCanvas;
}
export interface CompareCanvasPaneSpec { kind?: 'canvas'; canvasCopyId: string; camera: CameraView }
export interface CompareDiagramPaneSpec {
  kind: 'diagram'; canvasCopyId: string; diagramId: string; revisionId: string; nodeRef?: string; ranges?: CompareRange[];
}
export type ComparePane = CompareCanvasPaneSpec | CompareDiagramPaneSpec;
/** Explicit correspondence, referencing camera IDs on each copied CanvasView. */
export interface ComparePoint { id: string; title: string; A: string; B: string }
export interface CompareView { id: string; title: string; explanation?: string; A: ComparePane; B: ComparePane; points?: ComparePoint[] }
/** Visit every focus in one pair before moving to the next pair; old sessions retain one saved-camera step. */
export function compareSteps(session: ComparePageSession) {
  return session.compares.flatMap<{ compare: CompareView; point: ComparePoint | undefined }>(compare => compare.points?.length
    ? compare.points.map(point => ({ compare, point })) : [{ compare, point: undefined }]);
}
/** Self-contained snapshots, independent of Mapping's mutable workspace and archives. */
export interface ComparePageSession {
  schemaVersion: 1; id: string; projectId: string; title: string; createdAt: string;
  requestHash: string; canvases: CompareCanvasCopy[]; compares: CompareView[];
}
/** Matches the ASCII input order, so explanations such as “D4” identify a visible pane. */
export function compareDiagramLabels(session: ComparePageSession) {
  const labels = new Map<string, string>();
  for (const copy of session.canvases) {
    const visit = (box: import('../../core/diagrams/lineGrid').GridBox): void => {
      if (box.kind === 'container') box.children.forEach(visit);
      else labels.set(`${copy.id}:grid:${box.id}`, `D${labels.size + 1}`);
    };
    visit(copy.history.snapshots[copy.history.headId].document.scene.root);
  }
  return labels;
}
export interface CompareSessionOrigin { agentContextId: string; contextName: string; workflow: 'roll-up' | 'alternatives'; runId?: string; canvasId: string }
/** `origins` lists the generated canvases compared, so sessions can be filed under their AgentContext. */
export type CompareSessionSummary = Pick<ComparePageSession, 'id' | 'title' | 'createdAt'> & { compareCount: number; mixedOrigins?: boolean; origins: CompareSessionOrigin[] };
export function compareSessionSummary(session: ComparePageSession): CompareSessionSummary {
  const origins = session.canvases.flatMap(copy => copy.generated ? [{ agentContextId: copy.generated.agentContextId, contextName: copy.generated.contextName,
    workflow: generatedWorkflow(copy.generated), ...(copy.generated.runId ? { runId: copy.generated.runId } : {}), canvasId: copy.source.documentId }] : []);
  return { id: session.id, title: session.title, createdAt: session.createdAt, compareCount: session.compares.length, mixedOrigins: origins.length !== session.canvases.length, origins };
}
