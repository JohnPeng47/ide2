import { updateDisplayGeometry, type ConversationPane, type DisplayState } from './displayModel';
/** The bubble is a canvas attachment even when the conversation is docked to the viewport. */
export function layoutConversationPane(state: DisplayState, node: ConversationPane, viewport: { width: number; height: number }): DisplayState {
  if (node.expansion === 'collapsed') return updateDisplayGeometry(state, node.id, {
    position: { x: node.canvasAnchor.x - 17, y: node.canvasAnchor.y - 17 },
    bounds: { width: 34, height: 34 }, coordinateSpace: 'canvas'
  });
  const docked = node.presentation === 'docked';
  const width = docked ? Math.min(390, Math.max(1, viewport.width - 32)) : node.presentation === 'floating' ? 400 : 310;
  return updateDisplayGeometry(state, node.id, {
    coordinateSpace: docked ? 'viewport' : 'canvas',
    ...(node.geometryPolicy.placement === 'automatic' ? { position: docked
      ? { x: Math.max(0, viewport.width - width - 16), y: 72 }
      : { x: node.canvasAnchor.x + (node.presentation === 'floating' ? 28 : 22),
        y: node.canvasAnchor.y + (node.presentation === 'floating' ? -112 : 24) } } : {}),
    ...(docked && node.geometryPolicy.sizing === 'content' ? { bounds: { width, height: Math.max(1, viewport.height - 118) } } : {})
  });
}
