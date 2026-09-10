import type { ProjectRepresentationsSnapshot } from "../core/api";
import { apiFetch, errorFrom } from "../core/http";
import type { ProjectRepresentationRecord } from "../core/projectCatalog";
import type { SaveProjectDiagramInput } from "../core/projectDiagramCanvas";

export async function saveMappingProjectDiagram(input: SaveProjectDiagramInput): Promise<ProjectRepresentationsSnapshot & { representation: ProjectRepresentationRecord }> {
  const response = await apiFetch("/api/mapping/diagrams", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
