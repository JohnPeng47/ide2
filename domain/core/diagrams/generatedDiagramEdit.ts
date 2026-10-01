import { z } from 'zod';
import { buildDiagramContent } from './diagramContent';
import { validateDiagram, type Diagram } from './diagram';

export const generatedDiagramEditSchema = z.object({
  ascii: z.string().min(1).max(20000),
  structureKind: z.enum(['diagram', 'tree']),
  mappings: z.array(z.object({ id: z.string().min(1), entityId: z.string().min(1),
    sourceRangeIndex: z.number().int().nonnegative(), sourceRangeId: z.string().optional(),
    line: z.number().int().positive(), startColumn: z.number().int().positive(), endColumn: z.number().int().positive()
  }).strict()).max(2000)
}).strict();
export type GeneratedDiagramEdit = z.infer<typeof generatedDiagramEditSchema>;

/** Validate an agent candidate without issuing a revision for rejected submissions. */
export function validateGeneratedDiagramEdit(base: Diagram, raw: unknown): GeneratedDiagramEdit {
  const candidate = generatedDiagramEditSchema.parse(raw);
  if (!candidate.ascii.trim() || candidate.ascii.includes('\r') || candidate.ascii.includes('\t'))
    throw Error('Use nonempty ASCII with LF newlines and spaces, not tabs');
  const content = buildDiagramContent(candidate.ascii, `${base.id}:${base.revision + 1}`, candidate.structureKind);
  validateDiagram({ ...base, revision: base.revision + 1, content, jumps: undefined,
    sourceContext: { ...base.sourceContext, contentHash: content.asciiSha256, mappings: candidate.mappings } });
  return candidate;
}
