import type { DiagramRecord } from "./domain";
import { definePartialDiff, type PartialDiffDefinition } from "./partialDiff";

const artifactRefinementOwnershipTransfer = definePartialDiff({
  id: "artifact-refinement-ownership-transfer",
  label: "Open ownership-transfer diff",
  region: {
    startLine: 12,
    startColumn: 29,
    endLine: 49,
    endColumn: 70
  },
  padding: { columns: 3, lines: 2 },
  expandedAscii: [
    " BEFORE",
    "",
    "   [P] EditSessionRecord",
    "         |",
    "         +---- owns ----> [P] EditOperationRecord[]",
    "         |",
    "         `---- stores --> workingAscii",
    "",
    "",
    "                           |  CHANGE",
    "                           |",
    "                           |  1. Rehome operation history",
    "                           |  2. Make ASCII derived",
    "                           |  3. Keep session as coordinator",
    "                           v",
    "",
    "   AFTER",
    "",
    "   [P] EditSessionRecord",
    "         |",
    "         | coordinates through workingLayerId",
    "         v",
    "   [P] RepresentationLayerRecord                    [NEW OWNER]",
    "         |",
    "         +---- owns ----> [P] RepresentationOperationRecord[]",
    "         |",
    "         `---- supplies operations ----+",
    "                                        |",
    "                                        v",
    "                           [R] materializeRepresentationLayer()",
    "                           source ASCII + applied operation set",
    "                                        |",
    "                                        v",
    "                                materialized ASCII"
  ].join("\n")
});

const partialDiffsByDiagramHandle: Readonly<Record<string, PartialDiffDefinition>> = {
  "artifact-refinement-and-curation": artifactRefinementOwnershipTransfer
};

export function partialDiffForDiagram(
  diagram: Pick<DiagramRecord, "handle">
): PartialDiffDefinition | undefined {
  return partialDiffsByDiagramHandle[diagram.handle];
}
