import type { CanvasCameraView } from '../../../../domain/core/diagrams/canvasCameraView';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { OutputSidebar, OutputSidebarContext } from './OutputSidebar';
import { CanvasCommentSelection, OutputCommentContext } from './OutputComments';
import { mappingTools, selectionTools } from '../tldraw/SelectionTools';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { contentNodeRect } from '../../../../domain/core/diagrams/contentNodeGeometry';
import { Tldraw, type Editor } from 'tldraw';
import type { CompareCanvasCopy, CameraView } from '../../../../domain/mapping/compare/comparePageSession';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { initialCanvasState, type MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CanvasSession } from '../workspace/canvasSession';
import { CanvasRuntime, CanvasRuntimeContext } from '../tldraw/CanvasRuntimeContext';
import { MappingShapeUtil } from '../tldraw/MappingShapeUtil';
import { DEFAULT_CELL, mappingShapeId, projectMappingShapes } from '../tldraw/shapeProjection';
import { restoreMappingCamera, saveMappingCamera } from '../tldraw/cameraCompatibility';
import { useTheme } from '../../../shared/theme/theme';
import { ComparePaneFrame } from './ComparePaneFrame';
import 'tldraw/tldraw.css';
import '../tldraw/mappingEditor.css';

const shapeUtils = [MappingShapeUtil];
/** Static domain projection with a private editor camera. No live bridge or autosave. */
export function CompareCanvasPane({ copy, camera, focus, focusContentNodeId, focusFit = 'contain', side, detail, actions, fitContent, bare, onDiagramContextMenu, onJump, onCameraChange, restoredCamera }: { copy: CompareCanvasCopy; camera: CameraView; focus?: CanvasCameraView; side?: 'A' | 'B'; detail?: string; actions?: import('react').ReactNode; fitContent?: boolean; bare?: boolean;
  restoredCamera?: CanvasTransform; focusContentNodeId?: string; onCameraChange?: (transform: CanvasTransform) => void;
  onJump?: (target: DiagramJumpTarget) => void;
  /** Reading views fit the width, capped at 26px per line; tall diagrams start at the top. */
  focusFit?: 'contain' | 'width' | 'readable';
  /** Right-click on a diagram box: its grid box ID and the pointer position in client coordinates. */
  onDiagramContextMenu?: (boxId: string, at: { x: number; y: number }) => void }) {
  const theme = useTheme(), root = useRef<HTMLDivElement>(null);
  const outputSidebar = useContext(OutputSidebarContext);
  const comments = useContext(OutputCommentContext);
  const nodeFocus = comments?.activeComment?.anchor?.canvasId === copy.id ? comments.activeComment : undefined;
  const [editor, setEditor] = useState<Editor>();
  const [focusError, setFocusError] = useState('');
  const session = useMemo(() => {
    const history = structuredClone(copy.history), document = documentFromHistory(history);
    const canvas = structuredClone(history.snapshots[history.headId].view ?? initialCanvasState()) as MappingCanvasState;
    canvas.selection = { items: [] };
    return new CanvasSession({ name: copy.view.name, savedName: copy.view.name,
      savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), document, canvas, history });
  }, [copy]);
  const runtime = useMemo(() => {
    const runtime = new CanvasRuntime(session);
    runtime.interaction.set({ disabled: true, subtreeDisabled: true, jumps: false });
    return runtime;
  }, [session]);
  useEffect(() => {
    runtime.interaction.set({ disabled: true, subtreeDisabled: true, jumps: !!onJump });
    runtime.actions = onJump ? { jump: onJump, undo() {}, escape() {}, collapse() {}, move() {}, group() {}, remove() {}, toggleConversation() {}, submit() {}, verbosity() {}, retry() {} } : undefined;
  }, [runtime, onJump]);
  useEffect(() => { const off = runtime.connect(); return () => { off(); session.dispose(); }; }, [runtime, session]);
  useEffect(() => {
    if (!editor) return;
    runtime.editor = editor;
    selectionTools.set(editor, runtime.gestures);
    editor.updateInstanceState({ isReadonly: false });
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    editor.createShapes(projectMappingShapes(session.controller.getSnapshot()));
    editor.setCameraOptions({ zoomSteps: [.05, .1, .25, .5, 1, 2, 4] });
    editor.setCurrentTool('hand');
    editor.updateInstanceState({ isReadonly: true });
    return () => { selectionTools.delete(editor); runtime.editor = undefined; };
  }, [editor, session, runtime]);
  useEffect(() => {
    if (!editor || !onCameraChange) return;
    return editor.store.listen(({ changes }) => {
      if (Object.values(changes.updated).some(([, record]) => record.typeName === 'camera')) onCameraChange(saveMappingCamera(editor.getCamera()));
    });
  }, [editor, onCameraChange]);
  const resetFocus = useCallback(() => {
    if (!editor || !root.current) return;
    setFocusError('');
    if (!focus && !nodeFocus && !fitContent) { editor.setCamera(restoreMappingCamera(camera.transform)); return; }
    // Fitting the whole canvas uses the same pane-measured framing as a focus target.
    let boxes: ({ x: number; y: number; maxX: number; maxY: number } | undefined)[] = focus ? (focus.focus.type === 'DiagramFocused' ? [focus.focus.diagramId] : focus.focus.diagramIds).map(id => editor.getShapePageBounds(mappingShapeId(id)))
      : [editor.getCurrentPageBounds()];
    const selections = nodeFocus?.anchor?.selections ?? (focusContentNodeId && focus?.focus.type === 'DiagramFocused' ? [{
      diagramId: focus.focus.diagramId, nodeIds: [focusContentNodeId], revisionId: runtime.grids.get(focus.focus.diagramId).get()?.diagram?.content.revisionId
    }] : undefined);
    if (selections) {
      const cell = session.controller.getSnapshot().cell ?? DEFAULT_CELL;
      boxes = selections.flatMap(selection => {
        const diagram = runtime.grids.get(selection.diagramId).get()?.diagram;
        const bounds = editor.getShapePageBounds(mappingShapeId(selection.diagramId));
        if (!diagram || !bounds || diagram.content.revisionId !== selection.revisionId) return [undefined];
        return selection.nodeIds.map(id => {
          const node = diagramContentNodes(diagram.content).find(node => node.id === id);
          if (!node) return undefined;
          const rect = contentNodeRect(node);
          return { x: bounds.x + (rect.startColumn - 1) * cell.width, y: bounds.y + (rect.startLine - 1) * cell.height,
            maxX: bounds.x + rect.endColumn * cell.width, maxY: bounds.y + rect.endLine * cell.height };
        });
      });
    }
    if (!focus && !nodeFocus && !boxes[0]) return;
    if (!boxes.length || boxes.some(box => !box)) { setFocusError('The focus target is missing from this snapshot.'); return; }
    const x = Math.min(...boxes.map(box => box!.x)), y = Math.min(...boxes.map(box => box!.y));
    const right = Math.max(...boxes.map(box => box!.maxX)), bottom = Math.max(...boxes.map(box => box!.maxY));
    const { width, height } = root.current.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const padding = 32;
    const byWidth = Math.max(1, width - padding * 2) / Math.max(1, right - x), byHeight = Math.max(1, height - padding * 2) / Math.max(1, bottom - y);
    const reading = (focus || nodeFocus) && focusFit !== 'contain';
    const lineHeight = session.controller.getSnapshot().cell?.height || DEFAULT_CELL.height;
    const maxZoom = (focus || nodeFocus) && focusFit === 'readable' ? 26 / lineHeight : focus ? 4 : 1.5;
    const z = Math.max(.05, Math.min(maxZoom, byWidth, reading ? Infinity : byHeight));
    // A width-fitted diagram taller than the pane starts at its top; the rest is reached by panning.
    const top = reading && (bottom - y) * z > height - padding * 2;
    editor.setCamera({ x: width / (2 * z) - (x + right) / 2, y: top ? padding / z - y : height / (2 * z) - (y + bottom) / 2, z });
  }, [editor, camera, focus, focusContentNodeId, focusFit, fitContent, session, nodeFocus, runtime]);
  // Frame automatically only when the subject changes. Parent re-renders (e.g. polling) must not undo the user's pan and zoom.
  const latestReset = useRef(resetFocus); latestReset.current = resetFocus;
  const subject = `${copy.id}|${focus?.id ?? ''}|${focusContentNodeId ?? ''}|${nodeFocus?.id ?? ''}|${focusFit}|${JSON.stringify(camera.transform)}|${!!fitContent}|${!!editor}`;
  useEffect(() => {
    if (editor && restoredCamera) editor.setCamera(restoreMappingCamera(restoredCamera));
    else latestReset.current();
  }, [subject, session, editor, restoredCamera]);
  const tools = <>{actions}
      <button type="button" onClick={resetFocus}>{focus ? 'Reset focus' : fitContent ? 'Reset view' : 'Reset camera'}</button>
      <button type="button" onClick={() => { const bounds = editor?.getCurrentPageBounds(); if (bounds) editor?.zoomToBounds(bounds.clone().expandBy(40)); }}>Fit</button>
    </>;
  // The innermost diagram box under the pointer; containers and floating panes are ignored.
  const diagramAt = (x: number, y: number) => {
    if (!editor) return undefined;
    const point = editor.screenToPage({ x, y });
    return editor.getCurrentPageShapes().flatMap(shape => {
      const props = (shape as unknown as { props: { nodeId?: string; kind?: string } }).props;
      const bounds = editor.getShapePageBounds(shape.id);
      return props.kind === 'diagram' && props.nodeId?.startsWith('grid:') && bounds?.containsPoint(point) ? [{ boxId: props.nodeId.slice(5), area: bounds.w * bounds.h }] : [];
    }).sort((a, b) => a.area - b.area)[0]?.boxId;
  };
  const contextMenu = (event: import('react').MouseEvent) => {
    const boxId = onDiagramContextMenu && diagramAt(event.clientX, event.clientY);
    if (!boxId) return;
    event.preventDefault(); event.stopPropagation();
    onDiagramContextMenu!(boxId, { x: event.clientX, y: event.clientY });
  };
  const canvas = <div ref={root} tabIndex={-1} data-diagram-canvas data-output-comment={nodeFocus?.id} className="compare-canvas mapping-editor-canvas mapping-poc-canvas" data-compare-pane={side} data-camera-view={focus?.id} data-focus-diagram={focus?.focus.type === 'DiagramFocused' ? focus.focus.diagramId : undefined}
      onWheelCapture={() => editor?.focus({ focusContainer: false })} onContextMenuCapture={contextMenu}>
      <CanvasRuntimeContext.Provider value={runtime}>
        <Tldraw shapeUtils={shapeUtils} tools={mappingTools} hideUi autoFocus={false} colorScheme={theme} onMount={setEditor}
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} options={{ maxShapesPerPage: 10000 }} />
      </CanvasRuntimeContext.Provider>
      {comments && <CanvasCommentSelection key={`${copy.id}:${comments.runId}:${comments.cellKey}:${comments.activeComment?.id ?? ''}`} runtime={runtime} stageRef={root} canvasId={copy.id} checkpointId={copy.generated ? copy.source.checkpointId : undefined} />}
    </div>;
  // Bare: only the canvas, with its tools floating in the corner.
  if (bare) return <section className="compare-pane is-bare" aria-label={`Canvas ${copy.view.name}`}>
    {outputSidebar ? <OutputSidebar><details className="output-canvas-controls"><summary>Canvas controls</summary><div>{tools}</div></details></OutputSidebar>
      : <div className="compare-pane-tools">{tools}</div>}{focusError && <p role="alert">{focusError}</p>}{canvas}</section>;
  return <ComparePaneFrame side={side} title={copy.view.name} subtitle={copy.canvasName} detail={detail} actions={tools}>
    {focusError && <p role="alert">{focusError}</p>}
    {canvas}
  </ComparePaneFrame>;
}
