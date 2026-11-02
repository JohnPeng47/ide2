import { alternativeOutputSchema } from '../../../domain/mapping/evals/alternatives';
import { materializeDiagrams } from '../rollup/rollUpMaterializer';
import { placeLayoutSlots, type LayoutGeometry } from '../../../domain/core/diagrams/layoutTemplate';
import { templateOutputSchema } from '../../../domain/mapping/evals/layoutTemplate';

/** An alternative is a new canvas generated from an AgentContext. */
export function materializeAlternative(raw: unknown) {
  const output = alternativeOutputSchema.parse(raw);
  return { output, history: materializeDiagrams(output.diagrams, output.edges, 'alt') };
}

export function materializeTemplateAlternative(raw: unknown, geometry: LayoutGeometry) {
  const output = templateOutputSchema.parse(raw), layoutPlacements = placeLayoutSlots(geometry, output.diagrams);
  const content = new Map(output.diagrams.map(diagram => [diagram.slotId, diagram.ascii]));
  const diagrams = layoutPlacements.map(({ slotId, bounds }) => ({ id: slotId, ascii: content.get(slotId)!, position: { column: bounds.column, row: bounds.row } }));
  const edges = output.edges.map(edge => ({ ...edge, source: { diagram: edge.source.slotId, line: edge.source.line }, target: { diagram: edge.target.slotId, line: edge.target.line } }));
  return { output, layoutPlacements, history: materializeDiagrams(diagrams, edges, 'alt') };
}
