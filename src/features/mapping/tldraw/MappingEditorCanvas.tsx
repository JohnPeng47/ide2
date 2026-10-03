import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Tldraw, useEditor, useQuickReactor, type Editor, type TLComponents } from 'tldraw';
import type { CanvasTransform, DiagramFocus } from '../../../../domain/core/diagrams/diagramCanvas';
import type { CanvasSession } from '../workspace/canvasSession';
import { restoreMappingCamera, saveMappingCamera } from './cameraCompatibility';
import { MappingShapeUtil } from './MappingShapeUtil';
import { MappingEditorRuntime } from './MappingEditorRuntime';
import { ShapeSlots, ShapeSlotsContext } from './shapeSlots';
import { mappingShapeId } from './shapeProjection';
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
  const slots = useMemo(() => { const slots = new ShapeSlots(); slots.controller = props.session.controller; return slots; }, [props.session]);
  const [editor, setEditor] = useState<Editor>();
  const transformCallback = useRef(props.onTransformChange); transformCallback.current = props.onTransformChange;
  const initial = useRef(props.initialTransform);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!editor) return;
    slots.editor = editor;
    editor.setCameraOptions({ zoomSteps: [.25, .5, 1, 2, 4] });
    const runtime = new MappingEditorRuntime(editor, props.session.controller);
    // Existing application interactions own buttons, text inputs and pane bodies.
    const stopUiPointer = (event: PointerEvent) => {
      if ((event.target as Element).closest('button,input,textarea,select,a,[contenteditable=true]')) editor.markEventAsHandled(event);
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
      const { x, y, z } = editor.getCamera(), key = `${x}:${y}:${z}`;
      if (last === key) return;
      last = key; transformCallback.current?.(saveMappingCamera({ x, y, z }));
    };
    editor.on('tick', publishCamera);
    return () => { element.removeEventListener('pointerdown', stopUiPointer, true); runtime.dispose(); editor.off('tick', publishCamera); slots.editor = undefined; };
  }, [editor, props.session, slots]);
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
      if (point) editor.centerOnPoint({ x: point.x - 170 / editor.getZoomLevel(), y: point.y });
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
    <ShapeSlotsContext.Provider value={slots}><ContentContext.Provider value={props.children}>
      <Tldraw licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} shapeUtils={shapeUtils} components={components} hideUi onMount={setEditor} overrides={{ tools: (_editor, tools) => ({ select: tools.select, hand: tools.hand }), actions: () => ({}) }}
        options={{ maxShapesPerPage: 10000, createTextOnCanvasDoubleClick: false }} autoFocus={false} />
    </ContentContext.Provider></ShapeSlotsContext.Provider>
    <div className="diagram-canvas__controls" data-diagram-canvas-static-ui>
      <button type="button" onClick={() => editor?.setCurrentTool('select')}>Select</button>
      <button type="button" onClick={() => editor?.setCurrentTool('hand')}>Pan</button>
      <button type="button" title="Reset zoom and center diagram" onClick={() => { const bounds = editor?.getCurrentPageBounds(); if (bounds) editor?.zoomToBounds(bounds.clone().expandBy(100), { animation: { duration: 150 } }); }}>Fit canvas</button>
    </div>
  </div>;
}
