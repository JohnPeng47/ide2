import { type projectOutput } from '../projections/savedCanvasProjection';
import { projectionTypeSchema } from '../projections/projectionType';
import { z } from 'zod';
import type { UpstreamExperimentOutput } from './experiment';
import type { ViewNode } from '../../core/presentation/viewTree';
import type { EvalCellStatus } from './evalRun';
import type { EvalRunPrompt } from './evalRun';

/** A presentation tree, not an ownership hierarchy. Summary nodes may span many records. */
export interface ExperimentOverviewNode extends ViewNode<import('./experimentNavigation').NavigationTarget> {
  status?: EvalCellStatus | 'planned' | 'partial' | 'unavailable';
  upstreamOutput?: UpstreamExperimentOutput;
  source?: { caseId?: string; phaseId?: string; conditionId?: string; sampleId?: string; stageId?: string; commentId?: string };
  tags?: string[];
  actions?: ExperimentOverviewAction[];
  children?: ExperimentOverviewNode[];
}
export interface ExperimentOverviewAction {
  label: string;
  /** Opaque references accepted together by the batch read endpoint. */
  refs: string[];
  /** One source per prompt and run represented by this action. Reads can deduplicate text across branches. */
  templateIds?: string[];
  promptSources?: { sampleId: string; stageId: string }[];
  /** Optional UI navigation; reading the action never requires opening the browser. */
  output?: { runId: string; cellKey: string; commentId?: string };
  /** Optional UI navigation to the saved judgement's own viewer. */
  judgement?: { judgementId: string };
}
export interface ExperimentOverview {
  schemaVersion: 1;
  experiment: { id: string; name: string; revision: number; description: string; tags: string[] };
  root: ExperimentOverviewNode;
  read: { method: 'POST'; url: string; maxRefs: number };
}
export const experimentReadBatchSchema = z.object({
  projectionType: projectionTypeSchema.default('graph'),
  refs: z.array(z.string().min(1).max(1500)).min(1).max(100)
}).strict();
export type ExperimentReadBatch = z.input<typeof experimentReadBatchSchema>;
export interface ExperimentPromptSource {
  runId: string; cellKey: string; sampleId: string; stageId: string;
  promptId: string; version?: number; contentHash?: string;
}
export type ExperimentReadValue =
  | { kind: 'prompt'; name: string; stage: string; text: string; textKind: 'pinned-template'; templateSource?: string; references?: EvalRunPrompt['references']; sources: ExperimentPromptSource[] }
  | { kind: 'output'; result: ReturnType<typeof projectOutput> }
  | { kind: 'inputs' | 'details' | 'settings' | 'conditions' | 'case' | 'judgement' | 'ground-truth'; data: unknown };
export type ExperimentReadResult = { ref: string } & (
  { status: 'ok'; value: ExperimentReadValue } |
  { status: 'error'; error: { code: 'not-found' | 'unavailable' | 'read-failed'; message: string } }
);
export interface ExperimentReadBatchResult { experimentId: string; revision: number; results: ExperimentReadResult[] }
