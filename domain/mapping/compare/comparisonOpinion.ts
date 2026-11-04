import { z } from 'zod';

const level = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), label: z.string().trim().min(1).max(60), meaning: z.string().trim().min(1).max(500) }).strict();
export const customOpinionScaleSchema = z.object({ kind: z.literal('custom'), title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(20).max(2000), levels: z.array(level).min(2).max(7)
}).strict();
export const opinionScaleSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('default') }).strict(), customOpinionScaleSchema]);
export type OpinionScale = z.infer<typeof opinionScaleSchema>;
export const opinionSchema = z.object({ level: z.string().min(1).max(40), attributionConfidence: z.enum(['low', 'medium', 'high']), rationale: z.string().trim().min(1).max(2000) }).strict();
export type ComparisonOpinion = z.infer<typeof opinionSchema>;
export const defaultOpinionScale = {
  title: 'Estimated prompt-attributable difference',
  levels: [
    { id: 'none', label: 'None', meaning: 'No identifiable difference attributable to the changed prompt.' },
    { id: 'small', label: 'Small', meaning: 'A localized change in wording or emphasis plausibly follows from the prompt.' },
    { id: 'moderate', label: 'Moderate', meaning: 'A material change in represented detail or relationships plausibly follows from the prompt.' },
    { id: 'large', label: 'Large', meaning: 'An extensive change in represented content or organization plausibly follows from the prompt.' },
    { id: 'uncertain', label: 'Uncertain', meaning: 'The evidence does not support estimating a prompt-attributable degree of change.' }
  ]
};
export function resolvedOpinionScale(scale?: OpinionScale) { return scale?.kind === 'custom' ? scale : defaultOpinionScale; }
/** Shared palette; custom scales may change meanings, not legibility or arbitrary CSS. */
export function opinionColor(scale: OpinionScale | undefined, level: string) {
  if (level === 'uncertain') return '#9ca3af';
  const index = resolvedOpinionScale(scale).levels.findIndex(item => item.id === level);
  return ['#94a3b8', '#38bdf8', '#818cf8', '#c084fc', '#e879f9', '#f0abfc', '#f5d0fe'][Math.max(0, index)];
}
export function validateOpinions(scale: OpinionScale, opinions: ComparisonOpinion[]) {
  const levels = resolvedOpinionScale(scale).levels;
  if (new Set(levels.map(item => item.id)).size !== levels.length) throw Error('Opinion scale levels must have unique IDs.');
  if (opinions.some(opinion => !levels.some(item => item.id === opinion.level))) throw Error('Opinion references an unknown scale level.');
}
