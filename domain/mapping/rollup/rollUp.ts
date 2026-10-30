import { z } from 'zod';
import type { CompareCanvasCopy, CompareSource } from '../compare/comparePageSession';
import { documentFromHistory } from '../../core/diagrams/canvasHistory';
import { flattenGrid, resolveScene } from '../../core/diagrams/lineGrid';

/** Legacy pre-Evals request shape; runs on disk are read-only now. */
export interface RollUpRequest { requestId: string; child: CompareSource; parent: CompareSource; passes: number; model: string; effort: string }
export const gridOutputId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,80}$/);
export const gridPosition = z.object({ column: z.number().int().min(0).max(20000), row: z.number().int().min(0).max(20000) }).strict();
const endpoint = z.object({ diagram: z.string().min(1), line: z.number().int().positive() }).strict();
export const outputEdge = z.object({ source: endpoint, target: endpoint, label: z.string().max(120) }).strict();
export const rollUpOutputSchema = z.object({
  explanation: z.string().min(1).max(6000),
  diagrams: z.array(z.object({ id: gridOutputId, ascii: z.string().min(1).max(50000), position: gridPosition }).strict()).length(1, 'r2 must contain exactly one diagram'),
  edges: z.array(outputEdge).max(40)
}).strict();
export type RollUpOutput = z.infer<typeof rollUpOutputSchema>;
export const attachOutputSchema = z.object({
  attachment: z.enum(['a', 'b', 'c']), explanation: z.string().min(1).max(6000),
  edits: z.array(z.object({ diagram: z.string().min(1), ascii: z.string().min(1).max(100000), merged: z.array(gridOutputId).max(12) }).strict()).max(20),
  placements: z.array(z.object({ diagram: gridOutputId, position: gridPosition }).strict()).max(12),
  edges: z.array(outputEdge).min(1).max(50)
}).strict();
export type AttachOutput = z.infer<typeof attachOutputSchema>;
export interface RollUpRun {
  id: string; requestHash: string; request: RollUpRequest; projectId: string;
  agentContextId: string; contextName: string; child: CompareCanvasCopy; parent: CompareCanvasCopy;
  status: 'queued' | 'generating' | 'finished' | 'failed'; createdAt: string; completedAt?: string; error?: string;
  outputs: { pass: number; stage: 'r2' | 'g2'; canvasId: string; explanation: string; usage?: Record<string, number> }[];
}
export const rollUpSummary = ({ child: _c, parent: _p, requestHash: _h, ...run }: RollUpRun) => run;

export function canvasContext(copy: CompareCanvasCopy, minimized: boolean) {
  const document = documentFromHistory(copy.history);
  return {
    name: copy.view.name, source: copy.source,
    diagrams: flattenGrid(resolveScene(document.scene)).flatMap(box => {
      if (box.box.kind !== 'diagram' || !box.contentId) return [];
      const diagram = document.scene.contents[box.contentId];
      const lines = diagram.content.ascii.split('\n');
      return [{ id: `grid:${box.box.id}`, revisionId: diagram.revisionId, position: box.bounds,
        ...(minimized ? { overview: lines.slice(0, 12).join('\n'), lineCount: lines.length } : { ascii: diagram.content.ascii, sourceContext: diagram.sourceContext }) }];
    }), edges: document.edges
  };
}
