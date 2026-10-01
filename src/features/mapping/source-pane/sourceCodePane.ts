import { isRepositoryFilePath } from '../../../../domain/core/source/sourceNavigation';
import { type DisplayState, type SourceCodePaneContent } from '../../../../domain/mapping/workspace/displayModel';

export type SourceCodePaneView = Pick<SourceCodePaneContent, 'sourceId' | 'sourceFile' | 'showCompactions' | 'rangeIndex' | 'scroll'>;

export function updateSourceCodePane(state: DisplayState, id: string, patch: Partial<SourceCodePaneView>): DisplayState {
  const node = state.nodes[id];
  if (node?.kind !== 'projection' || node.content.kind !== 'source-code') return state;
  const content = { ...node.content, ...patch };
  if (!isRepositoryFilePath(content.sourceFile)) return state;
  if (content.sourceId === node.content.sourceId && content.sourceFile === node.content.sourceFile && content.rangeIndex === node.content.rangeIndex
    && content.showCompactions === node.content.showCompactions
    && content.scroll?.top === node.content.scroll?.top && content.scroll?.left === node.content.scroll?.left) return state;
  return { ...state, nodes: { ...state.nodes, [id]: { ...node, title: content.sourceFile, content } } };
}
