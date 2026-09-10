import seed from "../data/project-snapshot.json";
import extraction from "../data/extraction.json";
import type { ProjectRecord } from "./domain";
import type { ProjectRepresentationCatalogRecord, ProjectRepresentationRecord, ProjectRepresentationRevisionRecord } from "./projectCatalog";
import { projectCanvasSnapshot, type SaveProjectDiagramInput } from "./projectDiagramCanvas";

export interface MappingProjectSnapshot { project: ProjectRecord | null; catalog: ProjectRepresentationCatalogRecord | null }
export const STORAGE_KEY = `mapping-ux-app:project:v2:${extraction.primaryDiagramId}:${seed.catalog.representations[extraction.primaryDiagramId as keyof typeof seed.catalog.representations].currentRevisionId}`;
export async function loadMappingProject(): Promise<MappingProjectSnapshot> {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : structuredClone(seed) as MappingProjectSnapshot;
}
export async function saveMappingProjectDiagram(input: SaveProjectDiagramInput): Promise<MappingProjectSnapshot & { representation: ProjectRepresentationRecord }> {
  const snapshot = await loadMappingProject();
  const project = snapshot.project!;
  const catalog = snapshot.catalog!;
  if (input.projectId && input.projectId !== project.id) throw new Error("Diagram belongs to another project");
  if (!input.name.trim() || input.name.length > 120) throw new Error("Enter a diagram name of 1–120 characters");
  const current = input.representationId ? catalog.representations[input.representationId] : undefined;
  if (input.representationId && !current) throw new Error("Diagram not found");
  if (current && current.currentRevisionId !== input.expectedRevisionId) throw new Error("The saved diagram changed. Reload before saving.");
  const sourceId = current?.currentRevisionId ?? input.sourceRevisionId;
  const source = sourceId ? catalog.revisions[sourceId] : undefined;
  if (sourceId && !source) throw new Error("Source revision not found");
  const evidence = source?.evidence ?? {};
  const scene = structuredClone(input.scene);
  const { ascii, mappings } = projectCanvasSnapshot(scene, evidence);
  const timestamp = new Date().toISOString();
  const id = current?.id ?? `representation-${crypto.randomUUID()}`;
  const revisionId = `representation-revision-${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ascii));
  const revision: ProjectRepresentationRevisionRecord = {
    schemaVersion: 1, id: revisionId, projectId: project.id, representationId: id,
    revision: (current?.revisionIds.length ?? 0) + 1, ascii,
    asciiSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
    content: { kind: "mapping-canvas", scene }, representationKind: source?.representationKind ?? "diagram",
    evidence, mappings, createdAt: timestamp, ...(source?.provenance ? { provenance: source.provenance } : {})
  };
  const representation: ProjectRepresentationRecord = {
    schemaVersion: 1, id, projectId: project.id, handle: current?.handle ?? id,
    name: input.name.trim(), viewKind: current?.viewKind ?? "diagram", representationKind: revision.representationKind,
    status: "settled", currentRevisionId: revisionId, revisionIds: [...(current?.revisionIds ?? []), revisionId],
    createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp
  };
  catalog.representations[id] = representation;
  catalog.revisions[revisionId] = revision;
  catalog.updatedAt = timestamp;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  return { ...snapshot, representation };
}
