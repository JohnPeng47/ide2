import { assertSevenBitAscii, normalizeAscii, type EditOperationRecord, type DiagramSelectionBounds } from '../../core/records/domain';

export function textPatch(before: string, after: string): EditOperationRecord["patch"] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    start,
    deletedText: before.slice(start, beforeEnd),
    insertedText: after.slice(start, afterEnd)
  };
}

export function applyPatch(value: string, patch: EditOperationRecord["patch"], reverse = false): string {
  const deletedText = reverse ? patch.insertedText : patch.deletedText;
  const insertedText = reverse ? patch.deletedText : patch.insertedText;
  if (value.slice(patch.start, patch.start + deletedText.length) !== deletedText) {
    throw new Error("edit operation no longer matches the working copy");
  }
  return `${value.slice(0, patch.start)}${insertedText}${value.slice(patch.start + deletedText.length)}`;
}

export function characterOffset(ascii: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    throw new Error("marker coordinates must be positive integers");
  }
  const lines = ascii.split("\n");
  if (line > lines.length || column > lines[line - 1].length) {
    throw new Error("marker location exceeds the artifact bounds");
  }
  return lines.slice(0, line - 1).reduce((total, row) => total + row.length + 1, 0) + column - 1;
}

export function cropAsciiSelection(ascii: string, bounds: DiagramSelectionBounds): {
  ascii: string;
  selection: DiagramSelectionBounds;
} {
  const values = [bounds.startLine, bounds.endLine, bounds.startColumn, bounds.endColumn];
  if (!values.every((value) => Number.isInteger(value) && value >= 1)) {
    throw new Error("component selection coordinates must be positive integers");
  }
  const selection: DiagramSelectionBounds = {
    startLine: Math.min(bounds.startLine, bounds.endLine),
    endLine: Math.max(bounds.startLine, bounds.endLine),
    startColumn: Math.min(bounds.startColumn, bounds.endColumn),
    endColumn: Math.max(bounds.startColumn, bounds.endColumn)
  };
  const lines = normalizeAscii(ascii).split("\n");
  const width = Math.max(...lines.map((line) => line.length));
  if (selection.endLine > lines.length || selection.endColumn > width) {
    throw new Error("component selection exceeds the artifact bounds");
  }
  let rows = lines.slice(selection.startLine - 1, selection.endLine)
    .map((line) => line.padEnd(selection.endColumn, " ").slice(
      selection.startColumn - 1,
      selection.endColumn
    ));
  while (rows.length && !rows[0].trim()) rows = rows.slice(1);
  while (rows.length && !rows.at(-1)?.trim()) rows = rows.slice(0, -1);
  if (!rows.length) throw new Error("component selection cannot be blank");
  const occupiedColumns = rows.flatMap((row) => [...row].flatMap(
    (character, index) => character === " " ? [] : [index]
  ));
  const left = Math.min(...occupiedColumns);
  const right = Math.max(...occupiedColumns);
  const cropped = normalizeAscii(rows.map((row) => row.slice(left, right + 1)).join("\n"));
  assertSevenBitAscii(cropped);
  return { ascii: cropped, selection };
}
