import type { DiagramElementMapping } from "./domain";
export function validateDiagramLocalMappings(ascii: string, mappings: readonly DiagramElementMapping[]): void {
  if (mappings.length > 2000) throw new Error("Too many source mappings");
  const lines = ascii.split("\n");
  const ids = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.id !== "string" || !mapping.id || ids.has(mapping.id)
      || typeof mapping.entityId !== "string"
      || !Number.isInteger(mapping.sourceRangeIndex) || mapping.sourceRangeIndex < 0
      || !Number.isInteger(mapping.line) || mapping.line < 1
      || !Number.isInteger(mapping.startColumn) || mapping.startColumn < 1
      || !Number.isInteger(mapping.endColumn) || mapping.endColumn < mapping.startColumn
      || !lines[mapping.line - 1] || mapping.endColumn > lines[mapping.line - 1].length
      || !lines[mapping.line - 1].slice(mapping.startColumn - 1, mapping.endColumn).trim()) {
      throw new Error("Invalid diagram-local source mapping");
    }
    ids.add(mapping.id);
  }
}
