import { mappingTools, selectionTools } from './SelectionTools';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Tldraw, useEditor, useQuickReactor, useValue, type Editor, type TLComponents } from 'tldraw';
import type { CanvasTransform, DiagramFocus } from '../../../../domain/core/diagrams/diagramCanvas';
import type { CanvasSession } from '../workspace/canvasSession';
import { restoreMappingCamera, saveMappingCamera } from './cameraCompatibility';
import { MappingShapeUtil } from './MappingShapeUtil';
import { MappingEditorRuntime } from './MappingEditorRuntime';
import { CanvasRuntime, CanvasRuntimeContext } from './CanvasRuntimeContext';
import { mappingShapeId } from './shapeProjection';
import { ConnectionFocus } from './ConnectionFocus';
import 'tldraw/tldraw.css';
import './mappingEditor.css';

const ContentContext = createContext<ReactNode>(null);
const shapeUtils = [MappingShapeUtil];
/** Existing application overlays share the editor's page coordinate system.
 * Camera updates touch this transform only, never application React state. */
function ApplicationOverlay() {
  const editor = useEditor(), ref = useRef<HTMLDivElement>(null);
  const children = useContext(ContentContext);
  useQuickReactor('mapping overlay camera', () => {
    const { x, y, z } = editor.getCamera();
    if (ref.current) ref.current.style.transform = `scale(${z}) translate(${x}px, ${y}px)`;
  }, [editor]);
  return <div ref={ref} className="mapping-editor-overlay diagram-canvas__surface">{children}</div>;
}
const components: TLComponents = { InFrontOfTheCanvas: ApplicationOverlay };
export function MappingEditorCanvas(props: {
  session: CanvasSession; children: ReactNode; enabled: boolean; className?: string;
  focusBox?: DiagramFocus; initialTransform?: CanvasTransform; onTransformChange?: (value: CanvasTransform) => void;
}) {
  const canvasRuntime = useMemo(() => new CanvasRuntime(props.session), [props.session]);
  useLayoutEffect(() => canvasRuntime.connect(), [canvasRuntime]);
  const [editor, setEditor] = useState<Editor>();
  const [tool, setTool] = useState('select');
  const canUndo = useValue('canvas undo available', () => canvasRuntime.canUndo.get(), [canvasRuntime]);
  const canEscape = useValue('canvas escape available', () => canvasRuntime.canEscape.get(), [canvasRuntime]);
  const transformCallback = useRef(props.onTransformChange); transformCallback.current = props.onTransformChange;
  const initial = useRef(props.initialTransform);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!editor) return;
    canvasRuntime.editor = editor;
    const fontsChanged = () => canvasRuntime.anchors.invalidate();
    document.fonts.addEventListener('loadingdone', fontsChanged);
    editor.setCameraOptions({ zoomSteps: [.25, .5, 1, 2, 4] });
    selectionTools.set(editor, canvasRuntime.gestures);
    const runtime = new MappingEditorRuntime(editor, props.session.controller, canvasRuntime.gestures.ownership);
    // Existing application interactions own buttons, text inputs and pane bodies.
    const stopUiPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      const directLabel = event.pointerType !== 'mouse' && target.closest('[data-diagram-jump-id]');
      if (!directLabel && !target.closest('[data-diagram-move-handle]') && target.closest('button,input,textarea,select,a,[contenteditable=true],[data-display-node],.window-panel')) editor.markEventAsHandled(event);
      else editor.focus();
    };
    const element = root.current!;
    element.addEventListener('pointerdown', stopUiPointer, true);
    const saved = initial.current;
    if (saved) editor.setCamera(restoreMappingCamera(saved));
    else {
      editor.setCamera({ x: 360, y: 100, z: 1 });
    }
    let last = '';
    const publishCamera = () => {
      setTool(editor.getCurrentToolId());
      const { x, y, z } = editor.getCamera(), key = `${x}:${y}:${z}`;
      if (last === key) return;
      last = key; transformCallback.current?.(saveMappingCamera({ x, y, z }));
    };
    editor.on('tick', publishCamera);
    return () => { document.fonts.removeEventListener('loadingdone', fontsChanged); element.removeEventListener('pointerdown', stopUiPointer, true); runtime.dispose(); selectionTools.delete(editor); editor.off('tick', publishCamera); canvasRuntime.editor = undefined; };
  }, [editor, props.session, canvasRuntime]);
  useEffect(() => {
    if (editor && !props.enabled) editor.blur({ blurContainer: false });
  }, [editor, props.enabled]);
  useEffect(() => {
    if (!editor || !props.enabled || !props.focusBox) return;
    let inner = 0;
    const frame = requestAnimationFrame(() => { inner = requestAnimationFrame(() => {
      const focus = props.focusBox!;
      root.current?.querySelectorAll('[data-jump-focus]').forEach(element => element.removeAttribute('data-jump-focus'));
      const label = focus.contentNodeId ? [...root.current!.querySelectorAll<HTMLElement>('[data-content-node-id]')]
        .find(element => element.dataset.contentNodeId === focus.contentNodeId && element.dataset.displayNodeId === `grid:${focus.id}`) : undefined;
      if (label) label.setAttribute('data-jump-focus', '');
      const search = focus.search && [...root.current!.querySelectorAll<HTMLElement>('[data-search-focus]')]
        .find(element => element.dataset.searchBox === focus.id && element.dataset.searchFocus === String(focus.serial));
      const target = search || label;
      const rect = target?.getBoundingClientRect();
      const bounds = editor.getShapePageBounds(mappingShapeId(`grid:${focus.id}`));
      const point = rect?.width && rect.height ? editor.screenToPage({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
        : bounds?.center;
      if (point) {
        const viewport = root.current!.getBoundingClientRect();
        const tools = root.current?.closest('.mapping-viewport')?.querySelector('.window-panel-tabbed')?.getBoundingClientRect();
        // Center in the canvas space beside the visible tools; keep the explorer margin otherwise.
        const explorer = root.current?.closest('.mapping-viewport')?.querySelector('.mapping-floating-pane')?.getBoundingClientRect();
        const offset = tools?.width ? ((explorer?.right ?? viewport.left) + tools.left) / 2 - (viewport.left + viewport.width / 2) : 170;
        editor.centerOnPoint({ x: point.x - offset / editor.getZoomLevel(), y: point.y });
      }
    }); });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(inner); };
  }, [editor, props.enabled, props.focusBox]);
  return <div ref={root} className={`${props.className ?? ''} mapping-editor-canvas`} data-diagram-canvas data-canvas-engine="tldraw"
    onPasteCapture={event => {
      // Diagram insertion uses the application's ASCII/source-aware paste command.
      if (!(event.target as Element).closest('input,textarea,[contenteditable=true]')) event.stopPropagation();
    }}
    onDropCapture={event => {
      if (!(event.target as Element).closest('input,textarea,[contenteditable=true]')) { event.preventDefault(); event.stopPropagation(); }
    }}
    onKeyDownCapture={event => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable=true]')) return;
      // Let application Escape handling remove one selection instead of the SDK clearing every shape.
      if (event.key === 'Escape' && editor?.getPath().endsWith('.idle')
        && props.session.controller.getSnapshot().canvas.selection.items.length) {
        editor.markEventAsHandled(event.nativeEvent);
      }
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) return;
      // Keep semantic delete cleanup and workspace transfer undo in application commands.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const nodeIds = props.session.controller.getSnapshot().canvas.selection.items.filter(item => !item.region).map(item => item.displayNodeId);
        if (nodeIds.length) {
          event.preventDefault(); event.stopPropagation();
          props.session.controller.applyUpdate(props.session.controller.getSnapshot().version, [{ method: 'delete-diagrams', nodeIds }]);
        }
      }
    }}>
    <CanvasRuntimeContext.Provider value={canvasRuntime}><ContentContext.Provider value={props.children}>
      <Tldraw licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} shapeUtils={shapeUtils} tools={mappingTools} components={components} hideUi onMount={setEditor} overrides={{ tools: (_editor, tools) => ({ select: tools.select, hand: tools.hand }), actions: () => ({}) }}
        options={{ maxShapesPerPage: 10000, createTextOnCanvasDoubleClick: false }} autoFocus={false} />
    </ContentContext.Provider></CanvasRuntimeContext.Provider>
    <ConnectionFocus runtime={canvasRuntime} editor={editor} enabled={props.enabled} root={root} />
    <div className="diagram-canvas__controls" data-diagram-canvas-static-ui>
      <button type="button" aria-pressed={tool === 'select'} onClick={() => { canvasRuntime.gestures.cancel?.(); editor?.setCurrentTool('select'); setTool('select'); }}>Select</button>
      <button type="button" aria-pressed={tool === 'hand'} onClick={() => { canvasRuntime.gestures.cancel?.(); editor?.setCurrentTool('hand'); setTool('hand'); }}>Pan</button>
      <button type="button" disabled={!props.enabled || !canUndo} title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z"
        onClick={() => { canvasRuntime.gestures.cancel?.(); canvasRuntime.actions?.undo(); }}>Undo</button>
      <button type="button" disabled={!props.enabled || !canEscape} title="Cancel or deselect (Esc)" aria-keyshortcuts="Escape"
        onClick={() => canvasRuntime.actions?.escape()}>Esc</button>
      <button type="button" title="Reset zoom and center diagram" onClick={() => { const bounds = editor?.getCurrentPageBounds(); if (bounds) editor?.zoomToBounds(bounds.clone().expandBy(100), { animation: { duration: 150 } }); }}>Fit canvas</button>
    </div>
  </div>;
}
