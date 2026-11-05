import { comparisonReportSchema } from '../compare/comparisonReport';
import { z } from 'zod';
import { fewShotProgressSchema } from './fewShot';
import { diagramChangeTreeResultSchema } from './diagramChangeTree';
import { compareRangesSchema, type CompareCanvasCopy, type CompareSource } from '../compare/comparePageSession';

const id = z.string().min(1).max(200);
const point = z.object({ id, title: z.string(), A: id, B: id }).strict();
const diagram = z.object({ kind: z.literal('diagram'), canvasCopyId: id, diagramId: id, revisionId: id,
  nodeRef: id.optional(), ranges: compareRangesSchema.optional() }).strict()
  .refine(pane => !pane.nodeRef || !pane.ranges, 'Choose subtree or slices');
const canvas = z.object({ kind: z.literal('canvas'), canvasCopyId: id, camera: z.object({ transform: z.object({
  offset: z.object({ x: z.number(), y: z.number() }), scale: z.number().positive()
}) }) }).strict();
const entry = { id, title: z.string(), explanation: z.string().optional() };
export const diagramJudgementSchema = z.object({ comparisons: z.array(z.object({ ...entry, A: diagram, B: diagram }).strict()).min(1) }).strict();
export const canvasJudgementSchema = z.object({ comparisons: z.array(z.union([z.object({ ...entry, A: canvas, B: canvas, points: z.array(point).optional() }).strict(), z.object({ ...entry, A: diagram, B: diagram }).strict()])).min(1) }).strict();
export const judgementTypes = {
  'diagram-change-tree': { label: 'Diagram change tree parse', schema: diagramChangeTreeResultSchema },
  'comparison-report': { label: 'Canvas comparison report', schema: comparisonReportSchema },
  'few-shot-progress': { label: 'Few-shot progress', schema: fewShotProgressSchema },
  'diagram-comparison': { label: 'Diagram comparison', schema: diagramJudgementSchema },
  'canvas-comparison': { label: 'Canvas comparison', schema: canvasJudgementSchema }
} as const;
export type JudgementKind = keyof typeof judgementTypes;
export type JudgementEvaluator = { kind: 'manual' } | { kind: 'deterministic'; parser: 'diagram-change-tree'; version: 1 } | { kind: 'model'; model: string; effort: string; prompt?: string; promptVersion?: number };
export interface JudgementSubject { runId?: string; outputKey?: string; source: CompareSource }
interface JudgementRecord {
  schemaVersion: 1; id: string; projectId: string; title: string; createdAt: string; updatedAt: string;
  /** Explicit attachments; one result can evaluate outputs from several runs. */
  runIds: string[]; subjects: JudgementSubject[];
  evaluator: JudgementEvaluator;
  status: 'queued' | 'generating' | 'finished' | 'failed'; error?: string; usage?: Record<string, number>;
  /** Immutable evidence, independent of later output edits or deletion. */
  canvases: CompareCanvasCopy[];
  source: { kind: 'comparison' | 'eval-run' | 'experiment'; id: string; fingerprint: string };
  /** Retains a tombstone so imported results cannot reappear after deletion. */
  deletedAt?: string;
}
export type Judgement = JudgementRecord & (
  | { kind: 'diagram-change-tree'; data?: z.infer<typeof diagramChangeTreeResultSchema> }
  | { kind: 'comparison-report'; data?: z.infer<typeof comparisonReportSchema> }
  | { kind: 'few-shot-progress'; data?: z.infer<typeof fewShotProgressSchema> }
  | { kind: 'diagram-comparison'; data?: z.infer<typeof diagramJudgementSchema> }
  | { kind: 'canvas-comparison'; data?: z.infer<typeof canvasJudgementSchema> }
);
export type JudgementSummary = Omit<JudgementRecord, 'canvases' | 'source' | 'deletedAt' | 'evaluator'> & {
  kind: JudgementKind; evaluator: Omit<Extract<JudgementEvaluator, { kind: 'model' }>, 'prompt'> | Exclude<JudgementEvaluator, { kind: 'model' }>;
};
export function summarizeJudgement(judgement: Judgement): JudgementSummary {
  const { canvases: _, source: __, deletedAt: ___, data: ____, evaluator, ...summary } = judgement;
  if (evaluator.kind !== 'model') return { ...summary, evaluator };
  const { prompt: _____, ...provenance } = evaluator;
  return { ...summary, evaluator: provenance };
}
