import { useEffect, useRef, type RefObject } from 'react';
import { useValue, type Editor } from 'tldraw';
import type { CanvasRuntime } from './CanvasRuntimeContext';
import { nativeEdgeGeometry, nativeEndpointRect } from './nativeEdgeGeometry';
import { edgeFocusPosition } from './edgeFocusPosition';
import '../canvas/diagramConnections.css';

/** Transient canvas focus: neither selection history nor the saved edge changes. */
export function ConnectionFocus({ runtime, editor, enabled, root }: {
  runtime: CanvasRuntime; editor?: Editor; enabled: boolean; root: RefObject<HTMLDivElement | null>;
}) {
  const gesture = useRef<{ pointerId: number; camera: { x: number; y: number; z: number }; panning: boolean } | undefined>(undefined);
  const view = useValue('focused edge geometry', () => {
    const focused = runtime.focusedEdge.get();
    if (!editor || !enabled || !focused || runtime.interaction.get().subtreeDisabled) return;
    const model = runtime.edges.get(focused.id).get();
    if (!model) return;
    const arrow = nativeEdgeGeometry(runtime, model.edge, model.source, model.target);
    const source = nativeEndpointRect(runtime, model.source), target = nativeEndpointRect(runtime, model.target);
    const point = arrow.path && edgeFocusPosition(arrow.path, focused.point);
    if (!source || !target || !point) return;
    const viewport = editor.getViewportScreenBounds(), zoom = editor.getZoomLevel();
    const local = (p: { x: number; y: number }) => {
      const screen = editor.pageToScreen(p); return { x: screen.x - viewport.x, y: screen.y - viewport.y };
    };
    return { id: focused.id, point: local(point), orientation: point.orientation, source, target,
      highlights: [source, target].map(rect => ({ ...local(rect), width: rect.width * zoom, height: rect.height * zoom })) };
  }, [runtime, editor, enabled]);
  const pan = (end: 'source' | 'target') => {
    if (!view || !editor) return;
    const rect = view[end];
    editor.centerOnPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { animation: { duration: 180 } });
  };
  useEffect(() => {
    if (!view) { gesture.current = undefined; runtime.focusedEdge.set(undefined); return; }
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey
        || target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role=textbox]'))) return;
      if (event.key !== '[' && event.key !== ']' && event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') runtime.focusedEdge.set(undefined);
      else pan(event.key === '[' ? 'source' : 'target');
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      gesture.current = undefined;
      if (!(target instanceof Element) || !root.current?.contains(target)) { runtime.focusedEdge.set(undefined); return; }
      if (target.closest('.diagram-canvas__controls,.edge-focus-hint')) return;
      const panning = event.button === 1 || !!editor?.inputs.getIsPanning() || editor?.getCurrentToolId() === 'hand';
      if (panning && editor) { gesture.current = { pointerId: event.pointerId, camera: { ...editor.getCamera() }, panning: true }; return; }
      if (target.closest('.diagram-connection-hit')) return;
      if (target.closest('button,input,textarea,select,[contenteditable],[data-mapping-static-ui]')) { runtime.focusedEdge.set(undefined); return; }
      // Wait until a canvas gesture ends: a pan must not act like a click-away.
      if (editor) gesture.current = { pointerId: event.pointerId, camera: { ...editor.getCamera() }, panning: false };
    };
    const end = (event: PointerEvent) => {
      const start = gesture.current;
      if (!start || start.pointerId !== event.pointerId) return;
      gesture.current = undefined;
      const camera = editor?.getCamera();
      if (event.type !== 'pointercancel' && !start.panning && camera
        && camera.x === start.camera.x && camera.y === start.camera.y && camera.z === start.camera.z) runtime.focusedEdge.set(undefined);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    return () => {
      window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('pointerup', end, true); window.removeEventListener('pointercancel', end, true);
    };
  }, [runtime, view, editor, root]);
  if (!view) return null;
  return <div className="edge-focus-overlay" data-focused-edge={view.id}>
    <svg aria-hidden="true">{view.highlights.map((rect, index) => <rect key={index} data-edge-endpoint={index ? 'target' : 'source'}
      x={rect.x - 3} y={rect.y - 3} width={rect.width + 6} height={rect.height + 6} rx={3} />)}</svg>
    <div className="edge-focus-hint" data-orientation={view.orientation} style={{ left: view.point.x, top: view.point.y }}
      role="group" aria-label="Focused edge endpoints" data-mapping-static-ui data-diagram-canvas-static-ui>
      <button type="button" aria-label="Focus source node" aria-keyshortcuts="[" title="Focus source node ([)" onClick={() => pan('source')}><kbd>[</kbd></button>
      <button type="button" aria-label="Focus target node" aria-keyshortcuts="]" title="Focus target node (])" onClick={() => pan('target')}><kbd>]</kbd></button>
    </div>
  </div>;
}
