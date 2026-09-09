import type { ProjectRecord } from "./domain";
import type { ProjectRepresentationCatalogRecord, ProjectRepresentationRecord } from "./projectCatalog";
import type { SaveProjectDiagramInput } from "./projectDiagramCanvas";

export interface MappingProjectSnapshot { project: ProjectRecord | null; catalog: ProjectRepresentationCatalogRecord | null }
async function request(init?: RequestInit) {
  const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/internal/mapping/diagrams`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load project diagrams");
  return result;
}
export function loadMappingProject(): Promise<MappingProjectSnapshot> { return request({ cache: "no-store" }); }
export function saveMappingProjectDiagram(input: SaveProjectDiagramInput): Promise<MappingProjectSnapshot & { representation: ProjectRepresentationRecord }> {
  return request({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}
