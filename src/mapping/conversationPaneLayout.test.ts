import { expect, it } from 'vitest';
import { addDisplayNode, displayGeometry, emptyDisplayState, setExpansion, type ConversationPane } from './displayModel';
import { layoutConversationPane } from './conversationPaneLayout';
const pane = (): ConversationPane => ({ ...displayGeometry(), id: 'chat', kind: 'conversation', childIds: [], expansion: 'expanded',
  presentation: 'docked', canvasAnchor: { x: 120, y: 240 }, draft: '',
  thread: { id: 'chat', title: 'Chat', verbosity: 'low', context: { contentId: 'overview', diagramAscii: 'A', diagramRevision: 0, mappings: [] }, selection: { boxId: 'overview', nodeIds: [], summary: '', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 } }, messages: [], pending: false } });
it('uses viewport pixels for docking and canvas pixels for the collapsed attachment', () => {
  let state = addDisplayNode(emptyDisplayState(), pane());
  state = layoutConversationPane(state, state.nodes.chat as ConversationPane, { width: 1200, height: 800 });
  expect(state.nodes.chat).toMatchObject({ coordinateSpace: 'viewport', position: { x: 794, y: 72 }, bounds: { width: 390, height: 682 } });
  state = setExpansion(state, 'chat', 'collapsed');
  state = layoutConversationPane(state, state.nodes.chat as ConversationPane, { width: 1200, height: 800 });
  expect(state.nodes.chat).toMatchObject({ coordinateSpace: 'canvas', position: { x: 103, y: 223 }, bounds: { width: 34, height: 34 } });
  state = setExpansion(state, 'chat', 'expanded');
  state = layoutConversationPane(state, state.nodes.chat as ConversationPane, { width: 1000, height: 700 });
  expect(state.nodes.chat.position.x).toBe(594);
  expect((state.nodes.chat as ConversationPane).canvasAnchor).toEqual({ x: 120, y: 240 });
});
it('preserves an imported manual dock allocation', () => {
  const node = { ...pane(), position: { x: 600, y: 90 }, bounds: { width: 300, height: 400 }, coordinateSpace: 'viewport' as const,
    geometryPolicy: { placement: 'manual' as const, sizing: 'fixed' as const } };
  const state = addDisplayNode(emptyDisplayState(), node);
  expect(layoutConversationPane(state, node, { width: 1000, height: 700 })).toBe(state);
});
