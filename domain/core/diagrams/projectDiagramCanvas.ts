import { validateDiagramLocalMappings } from "./diagramMappings";
import {
  composeScene,
  flattenGrid,
  measureContent,
  resolveScene,
  type LineGridScene
} from "./lineGrid";
import type { ProjectRepresentationEvidenceRecord, ProjectRepresentationMappingRecord, ProjectRepresentationRevisionRecord } from "../representations/projectCatalog";

export type ProjectDiagramContent = { kind: "ascii"; ascii: string } | { kind: "mapping-canvas"; scene: LineGridScene };
export interface SaveProjectDiagramInput {
  projectId?: string;
  representationId?: string;
  expectedRevisionId?: string;
  sourceRevisionId?: string;
  name: string;
  scene: LineGridScene;
}

export function singleDiagramScene(ascii: string): LineGridScene {
  return { contents: {
    overview: { id: "overview", revision: 0, ascii, mappings: [] },
    "overview-summary": { id: "overview-summary", revision: 0, ascii: "[Diagram]", mappings: [] }
  }, root: { id: "root", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: "push-right", gap: 3 }, children: [
      { id: "overview", kind: "diagram", position: { column: 0, row: 0 }, collapsed: false,
        contentId: "overview", collapsedContentId: "overview-summary" }
    ] } };
}

export function sceneFromRevision(revision: ProjectRepresentationRevisionRecord): LineGridScene {
  if (revision.content?.kind === "mapping-canvas") return revision.content.scene;
  const scene = singleDiagramScene(revision.ascii);
  scene.contents.overview.mappings = revision.mappings.map((mapping) => ({
    id: mapping.id, entityId: mapping.evidenceId, sourceRangeId: mapping.sourceRangeId,
    sourceRangeIndex: revision.evidence[mapping.evidenceId]?.sourceRanges.findIndex((range) => range.id === mapping.sourceRangeId) ?? -1,
    line: mapping.line, startColumn: mapping.startColumn, endColumn: mapping.endColumn
  }));
  return scene;
}

/** Validate all content (including collapsed content), then derive the visible export. */
export function projectCanvasSnapshot(scene: LineGridScene, evidence: Record<string, ProjectRepresentationEvidenceRecord>) {
  if (!scene || !scene.contents || !scene.root || Object.keys(scene.contents).length > 500) throw new Error("Invalid Mapping canvas");
  let boxes = 0;
  const walk = (box: LineGridScene["root"], depth = 0) => {
    if (!box || depth > 32 || ++boxes > 1000 || typeof box.id !== "string" || !box.id) throw new Error("Invalid canvas hierarchy");
    if (box.kind !== "diagram" && box.kind !== "container") throw new Error("Invalid canvas box kind");
    if (typeof box.collapsed !== "boolean") throw new Error("Invalid collapsed state");
    if (box.collapsedContentId && !scene.contents[box.collapsedContentId]) throw new Error("Unknown collapsed canvas content");
    if (box.kind === "container") {
      if (!Array.isArray(box.children) || !box.layout || box.layout.collisionPolicy !== "push-right") throw new Error("Invalid canvas container");
      box.children.forEach((child) => walk(child, depth + 1));
    }
  };
  walk(scene.root);
  // Also resolve the expanded hierarchy so hidden children cannot bypass validation.
  const expand = (box: LineGridScene["root"]): LineGridScene["root"] => box.kind === "container"
    ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
  resolveScene({ ...scene, root: expand(scene.root) });
  for (const [id, content] of Object.entries(scene.contents)) {
    if (content.id !== id || !Number.isInteger(content.revision) || content.revision < 0 || typeof content.ascii !== "string"
      || !content.ascii.trim() || content.ascii.length > 20000 || !Array.isArray(content.mappings)) throw new Error("Invalid canvas content");
    measureContent(content.ascii);
    validateDiagramLocalMappings(content.ascii, content.mappings);
    for (const mapping of content.mappings) {
      const range = evidence[mapping.entityId]?.sourceRanges[mapping.sourceRangeIndex];
      if (!range || (mapping.sourceRangeId && range.id !== mapping.sourceRangeId)) throw new Error("Canvas mapping references unknown project evidence");
    }
  }
  if (!flattenGrid(resolveScene(scene)).some((node) => node.contentId)) throw new Error("Canvas must contain a visible diagram");
  const ascii = composeScene(scene);
  const mappings: ProjectRepresentationMappingRecord[] = [];
  for (const node of flattenGrid(resolveScene(scene))) {
    if (!node.contentId) continue;
    for (const mapping of scene.contents[node.contentId].mappings) {
      mappings.push({ id: `${node.box.id}:${mapping.id}`, evidenceId: mapping.entityId,
        sourceRangeId: evidence[mapping.entityId].sourceRanges[mapping.sourceRangeIndex].id,
        line: node.bounds.row + mapping.line,
        startColumn: node.bounds.column + mapping.startColumn, endColumn: node.bounds.column + mapping.endColumn });
    }
  }
  return { ascii, mappings };
}
