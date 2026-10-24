import type { DiagramGenerationRequest, DiagramGenerator, GenerationOptions } from '../../../domain/core/diagrams/diagramGeneration';
import { getDiagramRevision, submitStoredDiagramEdit } from '../../../domain/core/diagrams/diagramRevisionStore';

/** Runs an agent; domain validation and revision publication happen only after success. */
export async function generateDiagram(generator: DiagramGenerator, request: DiagramGenerationRequest, options: GenerationOptions = {}) {
  options.signal?.throwIfAborted();
  const base = request.baseRevisionId ? getDiagramRevision(request.baseRevisionId) : undefined;
  if (base && base.diagram.id !== request.input.id) throw Error('Generation base belongs to another diagram');
  const raw = await generator.generate(structuredClone({ ...request, nodeRefs: base?.nodeRefs ?? {} }), options);
  options.signal?.throwIfAborted();
  return submitStoredDiagramEdit(request, { ascii: raw.ascii, structureKind: raw.structureKind ?? request.input.structureKind ?? 'diagram',
    mappings: raw.mappings ? [...raw.mappings] : undefined, replacementRanges: raw.replacementRanges }, raw.nodeCorrespondence);
}
