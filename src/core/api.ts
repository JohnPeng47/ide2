import type { CallGraphFocusRequest, CallGraphFocusResult } from "./callGraphFocus";
import type {
  ArtifactImportInput,
  GenerationOutputKind,
  MappedArtifactBundle,
  PlanChange,
  PlanDiagramSelection,
  PlanRecord,
  PlanStatus,
  RepositoryDirectoryListing,
  WorkspaceSnapshot
} from "./domain";
import { apiFetch, errorFrom } from "./http";
import type { ProjectCorpusCompactionCatalogRecord, ProjectFileCompactionInput, ProjectRepresentationCatalogRecord } from "./projectCatalog";

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/core/workspace", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function fetchProjectCorpusCompactions(): Promise<ProjectCorpusCompactionCatalogRecord> {
  const response = await apiFetch("/api/core/project/corpus-compactions", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ProjectCorpusCompactionCatalogRecord>;
}

export async function upsertProjectFileCompaction(
  input: ProjectFileCompactionInput
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/core/project/corpus-compactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export interface ProjectRepresentationsSnapshot {
  project: import("./domain").ProjectRecord | null;
  catalog: ProjectRepresentationCatalogRecord | null;
}

export async function loadProjectRepresentations(): Promise<ProjectRepresentationsSnapshot> {
  const response = await apiFetch("/api/core/project/representations", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ProjectRepresentationsSnapshot>;
}

export async function fetchPlans(): Promise<PlanRecord[]> {
  const response = await apiFetch("/api/core/plans", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<PlanRecord[]>;
}

export async function createPlan(input: {
  id?: string;
  title: string;
  status?: PlanStatus;
  markdown: string;
  selection?: PlanDiagramSelection;
  changes?: PlanChange[];
}): Promise<PlanRecord> {
  const response = await apiFetch("/api/core/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<PlanRecord>;
}

export async function updatePlan(
  planId: string,
  input: Partial<Pick<PlanRecord, "title" | "status" | "markdown" | "selection" | "changes">>
): Promise<PlanRecord> {
  const response = await apiFetch(`/api/core/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<PlanRecord>;
}

export async function addDiagramHighlight(input: {
  diagramSetId: string;
  artifactKind: GenerationOutputKind;
  artifactId: string;
  mappingId: string;
}): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/core/highlights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteDiagramHighlight(highlightId: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/core/highlights/${encodeURIComponent(highlightId)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function fetchRepositoryDirectory(
  setId: string,
  directory: string,
  signal?: AbortSignal
): Promise<RepositoryDirectoryListing> {
  const params = new URLSearchParams({ path: directory });
  const response = await apiFetch(
    `/api/core/diagram-sets/${encodeURIComponent(setId)}/files?${params.toString()}`,
    { cache: "no-store", signal }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<RepositoryDirectoryListing>;
}

export async function fetchCallGraphFocus(
  request: CallGraphFocusRequest
): Promise<CallGraphFocusResult> {
  const response = await apiFetch("/api/core/call-graph-focus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<CallGraphFocusResult>;
}

export async function fetchMappedArtifactBundle(
  setId: string,
  artifactKind: GenerationOutputKind,
  artifactId: string
): Promise<MappedArtifactBundle> {
  const params = new URLSearchParams({ setId, artifactKind, artifactId });
  const response = await apiFetch(`/api/core/artifact-bundle?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<MappedArtifactBundle>;
}

export async function importGlobalArtifact(input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/core/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function renameImportedDiagram(
  diagramId: string,
  name: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/core/imports/diagrams/${encodeURIComponent(diagramId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveImportedDiagram(diagramId: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/core/imports/diagrams/${encodeURIComponent(diagramId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveImportedDiagramComponent(
  componentId: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/core/imports/diagram-components/${encodeURIComponent(componentId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export interface SourceSnippet {
  path: string;
  startLine: number;
  lines: string[];
}

export async function fetchSourceSnippet(
  setId: string,
  entityId: string,
  rangeIndex: number
): Promise<SourceSnippet> {
  const params = new URLSearchParams({ setId, entityId, range: String(rangeIndex) });
  const response = await apiFetch(`/api/core/source?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<SourceSnippet>;
}

export interface ProjectSourceFile extends SourceSnippet {
  sourceSha256: string;
}

export async function fetchProjectSourceFile(projectId: string, path: string, signal?: AbortSignal): Promise<ProjectSourceFile> {
  const params = new URLSearchParams({ projectId, path });
  const response = await apiFetch(`/api/core/project/source?${params}`, { cache: "no-store", signal });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function fetchProjectDirectory(projectId: string, path: string, signal?: AbortSignal): Promise<import('./domain').RepositoryDirectoryListing> {
  const response = await apiFetch(`/api/core/project/files?${new URLSearchParams({ projectId, path })}`, { signal });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
export async function fetchSourceDefinitions(projectId: string, path: string, position: import('./sourceNavigation').SourcePosition, sourceSha256: string, signal?: AbortSignal): Promise<import('./sourceNavigation').SourceDefinitions> {
  const response = await apiFetch('/api/core/project/definitions', { method: 'POST', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId, path, position, sourceSha256 }) });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
