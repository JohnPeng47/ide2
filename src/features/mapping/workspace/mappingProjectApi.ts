import type { ProjectRepresentationsSnapshot } from "../../../shared/http/api";
import { apiFetch, errorFrom } from "../../../shared/http/http";
import type { ProjectRepresentationRecord } from "../../../../domain/core/representations/projectCatalog";
import type { SaveProjectDiagramInput } from "../../../../domain/core/diagrams/projectDiagramCanvas";

export async function deleteMappingProjectDiagram(id: string): Promise<ProjectRepresentationsSnapshot> {
  const response = await apiFetch(`/api/mapping/diagrams/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function saveMappingProjectDiagram(input: SaveProjectDiagramInput): Promise<ProjectRepresentationsSnapshot & { representation: ProjectRepresentationRecord }> {
  const response = await apiFetch("/api/mapping/diagrams", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}

export async function publishMappingCheckpoint(input: import('../../../../domain/core/diagrams/checkpointPublication').CheckpointPublication): Promise<import('../../../../domain/core/diagrams/checkpointPublication').CheckpointReceipt> {
  const response = await apiFetch('/api/mapping/diagrams/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
