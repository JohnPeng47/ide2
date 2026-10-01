import { expect, it } from 'vitest';
import { addDisplayNode, displayGeometry, emptyDisplayState, type ProjectedPane } from '../../../../../domain/mapping/workspace/displayModel';
import { updateSourceCodePane } from '../sourceCodePane';
import { initialCanvasState, type MappingWorkspaceSnapshot } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { initialMappingGrid } from '../../../../../domain/mapping/workspace/mappingGrid';
import { deserializeWorkspace, serializeWorkspace } from '../../../../../domain/mapping/workspace/mappingWorkspaceCodec';

function fixture() {
  const pane: ProjectedPane = { ...displayGeometry(), id: 'source', kind: 'projection', title: 'Source', childIds: [], expansion: 'expanded',
    content: { kind: 'source-code', projectId: 'project', sourceFile: 'a.ts', files: [], showCompactions: false, rangeIndex: 0 } };
  const document = initialMappingGrid(), canvas = initialCanvasState();
  canvas.display = addDisplayNode(emptyDisplayState(), pane);
  const snapshot: MappingWorkspaceSnapshot = { schemaVersion: 3, projectId: 'project', documents: [{ representationId: 'diagram',
    name: 'Diagram', revisionId: 'revision', savedName: 'Diagram', savedScene: JSON.stringify(document.scene), document, canvas }] };
  return snapshot;
}
it('navigates repository files without a compaction parent and persists source navigation state', () => {
  const snapshot = fixture(), canvas = snapshot.documents[0].canvas;
  canvas.display = updateSourceCodePane(canvas.display, 'source', { sourceFile: 'unmapped/helper.ts', scroll: { top: 240, left: 10 } });
  expect(canvas.display.nodes.source).toMatchObject({ title: 'unmapped/helper.ts', content: { sourceFile: 'unmapped/helper.ts' } });
  expect(deserializeWorkspace(serializeWorkspace(snapshot))).toEqual(snapshot);
  expect(updateSourceCodePane(canvas.display, 'source', { sourceFile: '../outside.ts' })).toBe(canvas.display);
});
it('rejects invalid source snapshots', () => {
  for (const patch of [{ sourceFile: '../outside.ts' }, { projectId: 'other-project' }, { rangeIndex: -1 }, { showCompactions: 'yes' }, { scroll: { top: -1, left: 0 } }]) {
    const snapshot = fixture(); Object.assign((snapshot.documents[0].canvas.display.nodes.source as ProjectedPane).content, patch);
    expect(() => deserializeWorkspace(snapshot)).toThrow('Invalid workspace');
  }
});
it('imports saved compaction presentation once, preserving source folds', () => {
  const snapshot = fixture(); const node = snapshot.documents[0].canvas.display.nodes.source as ProjectedPane;
  if (node.content.kind !== 'source-code') throw Error();
  node.content.files = [{ sourceFile: 'a.ts', sourceSha256: 'a'.repeat(64), ascii: 'method', selectedLineCount: 1,
    rows: [{ treeLine: 1, selected: true, sourceRanges: [{ startLine: 4, endLine: 8 }] }] }];
  const imported = deserializeWorkspace(snapshot);
  expect((imported.documents[0].canvas.display.nodes.source as ProjectedPane).content).toMatchObject({ files: [{ ranges: [{startLine: 4, endLine: 8}], compactedSource: { sections: [{comment: 'method'}] } }] });
  expect(deserializeWorkspace(serializeWorkspace(imported))).toEqual(imported);
});
