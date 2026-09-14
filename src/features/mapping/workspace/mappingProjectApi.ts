import type { ProjectRepresentationsSnapshot } from "../../../shared/http/api";
import { apiFetch, errorFrom } from "../../../shared/http/http";
import type { ProjectRepresentationRecord } from "../../../../domain/core/representations/projectCatalog";
import type { SaveProjectDiagramInput } from "../../../../domain/core/diagrams/projectDiagramCanvas";

export async function saveMappingProjectDiagram(input: SaveProjectDiagramInput): Promise<ProjectRepresentationsSnapshot & { representation: ProjectRepresentationRecord }> {
  const response = await apiFetch("/api/mapping/diagrams", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
  });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
