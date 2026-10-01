import { documentFromHistory, type CanvasHistoryRecord } from './canvasHistory';
import { validateDiagram, diagramSource, type Diagram, type DiagramSourceBinding } from './diagram';
import { RevisionedDiagramService } from './diagramService';
import {
  composeScene,
  flattenGrid,
  measureContent,
  resolveScene,
  type LineGridScene
} from "./lineGrid";
import type { ProjectRepresentationEvidenceRecord, ProjectRepresentationMappingRecord, ProjectRepresentationRevisionRecord } from "../representations/projectCatalog";

export type ProjectDiagramContent = { kind: "canvas-history"; history: CanvasHistoryRecord };
export interface SaveProjectDiagramInput {
  history: CanvasHistoryRecord;
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
    overview: new RevisionedDiagramService().create({ id: "overview", revision: 0, ascii, source }).diagram,
    "overview-summary": new RevisionedDiagramService().create({ id: "overview-summary", revision: 0, ascii: "[Diagram]" }).diagram
  }, root: { id: "root", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: "push-right", gap: 3 }, children: [
      { id: "overview", kind: "diagram", position: { column: 0, row: 0 }, collapsed: false,
        contentId: "overview", collapsedContentId: "overview-summary" }
    ] } };
}

export function sceneFromRevision(revision: ProjectRepresentationRevisionRecord): LineGridScene {
  return documentFromHistory(historyFromRevision(revision)).scene;
}

/** Validate composition without generating an ASCII/source-evidence export. */
export function validateCanvasScene(scene: LineGridScene, validatedDiagrams?: ReadonlySet<Diagram>) {
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
  for (const [id, diagram] of Object.entries(scene.contents)) {
    if (diagram.id !== id || !Number.isInteger(diagram.revision) || diagram.revision < 0 || !diagram.content) throw new Error("Invalid canvas diagram");
    if (!validatedDiagrams?.has(diagram)) validateDiagram(diagram);
    measureContent(diagram.content.ascii);
  }
}

/** Validate all content (including collapsed content), then derive the visible export. */
export function projectCanvasSnapshot(scene: LineGridScene) {
  validateCanvasScene(scene);
  const evidence: Record<string, ProjectRepresentationEvidenceRecord> = {};
  const evidenceIds = new Map<string, string>();
  for (const [id, diagram] of Object.entries(scene.contents)) {
    for (const [key, entry] of Object.entries(diagram.sourceContext.evidence)) {
      // Export IDs are scoped by source and diagram. Local evidence IDs remain untouched.
      const exported = exportedEvidenceId(scene, id, key);
      evidenceIds.set(`${id}:${key}`, exported);
      evidence[exported] = { ...structuredClone(entry), sourceRanges: entry.sourceRanges.map(range => ({ ...range, originalLines: [...range.originalLines] })), id: exported, sourceId: diagram.sourceContext.binding?.sourceId };
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
  return documentFromHistory(historyFromRevision(revision)).edges;
}
export function historyFromRevision(revision: ProjectRepresentationRevisionRecord): CanvasHistoryRecord {
  if (revision.content?.kind !== 'canvas-history') throw new Error('Unsupported legacy diagram content: canvas history is required');
  return structuredClone(revision.content.history);
}
export function documentFromRevision(revision: ProjectRepresentationRevisionRecord) {
  return documentFromHistory(historyFromRevision(revision));
}
