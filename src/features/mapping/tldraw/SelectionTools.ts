import { HandTool, SelectTool, type Editor, type StateNode } from 'tldraw';
import { NativeSelectionOwnership } from '../../../../domain/mapping/selection/selectionGesture';
import { mappingShapeId } from './shapeProjection';

export class SelectionToolBridge {
  readonly ownership = new NativeSelectionOwnership();
  suppress = false;
  pointerType = 'mouse';
  moveDiagram?: string;
  cancel?: () => void;
  escape?: () => boolean;
}
export const selectionTools = new WeakMap<Editor, SelectionToolBridge>();
type ToolEvent = Parameters<StateNode['handleEvent']>[0];
function claimed(editor: Editor, info: ToolEvent) {
  const bridge = selectionTools.get(editor);
  if (!bridge) return false;
  // These delayed phases also arrive after pointer-up. Never let HandTool's
  // double-tap zoom or one-finger zoom reinterpret an application touch sequence.
  if (info.name === 'double_click')
    return bridge.pointerType !== 'mouse' || bridge.suppress;
  if (info.name === 'interrupt' || info.name === 'cancel') bridge.cancel?.();
  return bridge.suppress && info.type === 'pointer';
}
export class MappingSelectTool extends SelectTool {
  override onExit() { selectionTools.get(this.editor)?.cancel?.(); super.onExit(); }
  override handleEvent(info: ToolEvent) {
    if (claimed(this.editor, info)) return;
    const bridge = selectionTools.get(this.editor);
    if (info.name === 'pointer_down' && bridge?.moveDiagram) {
      const shape = this.editor.getShape(mappingShapeId(bridge.moveDiagram));
      if (shape) {
        // Native translation handles geometry/history. Application membership is
        // deliberately retained even if a selected region isn't a native shape.
        this.editor.setSelectedShapes([shape.id]);
        this.transition('pointing_shape', { ...info, target: 'shape', shape });
        return;
      }
    }
    super.handleEvent(info);
  }
}
export class MappingHandTool extends HandTool {
  override onExit() { selectionTools.get(this.editor)?.cancel?.(); }
  override handleEvent(info: ToolEvent) {
    if (!claimed(this.editor, info)) super.handleEvent(info);
  }
}
export const mappingTools = [MappingSelectTool, MappingHandTool];
