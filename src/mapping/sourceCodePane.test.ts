import { expect, it } from 'vitest';
import { addDisplayNode, displayGeometry, emptyDisplayState, removeDisplayNode, setExpansion, visibleProjectionIds, type ProjectedPane, type SelectionRegion } from './displayModel';
import { openSourceCodePane, updateSourceCodePane } from './sourceCodePane';
import { initialCanvasState, type MappingWorkspaceSnapshot } from './mappingWorkspace';
import { initialMappingGrid } from './mappingGrid';
import { deserializeWorkspace, serializeWorkspace } from './mappingWorkspaceCodec';

function fixture() {
  const selection: SelectionRegion = { ...displayGeometry(), id: 'selection', kind: 'selection', childIds: [],
    expansion: 'expanded', displayMode: 'stacked', sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii: 'A',
    selectedIds: ['a'], rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 } };
  const compaction: ProjectedPane = { ...displayGeometry(), id: 'compaction', kind: 'projection', title: 'Compaction',
    childIds: [], expansion: 'expanded', projectionId: 'projection', sourceRevisionId: 'source-revision', targetRevisionId: 'target-revision',
    content: { kind: 'compaction', files: ['a.ts', 'b.ts'].map(sourceFile => ({ sourceFile, sourceSha256: 'a'.repeat(64),
      ascii: 'File\n\\-- method', selectedLineCount: 1,
      rows: [{ treeLine: 1, selected: false, sourceRanges: [{ startLine: 1, endLine: 10 }] },
        { treeLine: 2, selected: true, sourceRanges: [{ startLine: 4, endLine: 5 }] }] })) } };
  return addDisplayNode(addDisplayNode(emptyDisplayState(), selection), compaction, selection.id);
}

it('retains source ownership, reuses the source pane, and restores view state after collapse and reopening', () => {
  let state = openSourceCodePane(fixture(), 'compaction', 'project', 'a.ts');
  const sourceId = state.nodes.compaction.childIds[0];
  expect(visibleProjectionIds(state, 'selection', 'stacked')).toEqual([sourceId]);
  expect(visibleProjectionIds(state, 'selection', 'chained')).toEqual(['compaction', sourceId]);
  state = updateSourceCodePane(state, sourceId, { showCompactions: false, rangeIndex: 1, scroll: { top: 340, left: 20 } });
  const source = state.nodes[sourceId];
  state = setExpansion(state, sourceId, 'collapsed');
  state = openSourceCodePane(state, 'compaction', 'project', 'a.ts');
  expect(state.nodes.compaction.childIds).toEqual([sourceId]);
  expect(state.nodes[sourceId]).toEqual(source);
  state = openSourceCodePane(state, 'compaction', 'project', 'b.ts');
  expect(state.nodes[sourceId]).toMatchObject({ content: { sourceFile: 'b.ts', rangeIndex: 0, scroll: undefined, showCompactions: false } });
  expect(visibleProjectionIds(removeDisplayNode(state, sourceId), 'selection', 'stacked')).toEqual(['compaction']);
  expect(removeDisplayNode(state, 'selection').nodes).toEqual({});
});

it('saves source content and navigation state and rejects invalid source pane snapshots', () => {
  const document = initialMappingGrid();
  const canvas = initialCanvasState();
  canvas.display = openSourceCodePane(fixture(), 'compaction', 'project', 'a.ts');
  const sourceId = canvas.display.nodes.compaction.childIds[0];
  canvas.display = updateSourceCodePane(canvas.display, sourceId, { scroll: { top: 240, left: 10 }, showCompactions: false });
  const snapshot: MappingWorkspaceSnapshot = { schemaVersion: 2, projectId: 'project', documents: [{ representationId: 'diagram',
    name: 'Diagram', revisionId: 'revision', savedName: 'Diagram', savedScene: JSON.stringify(document.scene), document, canvas }] };
  expect(deserializeWorkspace(serializeWorkspace(snapshot))).toEqual(snapshot);
  for (const patch of [{ sourceFile: 'missing.ts' }, { projectId: 'other-project' }, { rangeIndex: -1 }, { showCompactions: 'yes' }, { scroll: { top: -1, left: 0 } }]) {
    const invalid = structuredClone(snapshot);
    const node = invalid.documents[0].canvas.display.nodes[sourceId] as ProjectedPane;
    Object.assign(node.content, patch);
    expect(() => deserializeWorkspace(invalid)).toThrow('Invalid workspace');
  }
});
