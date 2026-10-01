import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { expect, it } from 'vitest';
import { reconcileWorkspaceDocument } from '../reconcileWorkspace';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState, type MappingDocumentSnapshot } from '../mappingWorkspace';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { CanvasHistory } from '../../../core/diagrams/canvasHistory';
import type { ProjectRepresentationCatalogRecord } from '../../../core/representations/projectCatalog';

function fixture() {
  const document = mappingDocumentFromScene(singleDiagramScene('Root'));
  const doc: MappingDocumentSnapshot = { representationId: 'rep', revisionId: 'old', name: 'Name', savedName: 'Name',
    savedScene: JSON.stringify(document.scene), savedEdges: '[]', document, canvas: initialCanvasState(),
    history: new CanvasHistory(document, initialCanvasState()).export(), viewport: { offset: { x: 10, y: 20 }, scale: 1 } };
  const latest = structuredClone(document);
  latest.scene.contents = { ...latest.scene.contents, overview: new RevisionedDiagramService().revise(latest.scene.contents.overview.revisionId, { kind: 'source-mappings', expectedContentHash: latest.scene.contents.overview.content.asciiSha256,
    mappings: [{id:'m',entityId:'e',sourceRangeIndex:0,line:1,startColumn:1,endColumn:4}],
    evidence: {e:{id:'e',handle:'Root',label:'Root',category:'operation',summary:'Root',sourceRanges:[{id:'r',path:'root.ts',startLine:1,endLine:1,originalLines:['function Root() {}']}]}} }).diagram };
  const catalog = { representations: {rep:{id:'rep',status:'settled',name:'Latest',currentRevisionId:'new'}}, revisions: {
    old:{id:'old',content:{kind:'canvas-history',history:doc.history}}, new:{id:'new',content:{kind:'canvas-history',history:new CanvasHistory(latest, initialCanvasState()).export()}}
  } } as unknown as ProjectRepresentationCatalogRecord;
  return {doc,catalog,latest};
}
it('loads newer source mappings for an unchanged restored draft with its corresponding history', () => {
  const {doc,catalog,latest} = fixture();
  const next = reconcileWorkspaceDocument(doc,catalog);
  expect(next.newerRevision).toBe(false);
  expect(next.document.document).toEqual(latest);
  expect(next.document.revisionId).toBe('new');
  expect(next.document.history).toEqual(catalog.revisions.new.content?.kind === 'canvas-history' ? catalog.revisions.new.content.history : undefined);
  expect(next.document.viewport).toEqual(doc.viewport);
  expect(JSON.parse(next.document.savedScene)).toEqual(latest.scene);
  expect(doc.revisionId).toBe('old');
});
it('preserves local content, name, edge, or section edits and reports the newer revision', () => {
  for (const edit of [
    (d: MappingDocumentSnapshot) => {d.name='Local';},
    (d: MappingDocumentSnapshot) => {d.document.scene.root.position.column=3;},
    (d: MappingDocumentSnapshot) => {d.savedEdges='[{"id":"removed"}]';},
    (d: MappingDocumentSnapshot) => {d.document.sections={overview:[{id:'s',label:'Local',startLine:1,endLine:1,anchorToken:'Root'}]};}
  ]) {
    const {doc,catalog} = fixture(); edit(doc);
    expect(reconcileWorkspaceDocument(doc,catalog)).toEqual({document:doc,newerRevision:true});
  }
});
it('keeps current drafts and saved draft aliases intact', () => {
  const {doc,catalog} = fixture();
  doc.savedRepresentationId='rep'; doc.representationId='draft-local';
  expect(reconcileWorkspaceDocument(doc,catalog).document.representationId).toBe('draft-local');
  doc.revisionId='new';
  expect(reconcileWorkspaceDocument(doc,catalog).document).toBe(doc);
});
