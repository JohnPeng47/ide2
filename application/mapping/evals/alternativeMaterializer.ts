import { alternativeOutputSchema } from '../../../domain/mapping/evals/alternatives';
import { materializeDiagrams } from '../rollup/rollUpMaterializer';

/** An alternative is a new canvas generated from an AgentContext. */
export function materializeAlternative(raw: unknown) {
  const output = alternativeOutputSchema.parse(raw);
  return { output, history: materializeDiagrams(output.diagrams, output.edges, 'alt') };
}
