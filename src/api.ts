import type {
  ArtifactImportInput,
  CodeEntityPromptTemplateRecord,
  DiagramModelId,
  DiagramViewKind,
  DiagramSelectionBounds,
  GenerationDerivationRecord,
  GenerationOutputKind,
  GenerationPromptProfileId,
  GenerationReferenceSelection,
  SystemPromptTemplateRecord,
  WorkspaceSnapshot
} from "./domain";

async function errorFrom(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error || `request failed with ${response.status}`);
}

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch("/api/workspace", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteDiagramSet(setId: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/api/diagram-sets/${encodeURIComponent(setId)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function saveSystemPromptTemplate(
  template: Pick<SystemPromptTemplateRecord, "label" | "description" | "prompts"> & { id?: string }
): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    template.id
      ? `/api/system-prompt-templates/${encodeURIComponent(template.id)}`
      : "/api/system-prompt-templates",
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
  const response = await fetch(`/api/system-prompt-templates/${encodeURIComponent(id)}/reset`, {
    method: "POST"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteSystemPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/api/system-prompt-templates/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function saveCodeEntityPromptTemplate(
  template: Pick<CodeEntityPromptTemplateRecord, "label" | "description" | "prompts"> & { id?: string }
): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    template.id
      ? `/api/code-entity-prompt-templates/${encodeURIComponent(template.id)}`
      : "/api/code-entity-prompt-templates",
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
  const response = await fetch(
    `/api/code-entity-prompt-templates/${encodeURIComponent(id)}/reset`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function deleteCodeEntityPromptTemplate(id: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/api/code-entity-prompt-templates/${encodeURIComponent(id)}`, {
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/${collection}/${encodeURIComponent(artifactId)}/code-entity-map`,
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

async function editAction(
  setId: string,
  sessionId: string,
  action: string,
  body?: unknown
): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/edit-sessions/${encodeURIComponent(sessionId)}/${action}`,
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
  const response = await fetch(`/api/diagram-sets/${encodeURIComponent(setId)}/edit-sessions`, {
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/edit-sessions/${encodeURIComponent(sessionId)}/marker`,
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/edit-sessions/${encodeURIComponent(sessionId)}/llm`,
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
  const response = await fetch("/api/imports", {
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
  const response = await fetch(`/api/imports/diagrams/${encodeURIComponent(diagramId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveImportedDiagram(diagramId: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    `/api/imports/diagrams/${encodeURIComponent(diagramId)}/archive`,
    { method: "POST" }
  );
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function archiveImportedDiagramComponent(
  componentId: string
): Promise<WorkspaceSnapshot> {
  const response = await fetch(
    `/api/imports/diagram-components/${encodeURIComponent(componentId)}/archive`,
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}`,
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}/archive`,
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}/star`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred })
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/diagrams/${encodeURIComponent(diagramId)}/components`,
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/components/${encodeURIComponent(componentId)}/archive`,
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
  const response = await fetch(
    `/api/diagram-sets/${encodeURIComponent(setId)}/components/${encodeURIComponent(componentId)}/components`,
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
    derivation?: GenerationDerivationRecord;
  },
  onProgress: (message: string) => void
): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/api/diagram-sets/${encodeURIComponent(setId)}/generate`, {
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
  const response = await fetch(`/api/source?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<SourceSnippet>;
}
