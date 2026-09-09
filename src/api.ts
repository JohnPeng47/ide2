import type {
  ArtifactImportInput,
  AgentRunStatus,
  CodeEntityMappingResult,
  CodeEntityMappingTarget,
  CodeEntityPromptTemplateRecord,
  DiagramModelId,
  DiagramViewKind,
  DiagramSelectionBounds,
  GenerationDerivationRecord,
  GenerationOutputKind,
  GenerationPromptProfileId,
  GenerationReferenceSelection,
  MappedArtifactBundle,
  MaterializedDiagramSetInput,
  MaterializedDiagramSetResult,
  PlanChange,
  PlanDiagramSelection,
  PlanRecord,
  PlanStatus,
  RepositoryDirectoryListing,
  SystemPromptTemplateRecord,
  WorkspaceSnapshot
} from "./domain";
import type { ExperimentCatalogSnapshot, ExperimentDiagramArtifact } from "./experimentDomain";
import type {
  AddDiagramDatasetItemInput,
  AddDiagramDatasetItemResult,
  DiagramDatasetCatalogSnapshot,
  DiagramDatasetItemRecord,
  DiagramDatasetSummary
} from "./datasetDomain";
import type { CallGraphFocusRequest, CallGraphFocusResult } from "./callGraphFocus";
import type {
  RepresentationFeedbackTarget,
  RepresentationGraphRecord
} from "./representationGraph";
import type { SpatialProgressState } from "./agentWork";
import type { MappingPocPromptRequest, MappingPocPromptResult } from "./mappingPocPrompt";
import type {
  ProjectCorpusCompactionCatalogRecord,
  ProjectFileCompactionInput,
  ProjectRepresentationCatalogRecord,
  PromoteProjectRepresentationInput
} from "./projectCatalog";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${basePath}${path}`, init);
}

async function errorFrom(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error || `request failed with ${response.status}`);
}

export async function promptMappingPocSelection(
  request: MappingPocPromptRequest,
  onProgress: (message: string) => void
): Promise<MappingPocPromptResult> {
  const response = await apiFetch("/internal/mapping/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new Error("diagram prompt response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: MappingPocPromptResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type?: string;
      message?: string;
      error?: string;
      result?: MappingPocPromptResult;
    };
    if (event.type === "error") throw new Error(event.error || "diagram prompt failed");
    if (event.type === "progress" && event.message) onProgress(event.message);
    if (event.type === "result" && event.result) result = event.result;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error("diagram prompt stream ended without a patch result");
  return result;
}

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/studio/workspace", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function fetchProjectCorpusCompactions(): Promise<ProjectCorpusCompactionCatalogRecord> {
  const response = await apiFetch("/api/studio/project/corpus-compactions", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ProjectCorpusCompactionCatalogRecord>;
}

export async function upsertProjectFileCompaction(
  input: ProjectFileCompactionInput
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/studio/project/corpus-compactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function fetchProjectRepresentations(): Promise<ProjectRepresentationCatalogRecord> {
  const response = await apiFetch("/api/studio/project/representations", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ProjectRepresentationCatalogRecord>;
}

export async function promoteProjectRepresentation(
  input: PromoteProjectRepresentationInput
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/studio/project/representations/promote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function fetchPlans(): Promise<PlanRecord[]> {
  const response = await apiFetch("/api/studio/plans", { cache: "no-store" });
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
  const response = await apiFetch("/api/studio/plans", {
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
  const response = await apiFetch(`/api/studio/plans/${encodeURIComponent(planId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<PlanRecord>;
}

export async function createMaterializedDiagramSet(
  input: MaterializedDiagramSetInput
): Promise<MaterializedDiagramSetResult> {
  const response = await apiFetch("/api/studio/diagram-sets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, creationMode: "materialized" })
  });
  if (!response.ok) throw await errorFrom(response);
  const text = await response.text();
  const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
    type: string;
    error?: string;
    diagramSetId?: string;
    codeEntityIdsByKey?: Record<string, string>;
    diagramIdsByKey?: Record<string, string>;
    workspace?: WorkspaceSnapshot;
  });
  const failed = events.find((event) => event.type === "error");
  if (failed) throw new Error(failed.error || "materialized DiagramSet creation failed");
  const result = events.find((event) => event.type === "result");
  if (!result?.diagramSetId || !result.codeEntityIdsByKey || !result.diagramIdsByKey || !result.workspace) {
    throw new Error("materialized DiagramSet response is incomplete");
  }
  return {
    diagramSetId: result.diagramSetId,
    codeEntityIdsByKey: result.codeEntityIdsByKey,
    diagramIdsByKey: result.diagramIdsByKey,
    workspace: result.workspace
  };
}

export async function fetchRepresentationGraph(setId: string): Promise<RepresentationGraphRecord> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/representation-graph`,
    { cache: "no-store" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<RepresentationGraphRecord>;
}

export async function saveRepresentationGraph(
  setId: string,
  graph: RepresentationGraphRecord
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/representation-graph`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(graph)
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function addRepresentationFeedback(
  setId: string,
  input: { target: RepresentationFeedbackTarget; comment: string }
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/representation-graph/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function saveAgentSpatialProgress(
  setId: string,
  runId: string,
  state: SpatialProgressState
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/agent-runs/${encodeURIComponent(runId)}/spatial-progress`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state)
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function addDiagramHighlight(input: {
  diagramSetId: string;
  artifactKind: GenerationOutputKind;
  artifactId: string;
  mappingId: string;
}): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/studio/highlights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteDiagramHighlight(highlightId: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/highlights/${encodeURIComponent(highlightId)}`, {
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
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/files?${params.toString()}`,
    { cache: "no-store", signal }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<RepositoryDirectoryListing>;
}

export async function fetchCallGraphFocus(
  request: CallGraphFocusRequest
): Promise<CallGraphFocusResult> {
  const response = await apiFetch("/api/studio/call-graph-focus", {
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
  const response = await apiFetch(`/api/studio/artifact-bundle?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<MappedArtifactBundle>;
}

export async function fetchExperiments(): Promise<ExperimentCatalogSnapshot> {
  const response = await apiFetch("/api/studio/experiments", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ExperimentCatalogSnapshot>;
}

export async function fetchExperimentArtifact(input: {
  catalogId: string;
  axisId: string;
  iteration: number;
  value: number;
  replicate: number;
}): Promise<ExperimentDiagramArtifact> {
  const query = new URLSearchParams({
    axis: input.axisId,
    iteration: String(input.iteration),
    value: input.value.toFixed(2),
    replicate: String(input.replicate)
  });
  const response = await apiFetch(`/api/studio/experiments/${encodeURIComponent(input.catalogId)}/artifact?${query}`, {
    cache: "no-store"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<ExperimentDiagramArtifact>;
}

export async function fetchDiagramDatasets(): Promise<DiagramDatasetCatalogSnapshot> {
  const response = await apiFetch("/api/studio/diagram-datasets", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<DiagramDatasetCatalogSnapshot>;
}

export async function createDiagramDataset(name: string): Promise<DiagramDatasetSummary> {
  const response = await apiFetch("/api/studio/diagram-datasets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<DiagramDatasetSummary>;
}

export async function addDiagramDatasetItem(
  datasetId: string,
  input: AddDiagramDatasetItemInput
): Promise<AddDiagramDatasetItemResult> {
  const response = await apiFetch(`/api/studio/diagram-datasets/${encodeURIComponent(datasetId)}/items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<AddDiagramDatasetItemResult>;
}

export async function fetchDiagramDatasetItem(datasetId: string, itemId: string): Promise<DiagramDatasetItemRecord> {
  const response = await apiFetch(
    `/api/studio/diagram-datasets/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(itemId)}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<DiagramDatasetItemRecord>;
}

export async function updateDiagramDatasetItemLabels(
  datasetId: string,
  itemId: string,
  labels: string[]
): Promise<DiagramDatasetSummary> {
  const response = await apiFetch(
    `/api/studio/diagram-datasets/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labels })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<DiagramDatasetSummary>;
}

export async function removeDiagramDatasetItem(datasetId: string, itemId: string): Promise<DiagramDatasetSummary> {
  const response = await apiFetch(
    `/api/studio/diagram-datasets/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<DiagramDatasetSummary>;
}

export async function deleteDiagramSet(setId: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/diagram-sets/${encodeURIComponent(setId)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function saveSystemPromptTemplate(
  template: Pick<
    SystemPromptTemplateRecord,
    "label" | "description" | "prompts"
  >
    & { id?: string }
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    template.id
      ? `/api/studio/system-prompt-templates/${encodeURIComponent(template.id)}`
      : "/api/studio/system-prompt-templates",
    {
      method: template.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(template)
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function resetSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/system-prompt-templates/${encodeURIComponent(id)}/reset`, {
    method: "POST"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/system-prompt-templates/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function saveCodeEntityPromptTemplate(
  template: Pick<CodeEntityPromptTemplateRecord, "label" | "description" | "prompts"> & { id?: string }
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    template.id
      ? `/api/studio/code-entity-prompt-templates/${encodeURIComponent(template.id)}`
      : "/api/studio/code-entity-prompt-templates",
    {
      method: template.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(template)
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function resetCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/code-entity-prompt-templates/${encodeURIComponent(id)}/reset`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/code-entity-prompt-templates/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function mapCodeEntities(
  setId: string,
  artifactKind: GenerationOutputKind,
  artifactId: string,
  onProgress: (message: string) => void
): Promise<WorkspaceSnapshot> {
  const collection = artifactKind === "diagram" ? "diagrams" : "components";
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/${collection}/${encodeURIComponent(artifactId)}/code-entity-map`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new Error("mapping response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let workspace: WorkspaceSnapshot | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        type: string;
        message?: string;
        error?: string;
        workspace?: WorkspaceSnapshot;
      };
      if (event.type === "error") throw new Error(event.error || "mapping failed");
      if (event.message) onProgress(event.message);
      if (event.workspace) workspace = event.workspace;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as {
      type: string;
      message?: string;
      error?: string;
      workspace?: WorkspaceSnapshot;
    };
    if (event.type === "error") throw new Error(event.error || "mapping failed");
    if (event.message) onProgress(event.message);
    if (event.workspace) workspace = event.workspace;
  }
  if (!workspace) throw new Error("mapping stream ended without a workspace result");
  return workspace;
}

export interface CodeEntityMappingProgress extends CodeEntityMappingTarget {
  status: AgentRunStatus;
  message: string;
}

export async function mapCodeEntitiesBatch(
  setId: string,
  artifacts: CodeEntityMappingTarget[],
  onProgress: (event: CodeEntityMappingProgress) => void,
  concurrency = 3
): Promise<{ workspace: WorkspaceSnapshot; results: CodeEntityMappingResult[] }> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/code-entity-maps`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifacts, concurrency })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new Error("mapping response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let workspace: WorkspaceSnapshot | undefined;
  let results: CodeEntityMappingResult[] | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type: string;
      message?: string;
      error?: string;
      artifactKind?: CodeEntityMappingTarget["artifactKind"];
      artifactId?: string;
      status?: AgentRunStatus;
      workspace?: WorkspaceSnapshot;
      results?: CodeEntityMappingResult[];
    };
    if (event.type === "error") throw new Error(event.error || "mapping failed");
    if (event.artifactKind && event.artifactId && event.status && event.message) {
      onProgress({
        artifactKind: event.artifactKind,
        artifactId: event.artifactId,
        status: event.status,
        message: event.message
      });
    }
    if (event.workspace) workspace = event.workspace;
    if (event.results) results = event.results;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!workspace || !results) throw new Error("mapping stream ended without a batch result");
  return { workspace, results };
}

async function editAction(
  setId: string,
  sessionId: string,
  action: string,
  body?: unknown
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/edit-sessions/${encodeURIComponent(sessionId)}/${action}`,
    {
      method: "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function createEditSession(
  setId: string,
  artifactKind: GenerationOutputKind,
  artifactId: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/diagram-sets/${encodeURIComponent(setId)}/edit-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artifactKind, artifactId })
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export const applyManualEdit = (setId: string, sessionId: string, ascii: string) => (
  editAction(setId, sessionId, "manual", { ascii })
);

export async function placeEditMarker(
  setId: string,
  sessionId: string,
  line: number,
  column: number
): Promise<{ workspace: WorkspaceSnapshot; markerToken: string }> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/edit-sessions/${encodeURIComponent(sessionId)}/marker`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ line, column })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<{ workspace: WorkspaceSnapshot; markerToken: string }>;
}

export const undoEdit = (setId: string, sessionId: string) => editAction(setId, sessionId, "undo");
export const redoEdit = (setId: string, sessionId: string) => editAction(setId, sessionId, "redo");
export const finishEdit = (setId: string, sessionId: string) => editAction(setId, sessionId, "finish");
export const discardEdit = (setId: string, sessionId: string) => editAction(setId, sessionId, "discard");

export async function applyLlmEdit(
  setId: string,
  sessionId: string,
  instruction: string,
  modelId: DiagramModelId,
  onProgress: (message: string) => void
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/edit-sessions/${encodeURIComponent(sessionId)}/llm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction, modelId })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new Error("edit response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let workspace: WorkspaceSnapshot | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        type: string;
        message?: string;
        error?: string;
        workspace?: WorkspaceSnapshot;
      };
      if (event.type === "error") throw new Error(event.error || "edit failed");
      if (event.message) onProgress(event.message);
      if (event.workspace) workspace = event.workspace;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as { type: string; error?: string; workspace?: WorkspaceSnapshot };
    if (event.type === "error") throw new Error(event.error || "edit failed");
    if (event.workspace) workspace = event.workspace;
  }
  if (!workspace) throw new Error("edit stream ended without a workspace result");
  return workspace;
}

export async function importGlobalArtifact(input: ArtifactImportInput): Promise<WorkspaceSnapshot> {
  const response = await apiFetch("/api/studio/imports", {
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
  const response = await apiFetch(`/api/studio/imports/diagrams/${encodeURIComponent(diagramId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveImportedDiagram(diagramId: string): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/imports/diagrams/${encodeURIComponent(diagramId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveImportedDiagramComponent(
  componentId: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/imports/diagram-components/${encodeURIComponent(componentId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function renameDiagram(
  setId: string,
  diagramId: string,
  name: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveDiagram(
  setId: string,
  diagramId: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function setStarredDiagram(
  setId: string,
  diagramId: string,
  starred: boolean
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}/star`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function saveDiagramCandidateRankings(
  setId: string,
  candidateBatchId: string,
  rankings: Array<{ diagramId: string; rank: number }>
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/candidate-batches/${encodeURIComponent(candidateBatchId)}/feedback`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rankings })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function captureDiagramComponent(
  setId: string,
  diagramId: string,
  bounds: DiagramSelectionBounds
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}/components`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bounds })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveDiagramComponent(
  setId: string,
  componentId: string
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/components/${encodeURIComponent(componentId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function captureNestedDiagramComponent(
  setId: string,
  componentId: string,
  bounds: DiagramSelectionBounds
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(
    `/api/studio/diagram-sets/${encodeURIComponent(setId)}/components/${encodeURIComponent(componentId)}/components`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bounds })
    }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function generateArtifacts(
  setId: string,
  input: {
    prompt: string;
    selectedCodeEntityIds: string[];
    count: number;
    outputKind: GenerationOutputKind;
    viewKind?: DiagramViewKind;
    modelId: DiagramModelId;
    promptProfileId: GenerationPromptProfileId;
    referenceSelections?: GenerationReferenceSelection[];
    referencePrompt?: string;
    referencePromptSelections?: GenerationReferenceSelection[];
    derivation?: GenerationDerivationRecord;
  },
  onProgress: (message: string) => void
): Promise<WorkspaceSnapshot> {
  const response = await apiFetch(`/api/studio/diagram-sets/${encodeURIComponent(setId)}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new Error("generation response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let workspace: WorkspaceSnapshot | undefined;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        type: "progress" | "workspace" | "result" | "error";
        message?: string;
        error?: string;
        workspace?: WorkspaceSnapshot;
      };
      if (event.type === "error") throw new Error(event.error || "generation failed");
      if (event.message) onProgress(event.message);
      if (event.workspace) workspace = event.workspace;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as { type: string; error?: string; workspace?: WorkspaceSnapshot };
    if (event.type === "error") throw new Error(event.error || "generation failed");
    if (event.workspace) workspace = event.workspace;
  }
  if (!workspace) throw new Error("generation stream ended without a workspace result");
  return workspace;
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
  const response = await apiFetch(`/api/studio/source?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<SourceSnippet>;
}
