import { buildTreeRepresentationIndex } from "./representationIndex";

export interface CompactionSnapshot {
  sourceId?: string;
  sourceFile: string;
  sourceSha256: string;
  ascii: string;
  asciiSha256: string;
  mappings: { treeLine: number; sourceRanges: { startLine: number; endLine: number }[] }[];
}

export interface CompactionProjection {
  files: CompactionSnapshot[];
  links: { callTreeNodeId: string; file: string; treeLines: number[] }[];
}

export interface CompactionProjectionInput {
  files: CompactionSnapshot[];
  links: { callTreeLine: number; file: string; treeLines: number[] }[];
}

function index(file: CompactionSnapshot) {
  return buildTreeRepresentationIndex({
    revision: { artifactId: file.sourceFile, asciiSha256: file.asciiSha256 }, ascii: file.ascii
  });
}

/** Validate imported snapshots and pinned addresses; never fuzzy-match labels at display time. */
export function validateCompactionProjection(value: CompactionProjection, callTreeNodeIds: ReadonlySet<string>): void {
  if (!value || !Array.isArray(value.files) || !value.files.length || !Array.isArray(value.links) || !value.links.length) {
    throw new Error("Compaction projection requires file snapshots and links");
  }
  const files = new Map<string, Set<number>>();
  for (const file of value.files) {
    if (!file || typeof file.sourceFile !== "string" || !file.sourceFile.trim()
      || files.has(file.sourceFile) || !/^[a-f0-9]{64}$/.test(file.sourceSha256)
      || !/^[a-f0-9]{64}$/.test(file.asciiSha256) || typeof file.ascii !== "string"
      || !file.ascii.trim() || /[^\x0a\x20-\x7e]/.test(file.ascii) || !Array.isArray(file.mappings)) {
      throw new Error("Invalid compaction snapshot");
    }
    const lines = new Set(Object.values(index(file).nodes).map((node) => node.line));
    const mapped = new Set<number>();
    for (const mapping of file.mappings) {
      if (!lines.has(mapping.treeLine) || mapped.has(mapping.treeLine)
        || !Array.isArray(mapping.sourceRanges) || !mapping.sourceRanges.length
        || mapping.sourceRanges.some((range) => !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine)
          || range.startLine < 1 || range.endLine < range.startLine)) throw new Error("Invalid compaction source mapping");
      mapped.add(mapping.treeLine);
    }
    if (mapped.size !== lines.size) throw new Error("Every compaction node needs a source mapping");
    files.set(file.sourceFile, lines);
  }
  for (const link of value.links) {
    const lines = files.get(link.file);
    if (!callTreeNodeIds.has(link.callTreeNodeId) || !lines || !Array.isArray(link.treeLines)
      || !link.treeLines.length || link.treeLines.some((line) => !lines.has(line))) {
      throw new Error("Unresolved call-tree to compaction link");
    }
  }
}
