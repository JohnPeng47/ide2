import { stateKey } from '../../core/diagrams/canvasHistory';
import { documentFromRevision, historyFromRevision } from '../../core/diagrams/projectDiagramCanvas';
import type { ProjectRepresentationCatalogRecord } from '../../core/representations/projectCatalog';
import type { MappingDocumentSnapshot } from './mappingWorkspace';

/** Only advance unchanged drafts. Never mix a newer document with older history. */
export function reconcileWorkspaceDocument(doc: MappingDocumentSnapshot, catalog: ProjectRepresentationCatalogRecord) {
  const representation = catalog.representations[doc.savedRepresentationId ?? doc.representationId];
  const latest = representation && catalog.revisions[representation.currentRevisionId];
  if (!latest || representation.status !== 'settled' || latest.id === doc.revisionId) return { document: doc, newerRevision: false };
  const previous = catalog.revisions[doc.revisionId];
  const dirty = doc.name !== doc.savedName
    || stateKey(doc.document.scene) !== stateKey(JSON.parse(doc.savedScene))
    || stateKey(doc.document.edges) !== stateKey(JSON.parse(doc.savedEdges ?? '[]'))
    || stateKey(doc.document.sections) !== stateKey(previous ? documentFromRevision(previous).sections : {});
  if (dirty) return { document: doc, newerRevision: true };
  const document = documentFromRevision(latest);
  return { newerRevision: false, document: { ...doc, document, history: historyFromRevision(latest),
    name: representation.name, savedName: representation.name, revisionId: latest.id,
    savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges) } };
}
