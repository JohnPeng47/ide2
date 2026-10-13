import { useValue } from 'tldraw';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasMarqueeSelection, SelectionBounds } from '../../../../domain/mapping/selection/canvasSelection';
import { SelectionGestureController, type SelectionHit, type SelectionPolicy } from '../../../../domain/mapping/selection/selectionGesture';
import type { CanvasRuntime } from '../tldraw/CanvasRuntimeContext';

/** DOM supplies precise label identity and pointer type; public native tools gate
 * selection. Touch events always reach tldraw's two-contact pinch recognizer. */
export function CanvasSelectionLayer(props: { stageRef: RefObject<HTMLDivElement | null>; active: boolean;
  runtime?: CanvasRuntime; diagramIds: string[]; selected: string[];
  resolve: (bounds: SelectionBounds, promoted: string[]) => CanvasMarqueeSelection;
  onComplete: (selection: CanvasMarqueeSelection, policy: SelectionPolicy) => void;
  onTap: (hit: SelectionHit, policy: SelectionPolicy, whole: boolean) => void;
  onClear: () => void;
  onSelectNode: (hit: SelectionHit) => void;
  onSelectDiagram: (id: string, toggle: boolean) => void }) {
  const nativeEditor = useValue('selection editor', () => props.runtime?.editor, [props.runtime]);
  const current = useRef(props); current.current = props;
  const [preview, setPreview] = useState<{ bounds: SelectionBounds; diagrams: SelectionBounds[] }>();
  useEffect(() => {
    const stage = props.stageRef.current, viewport = stage?.closest<HTMLElement>('[data-diagram-canvas]');
    if (!viewport || !props.active) { setPreview(undefined); return; }
    const recognizer = new SelectionGestureController();
    const bridge = props.runtime?.gestures, editor = nativeEditor;
    let promoted: string[] = [], restoreTool: string | undefined;
    let previewFrame = 0, pendingPreview: { bounds: SelectionBounds; diagrams: SelectionBounds[] } | undefined;
    const clearPreview = () => { cancelAnimationFrame(previewFrame); previewFrame = 0; pendingPreview = undefined; setPreview(undefined); };
    const queuePreview = (value: NonNullable<typeof pendingPreview>) => {
      pendingPreview = value;
      if (!previewFrame) previewFrame = requestAnimationFrame(() => { previewFrame = 0; setPreview(pendingPreview); });
    };
    let tool = editor?.getCurrentToolId();
    const boxes = () => [...viewport.querySelectorAll<HTMLElement>('[data-grid-box]')]
      .filter(el => current.current.diagramIds.includes(`grid:${el.dataset.gridBox}`))
      .map(el => ({ id: `grid:${el.dataset.gridBox}`, bounds: el.getBoundingClientRect() }));
    const nodeAtPoint = (event: MouseEvent) => document.elementsFromPoint(event.clientX, event.clientY)
      .map(element => element.closest<HTMLElement>('[data-content-node-id][data-display-node-id]'))
      .find(element => element && viewport.contains(element))
      // The native whole-diagram hit area can mask its text from elementsFromPoint.
      ?? [...viewport.querySelectorAll<HTMLElement>('[data-content-node-id][data-display-node-id]')].find(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && event.clientX >= bounds.left && event.clientX <= bounds.right
          && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
    const ui = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest('[data-diagram-move-handle]')) return false;
      if (target.closest('[data-diagram-jump-id]') && (event.ctrlKey || ('pointerType' in event ? event.pointerType !== 'mouse' : bridge?.pointerType !== 'mouse'))) return false;
      if (event.ctrlKey && target.closest('.retained-selection-controls, .mapping-whole-actions') && nodeAtPoint(event)) return false;
      return !!target.closest('button, a, input, textarea, select, [contenteditable=true], [data-mapping-static-ui], [data-diagram-canvas-static-ui], [data-display-node], .window-panel');
    };
    const hit = (event: MouseEvent, captured = false): SelectionHit | undefined => {
      // A DOM dblclick may still target the native capture element after release.
      const target = captured ? document.elementFromPoint(event.clientX, event.clientY) : event.target as Element;
      const label = target?.closest<HTMLElement>('[data-content-node-id]') ?? nodeAtPoint(event);
      if (label?.dataset.displayNodeId?.startsWith('grid:')) return { diagramId: label.dataset.displayNodeId,
        nodeId: label.dataset.contentNodeId, revision: label.dataset.contentRevision };
      const box = boxes().find(({ bounds: r }) => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom);
      return box && { diagramId: box.id };
    };
    const point = (e: PointerEvent) => ({ pointerId: e.pointerId, pointerType: e.pointerType || 'mouse', x: e.clientX, y: e.clientY, time: e.timeStamp });
    const cancel = () => { recognizer.cancel(); promoted = []; clearPreview(); };
    const cancelNativeGesture = () => {
      // HandTool's idle cancel switches to Select. An interruption ends its pan
      // without changing tools; native shape moves still need cancel to roll back.
      if (editor?.getCurrentToolId() === 'hand') editor.interrupt();
      else editor?.cancel();
    };
    if (bridge) bridge.cancel = cancel;
    const down = (event: PointerEvent) => {
      if (ui(event)) return;
      // A toolbar change may precede this contact without an intervening SDK tick.
      // Synchronize before starting recognition so that tick cannot cancel it.
      if (editor?.getCurrentToolId() !== tool) { cancel(); tool = editor?.getCurrentToolId(); }
      if (bridge) {
        bridge.pointerType = event.pointerType || 'mouse';
        bridge.suppress = false;
        bridge.moveDiagram = undefined;
      }
      // Use the event's pointer type even on a hybrid tablet. Preselecting pen
      // mode avoids the SDK's first-Pencil interrupt; a mouse/finger switches it
      // off again so a prior pen contact cannot disable other input devices.
      editor?.updateInstanceState({ isPenMode: event.pointerType === 'pen' });
      if (event.button !== 0) { cancel(); bridge?.ownership.claim('application'); return; }
      // Fingers temporarily use Hand regardless of the selected editing tool.
      // Restore before an immediate pen/mouse handoff, without waiting for a tick.
      if (restoreTool && !recognizer.contacts.size && event.pointerType !== 'touch') {
        editor?.setCurrentTool(restoreTool); tool = restoreTool; restoreTool = undefined;
      }
      const moveHandle = event.pointerType === 'touch' ? undefined
        : (event.target as Element).closest<HTMLElement>('[data-diagram-move-handle]');
      if (event.pointerType === 'touch' && editor && editor.getCurrentToolId() !== 'hand') {
        if (recognizer.contacts.size) cancelNativeGesture();
        restoreTool ??= editor.getCurrentToolId();
        editor.setCurrentTool('hand'); tool = 'hand';
      } else if (moveHandle && editor?.getCurrentToolId() !== 'select') {
        restoreTool = editor?.getCurrentToolId(); editor?.setCurrentTool('select'); tool = 'select';
      }
      const gesture = recognizer.down({ ...point(event), hit: hit(event),
        tool: editor?.getCurrentToolId() === 'hand' ? 'hand' : 'select', add: false,
        ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey, alt: event.altKey,
        pan: editor?.inputs.getIsPanning(), moveHandle: !!moveHandle });
      if (bridge) {
        bridge.pointerType = event.pointerType || 'mouse';
        bridge.moveDiagram = moveHandle?.dataset.diagramMoveHandle;
        bridge.suppress = !gesture || gesture.kind === 'marquee' || gesture.kind === 'blocked';
        bridge.ownership.claim(gesture?.kind === 'native' && !!gesture.start.hit && editor?.getCurrentToolId() !== 'hand'
          && !editor?.inputs.getIsPanning() ? 'native' : 'application');
      }
      if (!gesture) {
        clearPreview();
        // Roll back an in-flight native move before the second contact reaches
        // the SDK. Both contacts still reach its pan/pinch recognizer.
        cancelNativeGesture();
        return;
      }
      promoted = gesture.policy === 'add' ? [...current.current.selected] : [];
      if (gesture.kind === 'marquee') { window.getSelection()?.removeAllRanges(); stage!.focus({ preventScroll: true }); }
      // Legacy non-native canvas still uses the same recognition core.
      if (!editor && (gesture.kind === 'marquee' || gesture.kind === 'blocked')) {
        event.preventDefault(); event.stopPropagation(); viewport.setPointerCapture(event.pointerId);
      }
    };
    const sample = (event: PointerEvent) => {
      const gesture = recognizer.move(point(event));
      if (!gesture) return;
      if ((gesture.kind === 'node' || gesture.kind === 'native') && gesture.moved && editor?.getCurrentToolId() === 'select' && !editor.inputs.getIsPanning())
        bridge?.ownership.claim('native');
      if (gesture.kind !== 'marquee' || !gesture.moved) return;
      const selection = current.current.resolve(gesture.bounds, promoted);
      promoted = selection.diagramIds;
      queuePreview({ bounds: gesture.bounds, diagrams: boxes().filter(box => promoted.includes(box.id)).map(box => box.bounds) });
      if (!editor) { event.preventDefault(); event.stopPropagation(); }
    };
    const up = (event: PointerEvent) => {
      const owned = recognizer.contacts.has(event.pointerId);
      if (!owned) return;
      const gesture = recognizer.gesture;
      const result = recognizer.up(point(event));
      clearPreview();
      if (result?.kind === 'marquee') current.current.onComplete(current.current.resolve(result.bounds, promoted), result.policy);
      else if (result) current.current.onTap(result.hit, result.policy, !result.hit.nodeId);
      else if (gesture?.kind === 'marquee' && !gesture.moved && gesture.start.pointerType === 'mouse'
        && gesture.start.ctrl && gesture.start.hit?.nodeId && event.detail < 2) current.current.onSelectNode(gesture.start.hit);
      if (!editor && viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      // Native pointer-up still needs its tool. Restore on the next tick, after
      // geometry has settled, rather than ending translation in DOM capture.
    };
    const cancelContact = () => {
      // The SDK has no DOM pointercancel handler. Cancel native translation too,
      // so a canceled contact cannot become a delayed geometry commit.
      if (recognizer.gesture && !['marquee', 'blocked'].includes(recognizer.gesture.kind)) cancelNativeGesture();
      cancel();
    };
    const pointerCancel = (event: PointerEvent) => {
      if (!recognizer.contacts.has(event.pointerId)) return;
      cancelContact(); recognizer.contacts.delete(event.pointerId);
      if (!recognizer.contacts.size) recognizer.blocked = false;
    };
    const lostCapture = (event: PointerEvent) => { if (recognizer.contacts.has(event.pointerId)) cancelContact(); };
    const reset = () => { cancelContact(); recognizer.reset(); };
    const visibility = () => { if (document.hidden) reset(); };
    const escapeGesture = () => {
      const gesture = recognizer.gesture;
      if (!gesture) return false;
      if (gesture.kind !== 'marquee' && gesture.kind !== 'blocked') cancelNativeGesture();
      cancel();
      if (bridge) bridge.suppress = true; // Ignore the canceled contact's final up.
      return true;
    };
    if (bridge) bridge.escape = escapeGesture;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable=true],[data-display-node],.window-panel'))) return;
      if (escapeGesture()) {
        event.preventDefault(); event.stopImmediatePropagation();
      } else if (current.current.selected.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        bridge?.ownership.claim('application');
        editor?.cancel();
        current.current.onClear();
      }
    };
    const tick = () => {
      if (editor?.getCurrentToolId() !== tool) { cancel(); tool = editor?.getCurrentToolId(); }
      // Pinch consumes native pointer-up events, so native pointing/dragging can
      // remain set after every DOM contact is gone. Hand restoration uses our
      // contacts plus pinch completion; shape moves still await native settle.
      if (restoreTool && !recognizer.contacts.size && !editor?.inputs.getIsPinching()
        && (editor?.getCurrentToolId() === 'hand' || !editor?.inputs.getIsPointing() && !editor?.inputs.getIsDragging())) {
        editor?.setCurrentTool(restoreTool); tool = restoreTool; restoreTool = undefined;
      }
    };
    const doubleClick = (event: MouseEvent) => {
      if (ui(event) || event.button !== 0) return;
      if (bridge?.pointerType !== undefined && bridge.pointerType !== 'mouse') { event.preventDefault(); event.stopPropagation(); return; }
      const target = hit(event, true);
      if (!target || (!(event.ctrlKey || event.metaKey) && target.nodeId)) return;
      event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
      bridge?.ownership.claim('application');
      current.current.onSelectDiagram(target.diagramId, event.ctrlKey || event.metaKey);
    };
    const click = (event: MouseEvent) => {
      if (event.detail > 0 && bridge && bridge.pointerType !== 'mouse' && !ui(event)) { event.preventDefault(); event.stopPropagation(); }
    };
    viewport.addEventListener('dblclick', doubleClick, true);
    viewport.addEventListener('click', click, true);
    viewport.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', sample, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    viewport.addEventListener('lostpointercapture', lostCapture, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', visibility);
    editor?.on('tick', tick);
    return () => {
      reset(); if (bridge) { bridge.cancel = undefined; bridge.escape = undefined; }
      viewport.removeEventListener('dblclick', doubleClick, true); viewport.removeEventListener('click', click, true);
      viewport.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', sample, true);
      window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', pointerCancel, true);
      viewport.removeEventListener('lostpointercapture', lostCapture, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', visibility); editor?.off('tick', tick);
    };
  }, [props.stageRef, props.active, props.runtime, nativeEditor]);
  return preview ? createPortal(<>
    <div className="diagram-selection-marquee" data-selection-preview aria-hidden="true" style={{ left: preview.bounds.left, top: preview.bounds.top,
      width: preview.bounds.right - preview.bounds.left, height: preview.bounds.bottom - preview.bounds.top }} />
    {preview.diagrams.map((bounds, i) => <div key={i} className="diagram-selection-marquee" data-diagram-selection-preview aria-hidden="true"
      style={{ left: bounds.left, top: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }} />)}
  </>, document.body) : null;
}
