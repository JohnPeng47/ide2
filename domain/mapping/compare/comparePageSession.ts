import { z } from 'zod';
import type { CanvasHistoryRecord } from '../../core/diagrams/canvasHistory';
import type { CanvasView } from '../../core/diagrams/canvasView';
import type { CanvasTransform } from '../../core/diagrams/diagramCanvas';

const id = z.string().min(1).max(200).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
export const compareSourceSchema = z.object({ documentId: id, viewId: id.optional(), checkpointId: id }).strict();
export type CompareSource = z.infer<typeof compareSourceSchema>;
export const createCompareSessionSchema = z.object({
  requestId: z.string().uuid(), title: z.string().trim().min(1).max(120),
  pairs: z.array(z.object({ A: compareSourceSchema, B: compareSourceSchema }).strict()).min(1).max(10)
}).strict();
export type CreateCompareSession = z.infer<typeof createCompareSessionSchema>;
export interface CompareCandidate extends CompareSource { name: string; canvasName: string }
/** Cameras use the existing persisted Mapping camera convention. */
export interface CameraView { transform: CanvasTransform }
export interface CompareCanvasCopy {
  id: string; source: CompareSource; canvasName: string;
  view: CanvasView; history: CanvasHistoryRecord;
}
export interface ComparePane { canvasCopyId: string; camera: CameraView }
export interface CompareView { id: string; title: string; A: ComparePane; B: ComparePane }
/** Self-contained snapshots, independent of Mapping's mutable workspace and archives. */
export interface ComparePageSession {
  schemaVersion: 1; id: string; projectId: string; title: string; createdAt: string;
  requestHash: string; canvases: CompareCanvasCopy[]; compares: CompareView[];
}
export type CompareSessionSummary = Pick<ComparePageSession, 'id' | 'title' | 'createdAt'> & { compareCount: number };
export function compareSessionSummary(session: ComparePageSession): CompareSessionSummary {
  return { id: session.id, title: session.title, createdAt: session.createdAt, compareCount: session.compares.length };
}
