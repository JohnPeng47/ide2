import { buildDiagramContent } from '../diagramContent';
import { validateDiagram, type Diagram, type DiagramInput } from '../diagram';

/** Internal parser/factory. Only the revision service may issue diagrams. */
export function constructDiagram(input: DiagramInput): Diagram {
  const content = buildDiagramContent(input.ascii, `${input.id}:${input.revision}`, input.structureKind ?? 'diagram');
  const diagram: Diagram = { id: input.id, revision: input.revision, diagramId: `diagram-${crypto.randomUUID()}`, revisionId: `diagram-revision-${crypto.randomUUID()}`, content,
    ...(input.jumps ? { jumps: structuredClone(input.jumps) } : {}),
    sourceContext: { ...(input.source ? { binding: structuredClone(input.source) } : {}), contentHash: content.asciiSha256,
      mappings: structuredClone(input.mappings ?? []), evidence: structuredClone(input.evidence ?? {}) } };
  validateDiagram(diagram);
  return diagram;
}
