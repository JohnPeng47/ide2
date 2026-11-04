import { z } from 'zod';
import { compareSourceSchema, type CompareSource } from '../compare/comparePageSession';

/** A named ASCII excerpt copied from part of a diagram, cited in prompt templates as `{{ref:<id>}}`.
 * The text is frozen at creation, so prompt versions that cite it never change meaning. */
export interface EvalReference {
  schemaVersion: 1; id: string; projectId: string; requestId: string; name: string; ascii: string;
  /** Where the excerpt was copied from: the canvas or view, pinned to a checkpoint. */
  source: CompareSource; sourceName: string; canvasName: string;
  createdAt: string; updatedAt: string;
  /** Archived references leave the list but still resolve for prompts that cite them. */
  archivedAt?: string;
}
export const evalReferenceIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const createEvalReferenceSchema = z.object({
  requestId: z.string().uuid(), name: z.string().trim().min(1).max(120), ascii: z.string().max(50_000).refine(text => text.trim().length > 0, 'The excerpt is empty.'),
  source: compareSourceSchema, sourceName: z.string().max(200), canvasName: z.string().max(200)
}).strict();
export const updateEvalReferenceSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() }).strict();
export const captureCanvasSchema = z.object({ source: compareSourceSchema }).strict();

/** Readable, stable IDs: the token in a prompt names what it cites. */
export function referenceSlug(name: string, taken: ReadonlySet<string>) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'reference';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
export const referenceToken = (id: string) => `{{ref:${id}}}`;
/** How a cited excerpt appears in the prompt sent to the model. */
export const renderReference = (ascii: string) => '```text\n' + ascii.replace(/\s+$/, '') + '\n```';

/** Selected examples in stable selection order; inserted only at {{references}}. */
export const renderReferences = (items: { name: string; ascii: string }[]) => items.map(item => `### ${item.name}\n${renderReference(item.ascii)}`).join("\n\n");
