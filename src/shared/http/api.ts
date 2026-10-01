import type { ProjectCorpusCompactionCatalogRecord, ProjectFileCompactionInput, ProjectRepresentationCatalogRecord } from "../../../domain/core/representations/projectCatalog";
import { apiFetch, errorFrom } from "./http";

export async function fetchProjectCorpusCompactions(): Promise<ProjectCorpusCompactionCatalogRecord> {
  const response = await apiFetch("/api/core/project/corpus-compactions", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ProjectCorpusCompactionCatalogRecord>;
}

export async function upsertProjectFileCompaction(
  input: ProjectFileCompactionInput
): Promise<{ catalog: ProjectCorpusCompactionCatalogRecord; compaction: import("../../../domain/core/representations/projectCatalog").ProjectFileCompactionRecord }> {
  const response = await apiFetch("/api/core/project/corpus-compactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<{ catalog: ProjectCorpusCompactionCatalogRecord; compaction: import("../../../domain/core/representations/projectCatalog").ProjectFileCompactionRecord }>;
}

export interface ProjectRepresentationsSnapshot {
  project: import("../../../domain/core/records/domain").ProjectRecord | null;
  catalog: ProjectRepresentationCatalogRecord | null;
}

export async function loadProjectRepresentations(historyValidation: 'all' | 'current' = 'all'): Promise<ProjectRepresentationsSnapshot> {
  const response = await apiFetch("/api/core/project/representations" + (historyValidation === 'current' ? '?history=current' : ''), { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ProjectRepresentationsSnapshot>;
}

export interface SourceSnippet {
  path: string;
  startLine: number;
  lines: string[];
}

export interface ProjectSourceFile extends SourceSnippet {
  sourceSha256: string;
  lspEnabled: boolean;
}

export async function fetchProjectSourceFile(projectId: string, path: string, signal?: AbortSignal, sourceId?: string): Promise<ProjectSourceFile> {
  const params = new URLSearchParams({ projectId, path, ...(sourceId ? {sourceId} : {}) });
  const response = await apiFetch(`/api/core/project/source?${params}`, { cache: "no-store", signal });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function fetchProjectDirectory(projectId: string, path: string, signal?: AbortSignal, sourceId?: string): Promise<import('../../../domain/core/records/domain').RepositoryDirectoryListing> {
  const response = await apiFetch(`/api/core/project/files?${new URLSearchParams({ projectId, path, ...(sourceId ? {sourceId} : {}) })}`, { signal });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
export async function fetchSourceDefinitions(projectId: string, path: string, position: import('../../../domain/core/source/sourceNavigation').SourcePosition, sourceSha256: string, signal?: AbortSignal, sourceId?: string): Promise<import('../../../domain/core/source/sourceNavigation').SourceDefinitions> {
  const response = await apiFetch('/api/core/project/definitions', { method: 'POST', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, path, position, sourceSha256, sourceId }) });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
