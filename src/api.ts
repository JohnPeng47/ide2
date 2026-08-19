import type { WorkspaceSnapshot } from "./domain";

async function errorFrom(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error || `request failed with ${response.status}`);
}

export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch("/api/workspace", { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response);
  return response.json() as Promise<WorkspaceSnapshot>;
}

export async function finalizeCodeEntities(setId: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(`/api/diagram-sets/${encodeURIComponent(setId)}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
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

export async function generateDiagrams(
  setId: string,
  input: { prompt: string; selectedCodeEntityIds: string[]; count: number },
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
