import { mappingsForSelection } from "../../../domain/core/diagrams/diagramSelection";
import type { DiagramElementMapping } from "../../../domain/core/records/domain";
import { MAPPING_POC_A_NODES, type MappingPocGridRect } from "../../../domain/mapping/selection/mappingPoc";
import type { MappingPocCorpusRangeContext } from "../../../domain/mapping/selection/mappingPocPrompt";
import type { CorpusAccess } from "../../core/corpus/corpusAccess";

const nodesById = new Map(MAPPING_POC_A_NODES.map((node) => [node.id, node]));

export async function mappingPocSourceContextForSelection(input: {
  sourceRoot: string;
  projectEvidence?: Record<string, import("../../../domain/core/representations/projectCatalog").ProjectRepresentationEvidenceRecord>;
  mappings: readonly DiagramElementMapping[];
  selection: MappingPocGridRect;
}, corpus: Pick<CorpusAccess, "provider">): Promise<MappingPocCorpusRangeContext[]> {
  const selectedMappings = mappingsForSelection(input.mappings, input.selection);
  if (!selectedMappings.length) {
    throw new Error("selected diagram elements have no mapped corpus ranges");
  }
  const binding = { kind: "git-worktree" as const, root: input.sourceRoot };
  const provider = corpus.provider(binding);
  const contexts = await Promise.all(selectedMappings.map(async (mapping) => {
    const node = input.projectEvidence ? input.projectEvidence[mapping.entityId] : nodesById.get(mapping.entityId);
    if (!node) throw new Error(`unknown mapped POC element: ${mapping.entityId}`);
    const range = node.sourceRanges[mapping.sourceRangeIndex];
    if (!range) throw new Error(`mapped POC element ${node.id} has no source range ${mapping.sourceRangeIndex}`);
    if (mapping.sourceRangeId && (!("id" in range) || range.id !== mapping.sourceRangeId)) throw new Error("Source range identity mismatch");
    const lines = input.projectEvidence && "originalLines" in range ? [...range.originalLines] : await provider.readLines(binding, range);
    const expectedLineCount = range.endLine - range.startLine + 1;
    if (lines.length !== expectedLineCount) {
      throw new Error(`mapped corpus range exceeds ${range.path}: ${range.startLine}-${range.endLine}`);
    }
    return {
      mappingId: mapping.id,
      elementId: node.id,
      elementLabel: node.label,
      diagramLine: mapping.line,
      startColumn: mapping.startColumn,
      endColumn: mapping.endColumn,
      path: range.path,
      startLine: range.startLine,
      endLine: range.endLine,
      lines
    };
  }));
  const totalLines = contexts.reduce((count, context) => count + context.lines.length, 0);
  if (totalLines > 5000) throw new Error("selected corpus context exceeds 5000 lines");
  return contexts;
}
