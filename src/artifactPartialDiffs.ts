import type { DiagramRecord, PlanRecord } from "./domain";
import type { PartialDiffDefinition } from "./partialDiff";

export function partialDiffForDiagram(
  diagram: Pick<DiagramRecord, "id">,
  plans: readonly PlanRecord[]
): PartialDiffDefinition | undefined {
  for (const plan of plans) {
    const change = plan.changes.find((candidate) => candidate.kind === "diagram-modified"
      && candidate.diagramId === diagram.id
      && candidate.semanticDiff);
    if (change?.kind === "diagram-modified") return change.semanticDiff;
  }
  return undefined;
}
