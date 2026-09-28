import { documentFromHistory, type CanvasHistoryRecord } from './canvasHistory';
import { createDiagram, validateDiagram, diagramSource, type DiagramSourceBinding } from "./diagram";
import {
  composeScene,
  flattenGrid,
  measureContent,
  resolveScene,
  type LineGridScene
} from "./lineGrid";
import type { ProjectRepresentationEvidenceRecord, ProjectRepresentationMappingRecord, ProjectRepresentationRevisionRecord } from "../representations/projectCatalog";

export type ProjectDiagramContent = { kind: "canvas-history"; history: CanvasHistoryRecord } | { kind: "diagram"; diagram: import("./diagram").Diagram } | { kind: "ascii"; ascii: string } | { kind: "mapping-canvas"; scene: LineGridScene; edges?: import('./diagramConnection').DiagramConnection[] };
export interface SaveProjectDiagramInput {
  history?: CanvasHistoryRecord;
  projectId?: string;
  representationId?: string;
  expectedRevisionId?: string;
  sourceRevisionId?: string;
  name: string;
  scene: LineGridScene;
  edges?: import('./diagramConnection').DiagramConnection[];
}

export function singleDiagramScene(ascii: string, source?: DiagramSourceBinding): LineGridScene {
  return { contents: {
    overview: createDiagram({ id: "overview", revision: 0, ascii, source }),
    "overview-summary": createDiagram({ id: "overview-summary", revision: 0, ascii: "[Diagram]" })
  }, root: { id: "root", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: "push-right", gap: 3 }, children: [
      { id: "overview", kind: "diagram", position: { column: 0, row: 0 }, collapsed: false,
        contentId: "overview", collapsedContentId: "overview-summary" }
    ] } };
}

export function sceneFromRevision(revision: ProjectRepresentationRevisionRecord): LineGridScene {
  if (revision.content?.kind === "canvas-history") return documentFromHistory(revision.content.history).scene;
  if (revision.content?.kind === "mapping-canvas") return revision.content.scene;
  const scene = singleDiagramScene(revision.ascii);
  if (revision.content?.kind === "diagram") return { ...scene, contents: { ...scene.contents, overview: revision.content.diagram } };
  scene.contents = { ...scene.contents, overview: createDiagram({ id: "overview", revision: revision.revision,
    ascii: revision.ascii, structureKind: revision.representationKind, source: revision.source,
    evidence: revision.evidence, mappings: revision.mappings.map((mapping) => ({
      id: mapping.id, entityId: mapping.evidenceId, sourceRangeId: mapping.sourceRangeId,
      sourceRangeIndex: revision.evidence[mapping.evidenceId]?.sourceRanges.findIndex(range => range.id === mapping.sourceRangeId) ?? -1,
      line: mapping.line, startColumn: mapping.startColumn, endColumn: mapping.endColumn
    })) }) };
  return scene;
}

/** Validate all content (including collapsed content), then derive the visible export. */
export function projectCanvasSnapshot(scene: LineGridScene) {
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
  const evidence: Record<string, ProjectRepresentationEvidenceRecord> = {};
  const evidenceIds = new Map<string, string>();
  for (const [id, diagram] of Object.entries(scene.contents)) {
    if (diagram.id !== id || !Number.isInteger(diagram.revision) || diagram.revision < 0 || !diagram.content) throw new Error("Invalid canvas diagram");
    validateDiagram(diagram);
    measureContent(diagram.content.ascii);
    for (const [key, entry] of Object.entries(diagram.sourceContext.evidence)) {
      // Export IDs are scoped by source and diagram. Local evidence IDs remain untouched.
      const exported = exportedEvidenceId(scene, id, key);
      evidenceIds.set(`${id}:${key}`, exported);
      evidence[exported] = { ...structuredClone(entry), id: exported, sourceId: diagram.sourceContext.binding?.sourceId };
    }
  }
  const ascii = composeScene(scene);
  const mappings: ProjectRepresentationMappingRecord[] = [];
  for (const node of flattenGrid(resolveScene(scene))) {
    if (!node.contentId) continue;
    const diagram = scene.contents[node.contentId];
    for (const {mapping, range} of diagramSource(diagram).entries()) {
      mappings.push({ id: `${node.box.id}:${mapping.id}`, evidenceId: evidenceIds.get(`${diagram.id}:${mapping.entityId}`)!,
        sourceRangeId: range.id, line: node.bounds.row + mapping.line,
        startColumn: node.bounds.column + mapping.startColumn, endColumn: node.bounds.column + mapping.endColumn });
    }
  }
  return { ascii, mappings, evidence };
}

/** Catalog export addresses; diagram-local IDs remain stable inside source contexts. */
export function exportedEvidenceId(scene: LineGridScene, diagramId: string, evidenceId: string): string {
  const owners = Object.values(scene.contents).filter(d => d.sourceContext.evidence[evidenceId]);
  const signatures = new Set(owners.map(d => JSON.stringify([d.sourceContext.binding?.sourceId, d.sourceContext.evidence[evidenceId]])));
  return signatures.size > 1 ? `${diagramId}:${evidenceId}` : evidenceId;
}

export function edgesFromRevision(revision: ProjectRepresentationRevisionRecord) {
  return revision.content?.kind === 'canvas-history' ? documentFromHistory(revision.content.history).edges
    : revision.content?.kind === 'mapping-canvas' ? revision.content.edges ?? [] : [];
}
export function historyFromRevision(revision: ProjectRepresentationRevisionRecord) {
  return revision.content?.kind === 'canvas-history' ? structuredClone(revision.content.history) : undefined;
}

export function documentFromRevision(revision: ProjectRepresentationRevisionRecord) {
  return revision.content?.kind === 'canvas-history' ? documentFromHistory(revision.content.history)
    : { scene: sceneFromRevision(revision), edges: edgesFromRevision(revision), sections: {} };
}
