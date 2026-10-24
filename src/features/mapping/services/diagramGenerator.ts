import { getDiagramRevision, submitStoredDiagramEdit } from '../../../../domain/core/diagrams/diagramRevisionStore';
import type { DiagramGenerationRequest, GenerationOptions } from '../../../../domain/core/diagrams/diagramGeneration';
import type { DiagramGenerator } from '../../../../domain/core/diagrams/diagramGeneration';
import { promptMappingPocSelection } from '../api';

export const httpDiagramGenerator: DiagramGenerator = {
  async generate(request, options) {
    const context = request.context;
    if (!context) throw new Error('Select diagram content before generating');
    const { diagram, selection, ...project } = context;
    const result = await promptMappingPocSelection({ ...project,
      clientSessionId: `generate-${crypto.randomUUID()}`, operation: 'generate',
      contentId: diagram.id, diagramAscii: diagram.content.ascii, diagramRevision: diagram.revision,
      sourceContext: diagram.sourceContext, mappings: [...diagram.sourceContext.mappings],
      selection, instruction: request.instruction
    }, options.onProgress ?? (() => {}), options.signal);
    return { ascii: result.diagramAscii, mappings: result.mappings ?? [],
      source: diagram.sourceContext.binding, evidence: diagram.sourceContext.evidence };
  }
};

/** Browser application workflow; diagram parsing/validation stays in the domain. */
export async function generateDiagram(generator: DiagramGenerator, request: DiagramGenerationRequest, options: GenerationOptions = {}) {
  options.signal?.throwIfAborted();
  const base = request.baseRevisionId ? getDiagramRevision(request.baseRevisionId) : undefined;
  if (base && base.diagram.id !== request.input.id) throw Error('Generation base belongs to another diagram');
  const raw = await generator.generate({ ...request, nodeRefs: base?.nodeRefs ?? {} }, options);
  options.signal?.throwIfAborted();
  return submitStoredDiagramEdit(request, { ascii: raw.ascii, structureKind: raw.structureKind ?? request.input.structureKind ?? 'diagram',
    mappings: raw.mappings ? [...raw.mappings] : undefined, replacementRanges: raw.replacementRanges }, raw.nodeCorrespondence);
}
