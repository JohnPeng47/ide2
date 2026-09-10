import type { LineGridScene } from "../core/lineGrid";
import type { ProjectRepresentationEvidenceRecord } from "../core/projectCatalog";
import type { MappingGridDocument } from "./mappingGrid";
export function mappingDocumentFromScene(scene: LineGridScene, evidence: Record<string, ProjectRepresentationEvidenceRecord>): MappingGridDocument {
  return { scene, evidence, sections: {}, nodes: Object.fromEntries(Object.values(scene.contents).map((content) => [content.id,
    content.mappings.map((mapping) => {
      const entity = evidence[mapping.entityId];
      const range = entity?.sourceRanges[mapping.sourceRangeIndex];
      return { id: `${content.id}:${mapping.id}`, label: entity?.label ?? mapping.entityId,
        head: { line: mapping.line, startColumn: mapping.startColumn, endColumn: mapping.endColumn },
        extent: { startLine: mapping.line, endLine: mapping.line }, selectableBecause: "mapped" as const,
        sourceRanges: range ? [range] : [], mappedBNodeIds: [] };
    })
  ])) };
}
