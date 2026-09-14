import { asciiSha256 } from "../../core/diagrams/asciiSha256";
import type { CompactionSnapshot } from "../../core/representations/compactionProjection";
import { buildTreeRepresentationIndex } from "../../core/representations/representationIndex";
import type { FileCompactionDraft, FileCompactionStage } from "./fileCompaction";

export interface FileCompactionSource {
  sourceFile: string;
  sourceSha256: string;
  text: string;
  lineCount: number;
}
export type FileCompactionPrompts = Record<FileCompactionStage, { name: string; text: string; sha256: string }>;

export function validateFileCompactionDraft(value: unknown, source: FileCompactionSource): asserts value is FileCompactionDraft {
  const draft = value as FileCompactionDraft | null;
  if (!draft || typeof draft.ascii !== "string" || !draft.ascii.trim() || draft.ascii.length > 200000
    || /[^\x0a\x20-\x7e]/.test(draft.ascii) || !Array.isArray(draft.mappings)) {
    throw new Error("Expected printable ASCII and source mappings (maximum 200,000 characters)");
  }
  const lines = draft.ascii.split("\n");
  const root = lines.findIndex((line) => line.trim());
  if (lines[root].trim() !== source.sourceFile) throw new Error("The diagram root must be the source-file path");
  const tree = buildTreeRepresentationIndex({
    revision: { artifactId: source.sourceFile, asciiSha256: asciiSha256(draft.ascii) }, ascii: draft.ascii
  });
  const semanticLines = new Set(Object.values(tree.nodes).map((node) => node.line));
  const mapped = new Set<number>();
  for (const mapping of draft.mappings) {
    if (!mapping || !Number.isInteger(mapping.treeLine) || !semanticLines.has(mapping.treeLine)
      || mapped.has(mapping.treeLine) || !Array.isArray(mapping.sourceRanges) || !mapping.sourceRanges.length
      || mapping.sourceRanges.some((range) => !range || !Number.isInteger(range.startLine)
        || !Number.isInteger(range.endLine) || range.startLine < 1 || range.endLine < range.startLine
        || range.endLine > source.lineCount)) throw new Error("Invalid, duplicate, or out-of-bounds source mapping");
    mapped.add(mapping.treeLine);
  }
  if (mapped.size !== semanticLines.size) throw new Error("Every semantic output row must have a source mapping");
  const rootRanges = draft.mappings.find((mapping) => mapping.treeLine === root + 1)?.sourceRanges;
  if (rootRanges?.length !== 1 || rootRanges[0].startLine !== 1 || rootRanges[0].endLine !== source.lineCount) {
    throw new Error("The source-file root must map to the whole source snapshot");
  }
}

export function compactionSnapshot(draft: FileCompactionDraft, source: FileCompactionSource): CompactionSnapshot {
  validateFileCompactionDraft(draft, source);
  return {
    sourceFile: source.sourceFile, sourceSha256: source.sourceSha256,
    ascii: draft.ascii, asciiSha256: asciiSha256(draft.ascii), mappings: structuredClone(draft.mappings)
  };
}
