import type { DiagramElementMapping } from "../core/domain";
import type { MappingPocGridRect } from "./mappingPoc";

export const MAPPING_POC_PROMPT_CONTEXT_LINES = 3;

export interface MappingPocPromptRequest {
  projectId?: string;
  representationId?: string;
  baseRevisionId?: string;
  operation?: "edit" | "generate";
  mappings?: DiagramElementMapping[];
  clientSessionId: string;
  diagramAscii: string;
  diagramRevision: number;
  selection: MappingPocGridRect;
  instruction: string;
}

export interface MappingPocPromptResult {
  mappings?: DiagramElementMapping[];
  diagramAscii: string;
  diagramRevision: number;
  startLine: number;
  oldEndLine: number;
  newEndLine: number;
  removedLineCount: number;
  insertedLineCount: number;
  verticalDelta: number;
}

export interface MappingPocPromptHunk {
  startLine: number;
  endLine: number;
  contextStartLine: number;
  contextEndLine: number;
  expectedOldLines: string[];
  contextLines: string[];
}

export interface MappingPocCorpusRangeContext {
  mappingId: string;
  elementId: string;
  elementLabel: string;
  diagramLine: number;
  startColumn: number;
  endColumn: number;
  path: string;
  startLine: number;
  endLine: number;
  lines: string[];
}

function normalizedSelection(selection: MappingPocGridRect): MappingPocGridRect {
  return {
    startLine: Math.min(selection.startLine, selection.endLine),
    endLine: Math.max(selection.startLine, selection.endLine),
    startColumn: Math.min(selection.startColumn, selection.endColumn),
    endColumn: Math.max(selection.startColumn, selection.endColumn)
  };
}

export function mappingPocPromptHunk(
  ascii: string,
  selection: MappingPocGridRect,
  contextLineCount = MAPPING_POC_PROMPT_CONTEXT_LINES
): MappingPocPromptHunk {
  const lines = ascii.split("\n");
  const normalized = normalizedSelection(selection);
  if (!Number.isInteger(contextLineCount) || contextLineCount < 0 || contextLineCount > 20) {
    throw new Error("prompt context line count must be between 0 and 20");
  }
  if (normalized.startLine < 1 || normalized.endLine > lines.length) {
    throw new Error("selection lines exceed the diagram bounds");
  }
  if (normalized.startColumn < 1 || normalized.endColumn < normalized.startColumn) {
    throw new Error("selection columns are invalid");
  }
  const contextStartLine = Math.max(1, normalized.startLine - contextLineCount);
  const contextEndLine = Math.min(lines.length, normalized.endLine + contextLineCount);
  return {
    startLine: normalized.startLine,
    endLine: normalized.endLine,
    contextStartLine,
    contextEndLine,
    expectedOldLines: lines.slice(normalized.startLine - 1, normalized.endLine),
    contextLines: lines.slice(contextStartLine - 1, contextEndLine)
  };
}

export function renderMappingPocAgentSystemPrompt(
  fullDiagram: string,
  diagramRevision: number,
  nonce: string
): string {
  return `You edit monospaced 7-bit ASCII diagrams.

For every edit request, modify only the TARGET rows, treat CONTEXT rows as read-only, and preserve connector continuity at the target boundaries. Finish with exactly one submit_diagram_patch tool call. replacementLines must contain only the replacement TARGET rows, without row numbers, gutter markers, context, or Markdown fences. Never modify files. The application applies the submitted rows at exact coordinates and never uses fuzzy matching.

Initial diagram revision: ${diagramRevision}

<FULL_DIAGRAM_${nonce}>
${fullDiagram}
</FULL_DIAGRAM_${nonce}>`;
}

export function renderMappingPocEditPrompt(input: {
  instruction: string;
  selectionId: string;
  diagramRevision: number;
  selection: MappingPocGridRect;
  hunk: MappingPocPromptHunk;
  sourceContext: MappingPocCorpusRangeContext[];
  nonce: string;
}): string {
  const normalized = normalizedSelection(input.selection);
  const rowWidth = String(input.hunk.contextEndLine).length;
  const renderedRows = input.hunk.contextLines.map((line, index) => {
    const lineNumber = input.hunk.contextStartLine + index;
    const gutter = lineNumber >= input.hunk.startLine && lineNumber <= input.hunk.endLine
      ? ">>"
      : "::";
    return `${gutter} ${String(lineNumber).padStart(rowWidth, "0")} | ${line}`;
  }).join("\n");
  const renderedSourceContext = input.sourceContext.map((context) => {
    const sourceRowWidth = String(context.endLine).length;
    const lines = context.lines.map((line, index) => (
      `${String(context.startLine + index).padStart(sourceRowWidth, "0")} | ${line}`
    )).join("\n");
    return `[MAPPED ELEMENT ${context.elementId}]
Label: ${context.elementLabel}
Diagram span: line ${context.diagramLine}, columns ${context.startColumn}-${context.endColumn}
Corpus range: ${context.path}:${context.startLine}-${context.endLine}
${lines}`;
  }).join("\n\n");
  return `Request:
<USER_REQUEST_${input.nonce}>
${input.instruction.trim()}
</USER_REQUEST_${input.nonce}>

Selection ID: ${input.selectionId}
Diagram revision: ${input.diagramRevision}
Target rows: ${input.hunk.startLine}..${input.hunk.endLine}
Original drag columns: ${normalized.startColumn}..${normalized.endColumn}
Context rows: ${input.hunk.startLine - input.hunk.contextStartLine} above, ${input.hunk.contextEndLine - input.hunk.endLine} below

The first two gutter cells identify row type: >> is TARGET and :: is read-only CONTEXT. Everything after the | separator is exact, complete diagram content.

<EDIT_HUNK_${input.nonce}>
${renderedRows}
</EDIT_HUNK_${input.nonce}>

Mapped corpus context is read-only evidence for the selected elements. It is refreshed for every edit request and must not be copied into replacementLines unless the requested diagram change calls for it.

<MAPPED_CORPUS_${input.nonce}>
${renderedSourceContext || "No mapped corpus ranges."}
</MAPPED_CORPUS_${input.nonce}>

Apply the request to TARGET and call submit_diagram_patch.`;
}

export function validateReplacementLines(lines: readonly string[]): void {
  if (lines.length < 1 || lines.length > 500) {
    throw new Error("replacement must contain between 1 and 500 lines");
  }
  for (const line of lines) {
    if (line.length > 500) throw new Error("replacement lines cannot exceed 500 columns");
    if (line.includes("\n") || line.includes("\r")) {
      throw new Error("each replacementLines item must be one logical line");
    }
    for (const character of line) {
      const code = character.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error("replacement must use printable 7-bit ASCII only");
    }
  }
}

/** Generated diagrams have their own origin and only map evidence supplied for this request. */
export function generatedMappingPocResult(
  lines: string[], mappings: DiagramElementMapping[], allowed: readonly DiagramElementMapping[]
): MappingPocPromptResult {
  validateReplacementLines(lines);
  if (!lines.join("\n").trim() || lines.join("\n").length > 20000) throw new Error("Generated diagram must contain 1–20000 characters");
  if (!mappings.length) throw new Error("Generated diagrams require source mappings");
  validateMappingPocMappings(lines.join("\n"), mappings);
  for (const mapping of mappings) {
    if (!allowed.some((source) => source.entityId === mapping.entityId && source.sourceRangeIndex === mapping.sourceRangeIndex)) {
      throw new Error("Generated mapping references evidence outside the selection");
    }
  }
  return { diagramAscii: lines.join("\n"), diagramRevision: 0, mappings,
    startLine: 1, oldEndLine: 0, newEndLine: lines.length,
    removedLineCount: 0, insertedLineCount: lines.length, verticalDelta: lines.length };
}

export function applyMappingPocPromptPatch(input: {
  currentAscii: string;
  currentRevision: number;
  expectedRevision: number;
  hunk: MappingPocPromptHunk;
  replacementLines: string[];
}): MappingPocPromptResult {
  if (input.currentRevision !== input.expectedRevision) {
    throw new Error("diagram revision changed while the prompt was running");
  }
  validateReplacementLines(input.replacementLines);
  const currentLines = input.currentAscii.split("\n");
  const actualOldLines = currentLines.slice(input.hunk.startLine - 1, input.hunk.endLine);
  if (JSON.stringify(actualOldLines) !== JSON.stringify(input.hunk.expectedOldLines)) {
    throw new Error("selected rows no longer match the prompt snapshot");
  }
  const nextLines = [
    ...currentLines.slice(0, input.hunk.startLine - 1),
    ...input.replacementLines,
    ...currentLines.slice(input.hunk.endLine)
  ];
  const removedLineCount = input.hunk.endLine - input.hunk.startLine + 1;
  const insertedLineCount = input.replacementLines.length;
  const verticalDelta = insertedLineCount - removedLineCount;
  return {
    diagramAscii: nextLines.join("\n"),
    diagramRevision: input.currentRevision + 1,
    startLine: input.hunk.startLine,
    oldEndLine: input.hunk.endLine,
    newEndLine: input.hunk.startLine + insertedLineCount - 1,
    removedLineCount,
    insertedLineCount,
    verticalDelta
  };
}

import { validateDiagramLocalMappings as validateMappingPocMappings } from "../core/diagramMappings";
export { validateDiagramLocalMappings as validateMappingPocMappings } from "../core/diagramMappings";
