import { applyMappingPocPromptPatch, generatedMappingPocResult, mappingPocPromptHunk,
  type MappingPocPromptRequest, type MappingPocPromptResult } from "./mappingPocPrompt";
import { loadMappingProject } from "./mappingProjectApi";

/** Deterministic UI preview. No model, original server, or source files are contacted. */
export async function promptMappingPocSelection(request: MappingPocPromptRequest, onProgress?: (message: string) => void): Promise<MappingPocPromptResult> {
  onProgress?.("Preparing demo response…");
  await new Promise(resolve => setTimeout(resolve, 500));
  const snapshot = await loadMappingProject();
  const revision = snapshot.catalog?.revisions[request.baseRevisionId ?? ""];
  const mappings = request.mappings ?? [];
  const selected = mappings.filter(m => m.line >= request.selection.startLine && m.line <= request.selection.endLine
    && m.startColumn <= request.selection.endColumn && m.endColumn >= request.selection.startColumn);
  if (!selected.length) throw new Error("Select mapped text first");
  const instruction = request.instruction.trim().replace(/[^\x20-\x7e]/g, "?").slice(0, 100);
  if (request.operation === "generate") {
    const unique = selected.filter((m, i) => selected.findIndex(other => other.entityId === m.entityId) === i);
    const lines = [`Demo: ${instruction}`, ...unique.map(m => ` +-- ${revision?.evidence[m.entityId]?.label ?? m.entityId}`)];
    return generatedMappingPocResult(lines, unique.map((m, i) => ({ ...m, id: `demo-${i}`, line: i + 2, startColumn: 6, endColumn: lines[i + 1].length })), mappings);
  }
  const hunk = mappingPocPromptHunk(request.diagramAscii, request.selection);
  const result = applyMappingPocPromptPatch({ currentAscii: request.diagramAscii, currentRevision: request.diagramRevision,
    expectedRevision: request.diagramRevision, hunk, replacementLines: [...hunk.expectedOldLines, `[Demo edit: ${instruction}]`] });
  result.mappings = mappings.flatMap(m => m.line < result.startLine ? [m]
    : m.line <= result.oldEndLine ? [] : [{ ...m, line: m.line + result.verticalDelta }]);
  return result;
}
