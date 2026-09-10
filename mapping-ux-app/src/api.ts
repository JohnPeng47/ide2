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

export { loadMappingProject as loadProjectRepresentations } from "./mappingProjectApi";
export type { MappingProjectSnapshot as ProjectRepresentationsSnapshot } from "./mappingProjectApi";

export interface SourceSnippet { path: string; startLine: number; lines: string[] }
export interface ProjectSourceFile extends SourceSnippet { sourceSha256: string }

export async function fetchProjectSourceFile(projectId: string, path: string, signal?: AbortSignal): Promise<ProjectSourceFile> {
  signal?.throwIfAborted();
  const project = (await loadMappingProject()).project;
  if (!project || project.id !== projectId) throw new Error("Source belongs to another project");
  const { default: files } = await import("../data/source-files.json");
  signal?.throwIfAborted();
  const file = (files as Record<string, ProjectSourceFile>)[path];
  if (!file) throw new Error(`Source file was not bundled: ${path}`);
  return structuredClone(file);
}

export const localChatResponder: import("./localChat").LocalChatResponder = {
  async reply(request, options) {
    options?.signal?.throwIfAborted();
    options?.onProgress?.("Preparing demo reply…");
    const snapshot = await loadMappingProject();
    const revision = snapshot.catalog?.revisions[request.context.baseRevisionId ?? ""];
    const selected = request.context.mappings.filter((mapping) =>
      mapping.line >= request.selection.rect.startLine && mapping.line <= request.selection.rect.endLine
      && mapping.startColumn <= request.selection.rect.endColumn && mapping.endColumn >= request.selection.rect.startColumn
    );
    const ranges = request.context.sourceRanges ?? selected.flatMap((mapping) =>
      (revision?.evidence[mapping.entityId]?.sourceRanges ?? []).map((range) => ({
        mappingId: mapping.id, elementId: mapping.entityId, elementLabel: revision?.evidence[mapping.entityId]?.label ?? mapping.entityId,
        diagramLine: mapping.line, startColumn: mapping.startColumn, endColumn: mapping.endColumn,
        path: range.path, startLine: range.startLine, endLine: range.endLine, lines: range.originalLines ?? []
      }))
    );
    options?.onContext?.(ranges);
    options?.signal?.throwIfAborted();
    const detail = request.verbosity === "high"
      ? ` The selected region links to ${ranges.length} saved source ranges. Open the call tree with N, then compactions and source to inspect the implementation. This conversation stays attached to your selection and supports follow-up questions.` : " Open its call tree, compactions, and source windows to inspect the implementation.";
    return `Demo reply: ${request.selection.summary}.${detail} No language model is connected in this standalone copy.`;
  }
};
