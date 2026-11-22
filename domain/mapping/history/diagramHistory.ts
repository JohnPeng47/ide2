import { z } from 'zod';
import { gridPosition } from '../rollup/rollUp';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const text = z.string().min(1).max(12000);
export const historyEdgeSchema = z.object({ sourceCanvas: id, sourceDiagram: id, targetCanvas: id, targetDiagram: id, sourceLabel: z.string().min(1).max(500).nullable(), targetLabel: z.string().min(1).max(500).nullable(), label: z.string().min(1).max(100) }).strict();
export const historyChangeSchema = z.object({
  canvasId: id, canvasName: z.string().min(1).max(120), newCanvas: z.boolean(),
  diagrams: z.array(z.object({ diagramId: id, title: z.string().min(1).max(120), newDiagram: z.boolean(),
    operation: z.enum(['1a', '1b', '2', '3', '4']), instruction: text,
    position: gridPosition.nullable(), targetNodes: z.number().int().min(2).max(150).nullable()
  }).strict()).min(1).max(60)
}).strict();
export const historyPlanSchema = z.object({ explanation: text, batches: z.array(z.object({
  id, title: z.string().min(1).max(50), commits: z.array(z.string().regex(/^[a-f0-9]{40}$/)).min(2),
  rationale: text, dependsOn: z.array(id), futureDependencies: z.array(z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), reason: text }).strict()),
  sourcePaths: z.array(z.string().min(1).max(500)).min(1).max(100),
  tree: z.string().min(1), changes: z.array(historyChangeSchema).max(30), edges: z.array(historyEdgeSchema).max(100)
}).strict()).min(1).max(20) }).strict();
export type HistoryPlan = z.infer<typeof historyPlanSchema>;
export type HistoryBatch = HistoryPlan['batches'][number];
export const historyFillSchema = z.object({ explanation: text, diagrams: z.array(z.object({
  canvasId: id, diagramId: id, ascii: z.string().min(1), position: gridPosition.nullable()
}).strict()).max(200), edges: z.array(historyEdgeSchema).max(100),
  attachmentMappings: z.array(z.object({canvasId:id,diagramId:id,previousLabel:z.string().min(1).max(10000),nextLabel:z.string().min(1).max(10000)}).strict()).max(500).default([])
}).strict();
export type HistoryFill = z.infer<typeof historyFillSchema>;

export interface HistoryCanvasRef { documentId: string; name: string; viewId: string; checkpointId: string }
export interface HistoryStep {
  id: string; previousStepId?: string; phase: 'baseline' | 'scaffold' | 'execution'; title: string;
  commits: string[]; agentContextId: string; planId: string; runId?: string;
  canvases: HistoryCanvasRef[];
}

/** Coverage is ancestry order, not commit timestamps; merges use first-parent diffs. */
export function validateHistoryPlan(raw: unknown, commits: string[], baseline: Record<string, string[]>, structure: boolean): HistoryPlan {
  const plan = historyPlanSchema.parse(raw);
  if (JSON.stringify(plan.batches.flatMap(b => b.commits)) !== JSON.stringify(commits)) throw Error('Batches must partition the complete ordered commit sequence exactly once.');
  const seen = new Set<string>(), canvases = new Map(Object.entries(baseline).map(([k, v]) => [k, new Set(v)]));
  for (const batch of plan.batches) {
    if (seen.has(batch.id) || batch.dependsOn.some(id => !seen.has(id))) throw Error('Invalid batch dependency or duplicate batch ID');
    seen.add(batch.id);
    const last = commits.indexOf(batch.commits.at(-1)!);
    if (batch.futureDependencies.some(d => commits.indexOf(d.commit) <= last)) throw Error('Lookahead must cite a later commit in the sequence');
    const edited = new Set<string>();
    for (const change of batch.changes) {
      if (change.newCanvas === canvases.has(change.canvasId)) throw Error(`Invalid canvas introduction: ${change.canvasId}`);
      if (change.newCanvas) canvases.set(change.canvasId, new Set());
      for (const d of change.diagrams) {
        const key = `${change.canvasId}/${d.diagramId}`, known = canvases.get(change.canvasId)!;
        if (edited.has(key) || d.newDiagram === known.has(d.diagramId)) throw Error(`Invalid diagram introduction: ${key}`);
        if (structure && d.newDiagram && (!d.position || !d.targetNodes)) throw Error('New scaffold diagrams need position and targetNodes');
        edited.add(key); known.add(d.diagramId);
      }
    }
    for (const edge of batch.edges) if (!canvases.get(edge.sourceCanvas)?.has(edge.sourceDiagram) || !canvases.get(edge.targetCanvas)?.has(edge.targetDiagram)) throw Error('Edge references a diagram not introduced yet');
  }
  return plan;
}
