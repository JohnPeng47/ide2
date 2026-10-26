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
  const gesture = useRef<{ pointerId: number; camera: { x: number; y: number; z: number }; panning: boolean; focus: unknown } | undefined>(undefined);
  const navigation = useRef<{ owner: unknown; source: number; target: number }>({ owner: undefined, source: 0, target: 0 });
  const view = useValue('focused edge geometry', () => {
    const focused = runtime.focusedEdge.get();
    if (!editor || !enabled || runtime.interaction.get().subtreeDisabled) return [];
    const viewport = editor.getViewportScreenBounds(), zoom = editor.getZoomLevel();
    const local = (p: { x: number; y: number }) => {
      const screen = editor.pageToScreen(p); return { x: screen.x - viewport.x, y: screen.y - viewport.y };
    };
    const edges = focused ? [{ id: focused.id, incoming: true, outgoing: true }] : runtime.nodeConnections.get();
    const views = edges.flatMap(edge => {
      const model = runtime.edges.get(edge.id).get();
      if (!model) return [];
      const arrow = nativeEdgeGeometry(runtime, model.edge, model.source, model.target);
      const source = nativeEndpointRect(runtime, model.source), target = nativeEndpointRect(runtime, model.target);
      if (!source || !target || !arrow.path) return [];
      const point = edgeFocusPosition(arrow.path, focused?.point ?? {
        x: (source.x + source.width / 2 + target.x + target.width / 2) / 2,
        y: (source.y + source.height / 2 + target.y + target.height / 2) / 2,
      });
      return point ? [{ ...edge, point: local(point), orientation: point.orientation, source, target,
        highlights: [source, target].map(rect => ({ ...local(rect), width: rect.width * zoom, height: rect.height * zoom })) }] : [];
    });
    // Nearby parallel routes still need independently clickable endpoint controls.
    const hints: { left: number; top: number }[] = [];
    for (const edge of views) {
      const hint = { left: edge.point.x + (edge.orientation === 'horizontal' ? -32 : 8),
        top: edge.point.y - (edge.orientation === 'horizontal' ? 44 : 18) };
      while (hints.some(other => Math.abs(other.left - hint.left) < 68 && Math.abs(other.top - hint.top) < 40)) {
        hint.top -= 40; edge.point.y -= 40;
      }
      hints.push(hint);
    }
    return views;
  }, [runtime, editor, enabled]);
  const pan = (end: 'source' | 'target', edgeId?: string) => {
    if (!editor) return;
    const owner = runtime.focusedEdge.get() ?? runtime.focusedNode.get();
    if (navigation.current.owner !== owner) navigation.current = { owner, source: 0, target: 0 };
    const candidates = edgeId ? view.filter(edge => edge.id === edgeId)
      : view.filter(edge => end === 'source' ? edge.incoming : edge.outgoing);
    if (!candidates.length) return;
    const edge = candidates[edgeId ? 0 : navigation.current[end]++ % candidates.length];
    const rect = edge[end];
    editor.centerOnPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, { animation: { duration: 180 } });
  };
  useEffect(() => {
    if (!view.length) { gesture.current = undefined; runtime.clearConnectionFocus(); return; }
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey
        || target instanceof HTMLElement && (target.isContentEditable || target.closest('input,textarea,select,[role=textbox]'))) return;
      if (event.key !== '[' && event.key !== ']' && event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape') runtime.clearConnectionFocus();
      else pan(event.key === '[' ? 'source' : 'target');
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      gesture.current = undefined;
      if (!(target instanceof Element) || !root.current?.contains(target)) { runtime.clearConnectionFocus(); return; }
      if (target.closest('.diagram-canvas__controls,.edge-focus-hint')) return;
      const focus = runtime.focusedEdge.get() ?? runtime.focusedNode.get();
      const panning = event.button === 1 || !!editor?.inputs.getIsPanning() || editor?.getCurrentToolId() === 'hand';
      if (panning && editor) { gesture.current = { pointerId: event.pointerId, camera: { ...editor.getCamera() }, panning: true, focus }; return; }
      if (target.closest('.diagram-connection-hit')) return;
      if (target.closest('button,input,textarea,select,[contenteditable],[data-mapping-static-ui]')) { runtime.clearConnectionFocus(); return; }
      // Wait until a canvas gesture ends: a pan must not act like a click-away.
      if (editor) gesture.current = { pointerId: event.pointerId, camera: { ...editor.getCamera() }, panning: false, focus };
    };
    const end = (event: PointerEvent) => {
      const start = gesture.current;
      if (!start || start.pointerId !== event.pointerId) return;
      gesture.current = undefined;
      const camera = editor?.getCamera();
      if (event.type !== 'pointercancel' && !start.panning && camera
        && start.focus === (runtime.focusedEdge.get() ?? runtime.focusedNode.get())
        && camera.x === start.camera.x && camera.y === start.camera.y && camera.z === start.camera.z) runtime.clearConnectionFocus();
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
  if (!view.length) return null;
  return <div className="edge-focus-overlay">
    <svg aria-hidden="true">{view.flatMap(edge => edge.highlights.map((rect, index) => <rect key={`${edge.id}:${index}`} data-edge-endpoint={index ? 'target' : 'source'}
      x={rect.x - 3} y={rect.y - 3} width={rect.width + 6} height={rect.height + 6} rx={3} />))}</svg>
    {view.map(edge => <div key={edge.id} className="edge-focus-hint" data-focused-edge={edge.id} data-orientation={edge.orientation} style={{ left: edge.point.x, top: edge.point.y }}
      role="group" aria-label="Focused edge endpoints" data-mapping-static-ui data-diagram-canvas-static-ui>
      <button type="button" aria-label="Focus source node" aria-keyshortcuts="[" title="Focus source node ([)" onClick={() => pan('source', edge.id)}><kbd>[</kbd></button>
      <button type="button" aria-label="Focus target node" aria-keyshortcuts="]" title="Focus target node (])" onClick={() => pan('target', edge.id)}><kbd>]</kbd></button>
    </div>)}
  </div>;
}
