import type { DiagramGenerator } from '../../../../domain/core/diagrams/diagramService';
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
