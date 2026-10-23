import { z } from 'zod';
import { buildDiagramContent } from './diagramContent';
import { validateDiagram, type Diagram } from './diagram';
import { stripNodeContinuity } from './diagramNodeContinuity';
import { diagramContentNodes } from './diagramContentNodes';

export const generatedDiagramEditSchema = z.object({
  // Identity annotations are removed before enforcing the 20,000-character content limit.
  ascii: z.string().min(1).max(200000),
  structureKind: z.enum(['diagram', 'tree']),
  replacementRanges: z.array(z.object({ startLine: z.number().int().positive(), endLine: z.number().int().nonnegative() }).strict()).min(1).max(100).optional(),
  mappings: z.array(z.object({ id: z.string().min(1), entityId: z.string().min(1),
    sourceRangeIndex: z.number().int().nonnegative(), sourceRangeId: z.string().optional(),
    line: z.number().int().positive(), startColumn: z.number().int().positive(), endColumn: z.number().int().positive()
  }).strict()).max(2000).optional()
}).strict();
export type GeneratedDiagramEdit = z.infer<typeof generatedDiagramEditSchema>;

/** Validate an agent candidate without issuing a revision for rejected submissions. */
export function validateGeneratedDiagramEdit(base: Diagram, raw: unknown, nodeRefs: Readonly<Record<string, string>> = {}, sourceMappings = false): GeneratedDiagramEdit & { nodeCorrespondence: Record<string, number> } {
  const parsed = generatedDiagramEditSchema.parse(raw);
  if (!sourceMappings && parsed.mappings?.length) throw Error('SOURCE_MAPPINGS_DISABLED: omit mappings or enable source-mappings');
  if (sourceMappings && !parsed.mappings) throw Error('SOURCE_MAPPINGS_REQUIRED: supply mappings (an empty array is allowed)');
  const candidate = { ...parsed, ...stripNodeContinuity(parsed.ascii, nodeRefs) };
  if (!candidate.ascii.trim() || candidate.ascii.includes('\r') || candidate.ascii.includes('\t'))
    throw Error('Use nonempty ASCII with LF newlines and spaces, not tabs');
  const content = buildDiagramContent(candidate.ascii, `${base.id}:${base.revision + 1}`, candidate.structureKind);
  for (const line of Object.values(candidate.nodeCorrespondence)) if (diagramContentNodes(content).filter(node => node.line === line).length !== 1)
    throw Error('CONTINUITY: marker must identify exactly one output node');
  validateDiagram({ ...base, revision: base.revision + 1, content, jumps: undefined,
    sourceContext: { ...base.sourceContext, contentHash: content.asciiSha256, mappings: candidate.mappings ?? [] } });
  return candidate;
}
