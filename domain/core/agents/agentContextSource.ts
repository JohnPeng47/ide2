import { z } from 'zod';
import { sha256 } from '../sha256';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const sourcePathSchema = z.string().min(1).max(1000).refine(path =>
  !/^[\\/]|^[A-Za-z]:|[\\\0]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'), 'Expected a relative source path');
export const sourceRangeSchema = z.object({
  type: z.literal('sourceRange'), sourceId: z.string().min(1).max(200), path: sourcePathSchema,
  startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  version: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('git'), commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/) }).strict(),
    z.object({ kind: z.literal('snapshot'), contentHash: hash }).strict()
  ])
}).strict().refine(value => value.endLine >= value.startLine, 'Invalid source range');
export type AgentContextSourceRange = z.infer<typeof sourceRangeSchema>;
/** A captured file, or an existing evidence slice whose original line offset is retained. */
export const sourceFileSchema = z.object({ startLine: z.number().int().positive(), lines: z.array(z.string()).min(1) }).strict();
export type AgentContextSourceFile = z.infer<typeof sourceFileSchema>;
export function sourceFileHash(file: AgentContextSourceFile) { return sha256(JSON.stringify({ startLine: file.startLine, lines: file.lines })); }
export function sourceRangeText(reference: AgentContextSourceRange, file: AgentContextSourceFile) {
  const start = reference.startLine - file.startLine, end = reference.endLine - file.startLine + 1;
  if (start < 0 || end > file.lines.length) throw Error('AGENT_CONTEXT_SOURCE_RANGE: range is outside the pinned source');
  return `${reference.path}:${reference.startLine}-${reference.endLine}\n${file.lines.slice(start, end).join('\n')}`;
}
export const captureSourceRangeSchema = z.object({
  type: z.literal('sourceFile'), sourceId: z.string().min(1).max(200), path: sourcePathSchema,
  startLine: z.number().int().positive().default(1), endLine: z.number().int().positive().optional(),
  revision: z.string().min(1).max(200).optional()
}).strict().refine(value => value.endLine === undefined || value.endLine >= value.startLine, 'Invalid source range');
export type CaptureSourceRange = z.infer<typeof captureSourceRangeSchema>;
