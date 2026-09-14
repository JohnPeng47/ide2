import { isRepositoryFilePath } from '../../../../domain/core/source/sourceNavigation';
import { addDisplayNode, displayGeometry, setExpansion, type DisplayState, type ProjectedPane, type SourceCodePaneContent } from '../../../../domain/mapping/workspace/displayModel';

export type SourceCodePaneView = Pick<SourceCodePaneContent, 'sourceFile' | 'showCompactions' | 'rangeIndex' | 'scroll'>;

export function openSourceCodePane(state: DisplayState, parentId: string, projectId: string, sourceFile: string): DisplayState {
  const parent = state.nodes[parentId];
  if (parent?.kind !== 'projection' || parent.content.kind !== 'compaction'
    || !parent.content.files.some(file => file.sourceFile === sourceFile)) return state;
  const existing = parent.childIds.map(id => state.nodes[id]).find((node): node is ProjectedPane =>
    node?.kind === 'projection' && node.content.kind === 'source-code');
  if (existing && existing.content.kind === 'source-code') {
    const next = updateSourceCodePane(state, existing.id, existing.content.sourceFile === sourceFile
      ? {} : { sourceFile, rangeIndex: 0, scroll: undefined });
    return setExpansion({ ...next, nodes: { ...next.nodes, [parentId]: { ...parent, activeChildId: existing.id } } }, existing.id, 'expanded');
  }
  const pane: ProjectedPane = {
    ...displayGeometry({ x: 0, y: 0 }, { width: 860, height: 640 }),
    geometryPolicy: { placement: 'automatic', sizing: 'fixed' },
    id: crypto.randomUUID(), kind: 'projection', title: sourceFile, childIds: [], expansion: 'expanded',
    projectionId: parent.projectionId, sourceRevisionId: parent.sourceRevisionId, targetRevisionId: parent.targetRevisionId,
    content: { kind: 'source-code', projectId, files: parent.content.files, sourceFile, showCompactions: true, rangeIndex: 0 }
  };
  return addDisplayNode(state, pane, parentId);
}

export function updateSourceCodePane(state: DisplayState, id: string, patch: Partial<SourceCodePaneView>): DisplayState {
  const node = state.nodes[id];
  if (node?.kind !== 'projection' || node.content.kind !== 'source-code') return state;
  const content = { ...node.content, ...patch };
  if (!isRepositoryFilePath(content.sourceFile)) return state;
  if (content.sourceFile === node.content.sourceFile && content.rangeIndex === node.content.rangeIndex
    && content.showCompactions === node.content.showCompactions
    && content.scroll?.top === node.content.scroll?.top && content.scroll?.left === node.content.scroll?.left) return state;
  return { ...state, nodes: { ...state.nodes, [id]: { ...node, title: content.sourceFile, content } } };
}
