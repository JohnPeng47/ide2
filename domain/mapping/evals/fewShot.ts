import { z } from 'zod';

export const FEW_SHOT_ROUNDS = 3;
export const FEW_SHOT_ALTERNATIVES = 3;
const text = z.string().min(1).max(12000);
const reference = z.object({ referenceId: z.string().optional(), slot: z.number().int().min(1).max(5), title: z.string().min(1).max(160),
  ascii: z.string().min(1), rationale: text }).strict();
export const referenceSetSchema = z.array(reference).length(5).refine(items => new Set(items.map(item => item.slot)).size === 5, 'Use slots 1 through 5 exactly once.');
export const seedReferencesSchema = z.object({ references: referenceSetSchema }).strict();
const score = z.number().min(0).max(5);
const assessment = z.object({ key: z.string().min(1), topology: score, coverage: score, accuracy: score, readability: score,
  evidence: text, strengths: text, weaknesses: text }).strict();
export const roundJudgementSchema = z.object({ assessments: z.array(assessment).length(3), progress: text,
  nextReferences: referenceSetSchema, recommendations: text }).strict();
export const fewShotProgressSchema = z.object({
  targetTitle: z.string(), targetAscii: z.string(), initialReferences: z.array(reference),
  rounds: z.array(z.object({ round: z.number().int().min(1).max(3), references: referenceSetSchema,
    assessments: z.array(assessment.extend({ canvasId: z.string(), checkpointId: z.string(), ascii: z.string() }).strict()).length(3),
    progress: text, nextReferences: referenceSetSchema, recommendations: text }).strict()).max(3)
}).strict();
export type FewShotReference = z.infer<typeof reference>;
export type FewShotProgress = z.infer<typeof fewShotProgressSchema>;
