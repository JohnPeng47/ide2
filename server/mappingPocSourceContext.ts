import type { DiagramElementMapping } from "../src/domain";
import { mappingsForSelection } from "../src/diagramSelection";
import {
  MAPPING_POC_A_NODES,
  type MappingPocGridRect
} from "../src/mappingPoc";
import type {
  MappingPocCorpusRangeContext,
  MappingPocPromptResult
} from "../src/mappingPocPrompt";
import { corpusProvider } from "./corpus";

const nodesById = new Map(MAPPING_POC_A_NODES.map((node) => [node.id, node]));

export function initialMappingPocElementMappings(): DiagramElementMapping[] {
  return MAPPING_POC_A_NODES.flatMap((node) => node.sourceRanges.map((_range, sourceRangeIndex) => ({
    id: `${node.id}:range-${sourceRangeIndex + 1}`,
    entityId: node.id,
    sourceRangeIndex,
    line: node.head.line,
    startColumn: node.head.startColumn,
    endColumn: node.head.endColumn
  })));
}

export function mappingPocElementMappingsAfterPatch(
  mappings: readonly DiagramElementMapping[],
  result: MappingPocPromptResult
): DiagramElementMapping[] {
  return mappings.flatMap((mapping) => {
    if (mapping.line < result.startLine) return [mapping];
    if (mapping.line <= result.oldEndLine) return [];
    return [{ ...mapping, line: mapping.line + result.verticalDelta }];
  });
}

export async function mappingPocSourceContextForSelection(input: {
  sourceRoot: string;
  mappings: readonly DiagramElementMapping[];
  selection: MappingPocGridRect;
}): Promise<MappingPocCorpusRangeContext[]> {
  const selectedMappings = mappingsForSelection(input.mappings, input.selection);
  if (!selectedMappings.length) {
    throw new Error("selected diagram elements have no mapped corpus ranges");
  }
  const binding = { kind: "git-worktree" as const, root: input.sourceRoot };
  const provider = corpusProvider(binding);
  const contexts = await Promise.all(selectedMappings.map(async (mapping) => {
    const node = nodesById.get(mapping.entityId);
    if (!node) throw new Error(`unknown mapped POC element: ${mapping.entityId}`);
    const range = node.sourceRanges[mapping.sourceRangeIndex];
    if (!range) throw new Error(`mapped POC element ${node.id} has no source range ${mapping.sourceRangeIndex}`);
    const lines = await provider.readLines(binding, range);
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
