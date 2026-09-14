import { type CodeEntityRecord, type DiagramElementMapping, type DiagramElementMappingDraft } from "../../../domain/core/records/domain";

export function validateDiagramMappings(
  ascii: string,
  drafts: DiagramElementMappingDraft[],
  entities: CodeEntityRecord[]
): DiagramElementMapping[] {
  if (drafts.length === 0) {
    if (entities.length === 0) return [];
    throw new Error("mapping agent submitted no diagram elements");
  }
  const lines = ascii.split("\n");
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const occupied = new Set<string>();
  return drafts.map((draft, index) => {
    const entity = entitiesById.get(draft.entityId);
    if (!entity) throw new Error(`mapping references unavailable CodeEntity: ${draft.entityId}`);
    if (!Number.isInteger(draft.sourceRangeIndex)
      || !entity.sourceRanges[draft.sourceRangeIndex]) {
      throw new Error(`mapping references unavailable source range for ${draft.entityId}`);
    }
    if (!Number.isInteger(draft.line)
      || !Number.isInteger(draft.startColumn)
      || !Number.isInteger(draft.endColumn)) {
      throw new Error("mapping coordinates must be integers");
    }
    const line = lines[draft.line - 1];
    if (line === undefined) {
      throw new Error(
        `mapping coordinates are outside the ASCII at line ${draft.line}; the ASCII has ${lines.length} lines`
      );
    }
    if (draft.startColumn < 1
      || draft.endColumn < draft.startColumn
      || draft.endColumn > line.length) {
      throw new Error(
        `mapping coordinates ${draft.startColumn}-${draft.endColumn} are outside the ASCII at line ${draft.line}; the line has ${line.length} columns`
      );
    }
    const text = line.slice(draft.startColumn - 1, draft.endColumn);
    if (!text.trim()) throw new Error("mapped diagram elements must contain visible text");
    for (let column = draft.startColumn; column <= draft.endColumn; column += 1) {
      const coordinate = `${draft.line}:${column}`;
      if (occupied.has(coordinate)) throw new Error("mapped diagram elements cannot overlap");
      occupied.add(coordinate);
    }
    const sourceRange = entity.sourceRanges[draft.sourceRangeIndex];
    return {
      ...draft,
      ...(sourceRange.id ? { sourceRangeId: sourceRange.id } : {}),
      id: `map-${index + 1}`
    };
  });
}

export function diagramMappingValidationError(
  ascii: string,
  drafts: DiagramElementMappingDraft[],
  entities: CodeEntityRecord[]
): string | undefined {
  try {
    validateDiagramMappings(ascii, drafts, entities);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "invalid diagram mappings";
  }
}
