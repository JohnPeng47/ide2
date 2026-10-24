import { DefaultCanvasHistoryService } from '../../domain/core/diagrams/canvasHistoryService';
import type { SaveProjectDiagramInput } from '../../domain/core/diagrams/projectDiagramCanvas';
import { type DiagramSourceBinding } from '../../domain/core/diagrams/diagram';
import { revisionFixture } from './diagramRevisions';
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
  scene.contents = { ...scene.contents, overview: revisionFixture().create({
    id: 'overview', revision: 0, ascii: input.ascii, source: input.source,
    structureKind: input.representationKind ?? 'diagram', evidence,
    mappings: (input.mappings ?? []).map(m => ({
      id: m.id, entityId: m.evidenceId, sourceRangeId: m.sourceRangeId,
      sourceRangeIndex: evidence[m.evidenceId].sourceRanges.findIndex(r => r.id === m.sourceRangeId),
      line: m.line, startColumn: m.startColumn, endColumn: m.endColumn
    }))
  }).diagram };
  return store.saveMappingDiagram(input.projectId, canvasSaveFixture({
    name: input.name, scene, representationId: input.representationId, expectedRevisionId: input.expectedRevisionId
  }));
}

/** Explicit initial checkpoint for fixtures that create a canvas before saving it. */
export function canvasSaveFixture(input: Omit<SaveProjectDiagramInput, 'history'>): SaveProjectDiagramInput {
  const histories = new DefaultCanvasHistoryService();
  return { ...input, history: histories.exportContext(histories.openContext({ scene: input.scene, edges: input.edges ?? [], sections: {} }, {})) };
}

type MutableFixture<T> = { -readonly [K in keyof T]: T[K] extends object ? MutableFixture<T[K]> : T[K] };
/** Deliberately detached transport data for corruption and parser compatibility tests. */
export function mutableFixture<T>(value: T): MutableFixture<T> {
  return structuredClone(value) as MutableFixture<T>;
}

/** Build a current canvas fixture from an ASCII/evidence specimen. */
export function revisionCanvasFixture(revision: import('../../domain/core/representations/projectCatalog').ProjectRepresentationRevisionRecord) {
  const scene = singleDiagramScene(revision.ascii);
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 0,
    ascii: revision.ascii, structureKind: revision.representationKind, source: revision.source, evidence: revision.evidence,
    mappings: revision.mappings.map(m => ({ id: m.id, entityId: m.evidenceId, sourceRangeId: m.sourceRangeId,
      sourceRangeIndex: revision.evidence[m.evidenceId].sourceRanges.findIndex(r => r.id === m.sourceRangeId),
      line: m.line, startColumn: m.startColumn, endColumn: m.endColumn })) }).diagram };
  return { kind: 'canvas-history' as const, history: canvasSaveFixture({ name: 'Fixture', scene }).history };
}

export { singleDiagramScene };
