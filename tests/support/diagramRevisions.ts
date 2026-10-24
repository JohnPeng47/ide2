import { createStoredDiagram, reviseStoredDiagram, deriveStoredDiagram, getDiagramRevision, listDiagramRevisions, importDiagramRevision, submitStoredDiagramEdit } from '../../domain/core/diagrams/diagramRevisionStore';
import { generateDiagram } from '../../application/core/diagrams/generateDiagram';
import type { DiagramGenerator, DiagramGenerationRequest, GenerationOptions } from '../../domain/core/diagrams/diagramGeneration';

/** Test setup conveniences; production consumers use domain functions and storage directly. */
export function revisionFixture(generator?: DiagramGenerator) {
  return { generator: generator ?? { generate: async () => { throw Error('Diagram generation is unavailable in this runtime'); } }, create: createStoredDiagram, revise: reviseStoredDiagram, derive: deriveStoredDiagram,
    getRevision: getDiagramRevision, listRevisions: listDiagramRevisions, importRevision: importDiagramRevision,
    submit: submitStoredDiagramEdit,
    generate: (request: DiagramGenerationRequest, options?: GenerationOptions) => {
      if (!generator) throw Error('Diagram generation is unavailable in this runtime');
      return generateDiagram(generator, request, options);
    } };
}
