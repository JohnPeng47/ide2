import { createDiagram, type DiagramSourceBinding } from '../../domain/core/diagrams/diagram';
import { singleDiagramScene } from '../../domain/core/diagrams/projectDiagramCanvas';
import type { ProjectRepresentationEvidenceRecord, ProjectRepresentationMappingRecord } from '../../domain/core/representations/projectCatalog';
import type { ProjectCatalogRepository } from '../../application/core/ports/projectCatalogRepository';

export interface MappingDiagramFixture {
  projectId: string;
  name: string;
  ascii: string;
  source?: DiagramSourceBinding;
  representationKind?: 'diagram' | 'tree';
  representationId?: string;
  expectedRevisionId?: string;
  evidence?: Record<string, ProjectRepresentationEvidenceRecord>;
  mappings?: ProjectRepresentationMappingRecord[];
}

/** Set up source-backed test data through the same save operation as Mapping. */
export function saveDiagramFixture(store: ProjectCatalogRepository, input: MappingDiagramFixture) {
  const evidence = input.evidence ?? {};
  const scene = singleDiagramScene(input.ascii);
  scene.contents = { ...scene.contents, overview: createDiagram({
    id: 'overview', revision: 0, ascii: input.ascii, source: input.source,
    structureKind: input.representationKind ?? 'diagram', evidence,
    mappings: (input.mappings ?? []).map(m => ({
      id: m.id, entityId: m.evidenceId, sourceRangeId: m.sourceRangeId,
      sourceRangeIndex: evidence[m.evidenceId].sourceRanges.findIndex(r => r.id === m.sourceRangeId),
      line: m.line, startColumn: m.startColumn, endColumn: m.endColumn
    }))
  }) };
  return store.saveMappingDiagram(input.projectId, {
    name: input.name, scene, representationId: input.representationId, expectedRevisionId: input.expectedRevisionId
  });
}
