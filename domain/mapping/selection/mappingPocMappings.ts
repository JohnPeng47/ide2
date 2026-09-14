import type { DiagramElementMapping } from '../../core/records/domain';
import { MAPPING_POC_A_NODES } from './mappingPoc';
import type { MappingPocPromptResult } from './mappingPocPrompt';

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
