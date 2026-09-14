import type { DiagramSelectionBounds } from "../records/domain";

export interface PartialDiffPadding {
  columns: number;
  lines: number;
}

export interface PartialDiffDefinition {
  id: string;
  label: string;
  region: DiagramSelectionBounds;
  expandedAscii: string;
  padding: PartialDiffPadding;
}

export interface PartialDiffInput {
  id: string;
  label?: string;
  region: DiagramSelectionBounds;
  expandedAscii: string;
  padding?: Partial<PartialDiffPadding>;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function rectangularAscii(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  while (lines[0]?.trim() === "") lines.shift();
  while (lines.at(-1)?.trim() === "") lines.pop();
  if (lines.length === 0) throw new Error("expandedAscii must contain visible ASCII");
  if (lines.some((line) => [...line].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code > 126;
  }))) {
    throw new Error("expandedAscii must contain printable 7-bit ASCII");
  }
  const width = Math.max(...lines.map((line) => line.length));
  return lines.map((line) => line.padEnd(width, " ")).join("\n");
}

/**
 * Define a character-grid region and the independently sized ASCII detail that
 * opens from its top-left cell. Expanded ASCII is normalized to a rectangular
 * block so callers can rely on stable monospace geometry.
 */
export function definePartialDiff(input: PartialDiffInput): PartialDiffDefinition {
  const region = {
    startLine: positiveInteger(input.region.startLine, "region.startLine"),
    startColumn: positiveInteger(input.region.startColumn, "region.startColumn"),
    endLine: positiveInteger(input.region.endLine, "region.endLine"),
    endColumn: positiveInteger(input.region.endColumn, "region.endColumn")
  };
  if (region.endLine < region.startLine || region.endColumn < region.startColumn) {
    throw new Error("partial diff region must end at or after its origin");
  }
  const id = input.id.trim();
  if (!id) throw new Error("partial diff id is required");
  const label = input.label?.trim() || "View semantic diff";
  return {
    id,
    label,
    region,
    expandedAscii: rectangularAscii(input.expandedAscii),
    padding: {
      columns: nonNegativeInteger(input.padding?.columns ?? 3, "padding.columns"),
      lines: nonNegativeInteger(input.padding?.lines ?? 2, "padding.lines")
    }
  };
}
