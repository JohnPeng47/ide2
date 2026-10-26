import type { DiagramPresentations } from '../../core/presentation/diagramPresentation';
import { createStoredDiagram } from '../../core/diagrams/diagramRevisionStore';

import {
  layoutScene,
  updateGridBox,
  type Diagram,
  type GridBox,
  type LineGridScene
} from "../../core/diagrams/lineGrid";
import { MAPPING_POC_A_NODES, MAPPING_POC_GRAPH_A } from "../selection/mappingPoc";
import { MAPPING_POC_A_SECTIONS, type MappingPocASection } from "../selection/mappingPocOverlays";

export interface MappingGridDocument {
  alternatives?: import('../../core/presentation/diagramAlternative').DiagramAlternatives;
  diagramPresentations?: DiagramPresentations;
  diagramContexts?: Record<string, import('../../core/diagrams/diagramAgentContext').DiagramAgentContext>;
  revisionSelections?: Record<string, import('../../core/diagrams/diagramRevisionSelection').DiagramRevisionSelection>;
  revisionReviews?: Record<string, import('../../core/diagrams/diagramRevisionReview').DiagramRevisionReview>;
  jumps?: import('../../core/diagrams/canvasJump').CanvasJump[];
  scene: LineGridScene;
  edges: import('../../core/diagrams/diagramConnection').DiagramConnection[];
  sections: Readonly<Record<string, readonly MappingPocASection[]>>;
}

export function initialMappingGrid(): MappingGridDocument {
  const evidence = Object.fromEntries(MAPPING_POC_A_NODES.map(node => [node.id, { id: node.id, handle: node.id, label: node.label, category: "operation" as const, summary: node.label, sourceRanges: node.sourceRanges.map((range,i) => ({ ...range, id: `${node.id}-range-${i}`, originalLines: Array.from({length:range.endLine-range.startLine+1},()=>"") })) }]));
  const content = createStoredDiagram({ evidence,
    id: "overview", revision: 0, ascii: MAPPING_POC_GRAPH_A,
    mappings: MAPPING_POC_A_NODES.flatMap((node) => node.sourceRanges.map((_, sourceRangeIndex) => ({
      id: `${node.id}:range-${sourceRangeIndex + 1}`, entityId: node.id, sourceRangeIndex,
      ...node.head
    })))
  }).diagram;
  return {
    edges: [],
    scene: { contents: { overview: content, "overview-summary": createStoredDiagram({ id: "overview-summary", revision: 0, ascii: "[Current LLM prompt stack]" }).diagram },
      root: { id: "root", kind: "container", position: { column: 0, row: 0 }, collapsed: false,
        layout: { collisionPolicy: "push-right", gap: 3 }, children: [{ id: "overview", kind: "diagram",
          position: { column: 0, row: 0 }, collapsed: false, contentId: "overview", collapsedContentId: "overview-summary" }] }
    },
    sections: { overview: MAPPING_POC_A_SECTIONS }
  };
}

export function insertGridDiagram(document: MappingGridDocument, parentId: string, box: GridBox, content: Diagram): MappingGridDocument {
  const summaryId = `${content.id}-summary`;
  let scene: LineGridScene = { ...document.scene, contents: { ...document.scene.contents, [content.id]: content,
    [summaryId]: createStoredDiagram({ id: summaryId, revision: 0, ascii: `[${content.content.ascii.split("\n")[0].trim().slice(0, 36)}]` }).diagram } };
  scene = updateGridBox(scene, parentId, (parent) => {
    if (parent.kind !== "container") throw new Error("Diagrams must be inserted into a container");
    return { ...parent, collapsed: false, children: [...parent.children, { ...box, collapsedContentId: summaryId }] };
  });
  return { ...document, scene: layoutScene(scene, box.id), sections: { ...document.sections, [content.id]: [] } };
}
