import { mappingDocumentFromScene } from "./mappingDocument";

import {
  layoutScene,
  updateGridBox,
  type CanvasDiagram,
  type GridBox,
  type LineGridScene
} from "../../core/diagrams/lineGrid";
import { MAPPING_POC_A_NODES, MAPPING_POC_GRAPH_A, type MappingPocANode } from "../selection/mappingPoc";
import { MAPPING_POC_A_SECTIONS, type MappingPocASection } from "../selection/mappingPocOverlays";

export interface MappingGridDocument {
  scene: LineGridScene;
  evidence?: Record<string, import("../../core/representations/projectCatalog").ProjectRepresentationEvidenceRecord>;
  nodes: Readonly<Record<string, readonly MappingPocANode[]>>;
  sections: Readonly<Record<string, readonly MappingPocASection[]>>;
}

export function initialMappingGrid(): MappingGridDocument {
  const content: CanvasDiagram = {
    id: "overview", revision: 0, ascii: MAPPING_POC_GRAPH_A,
    mappings: MAPPING_POC_A_NODES.flatMap((node) => node.sourceRanges.map((_, sourceRangeIndex) => ({
      id: `${node.id}:range-${sourceRangeIndex + 1}`, entityId: node.id, sourceRangeIndex,
      ...node.head
    })))
  };
  return {
    scene: { contents: { overview: content, "overview-summary": { id: "overview-summary", revision: 0,
      ascii: "[Current LLM prompt stack]", mappings: [] } },
      root: { id: "root", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
        layout: { collisionPolicy: "push-right", gap: 3 }, children: [{ id: "overview", kind: "diagram",
          position: { column: 0, row: 0 }, collapsed: false, contentId: "overview", collapsedContentId: "overview-summary" }] }
    },
    nodes: { overview: MAPPING_POC_A_NODES }, sections: { overview: MAPPING_POC_A_SECTIONS }
  };
}

export function generatedGridNodes(content: CanvasDiagram): MappingPocANode[] {
  return content.mappings.map((mapping) => {
    const source = MAPPING_POC_A_NODES.find((node) => node.id === mapping.entityId);
    const range = source?.sourceRanges[mapping.sourceRangeIndex];
    return {
      id: `${content.id}:${mapping.id}`, label: content.ascii.split("\n")[mapping.line - 1].slice(mapping.startColumn - 1, mapping.endColumn),
      head: { line: mapping.line, startColumn: mapping.startColumn, endColumn: mapping.endColumn },
      extent: { startLine: mapping.line, endLine: mapping.line },
      selectableBecause: "mapped", sourceRanges: range ? [range] : [], mappedBNodeIds: source?.mappedBNodeIds ?? []
    };
  });
}

export function insertGridDiagram(document: MappingGridDocument, parentId: string, box: GridBox, content: CanvasDiagram): MappingGridDocument {
  const summaryId = `${content.id}-summary`;
  let scene: LineGridScene = { ...document.scene, contents: { ...document.scene.contents, [content.id]: content,
    [summaryId]: { id: summaryId, revision: 0, ascii: `[${content.ascii.split("\n")[0].trim().slice(0, 36)}]`, mappings: [] } } };
  scene = updateGridBox(scene, parentId, (parent) => {
    if (parent.kind !== "container") throw new Error("Diagrams must be inserted into a container");
    return { ...parent, collapsed: false, children: [...parent.children, { ...box, collapsedContentId: summaryId }] };
  });
  return { ...document, scene: layoutScene(scene, box.id), nodes: { ...document.nodes, [content.id]: (document.evidence ? mappingDocumentFromScene(scene, document.evidence).nodes[content.id] : generatedGridNodes(content)) },
    sections: { ...document.sections, [content.id]: [] } };
}
