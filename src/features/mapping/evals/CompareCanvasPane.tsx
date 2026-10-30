import type { CanvasCameraView } from '../../../../domain/core/diagrams/canvasCameraView';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import type { CompareCanvasCopy, CameraView } from '../../../../domain/mapping/compare/comparePageSession';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { initialCanvasState, type MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CanvasSession } from '../workspace/canvasSession';
import { CanvasRuntime, CanvasRuntimeContext } from '../tldraw/CanvasRuntimeContext';
import { MappingShapeUtil } from '../tldraw/MappingShapeUtil';
import { mappingShapeId, projectMappingShapes } from '../tldraw/shapeProjection';
import { restoreMappingCamera } from '../tldraw/cameraCompatibility';
import { useTheme } from '../../../shared/theme/theme';
import { ComparePaneFrame } from './ComparePaneFrame';
import 'tldraw/tldraw.css';
import '../tldraw/mappingEditor.css';

const shapeUtils = [MappingShapeUtil];
/** Static domain projection with a private editor camera. No live bridge or autosave. */
export function CompareCanvasPane({ copy, camera, focus, side, detail, actions, fitContent, bare }: { copy: CompareCanvasCopy; camera: CameraView; focus?: CanvasCameraView; side?: 'A' | 'B'; detail?: string; actions?: import('react').ReactNode; fitContent?: boolean; bare?: boolean }) {
  const theme = useTheme(), root = useRef<HTMLDivElement>(null);
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
  useEffect(() => { const off = runtime.connect(); return () => { off(); session.dispose(); }; }, [runtime, session]);
  useEffect(() => {
    if (!editor) return;
    runtime.editor = editor;
    editor.updateInstanceState({ isReadonly: false });
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    editor.createShapes(projectMappingShapes(session.controller.getSnapshot()));
    editor.setCameraOptions({ zoomSteps: [.05, .1, .25, .5, 1, 2, 4] });
    editor.setCurrentTool('hand');
    editor.updateInstanceState({ isReadonly: true });
    return () => { runtime.editor = undefined; };
  }, [editor, session, runtime]);
  const resetFocus = useCallback(() => {
    if (!editor || !root.current) return;
    setFocusError('');
    if (!focus && !fitContent) { editor.setCamera(restoreMappingCamera(camera.transform)); return; }
    // Fitting the whole canvas uses the same pane-measured framing as a focus target.
    const boxes = focus ? (focus.focus.type === 'DiagramFocused' ? [focus.focus.diagramId] : focus.focus.diagramIds).map(id => editor.getShapePageBounds(mappingShapeId(id)))
      : [editor.getCurrentPageBounds()];
    if (!focus && !boxes[0]) return;
    if (boxes.some(box => !box)) { setFocusError('The focus target is missing from this snapshot.'); return; }
    const x = Math.min(...boxes.map(box => box!.x)), y = Math.min(...boxes.map(box => box!.y));
    const right = Math.max(...boxes.map(box => box!.maxX)), bottom = Math.max(...boxes.map(box => box!.maxY));
    const { width, height } = root.current.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const padding = 32;
    const z = Math.max(.05, Math.min(focus ? 4 : 1.5, Math.max(1, width - padding * 2) / Math.max(1, right - x), Math.max(1, height - padding * 2) / Math.max(1, bottom - y)));
    editor.setCamera({ x: width / (2 * z) - (x + right) / 2, y: height / (2 * z) - (y + bottom) / 2, z });
  }, [editor, camera, focus, fitContent]);
  // Frame automatically only when the subject changes. Parent re-renders (e.g. polling) must not undo the user's pan and zoom.
  const latestReset = useRef(resetFocus); latestReset.current = resetFocus;
  const subject = `${copy.id}|${focus?.id ?? ''}|${JSON.stringify(camera.transform)}|${!!fitContent}|${!!editor}`;
  useEffect(() => { latestReset.current(); }, [subject, session]);
  const tools = <>{actions}
      <button type="button" onClick={resetFocus}>{focus ? 'Reset focus' : fitContent ? 'Reset view' : 'Reset camera'}</button>
      <button type="button" onClick={() => { const bounds = editor?.getCurrentPageBounds(); if (bounds) editor?.zoomToBounds(bounds.clone().expandBy(40)); }}>Fit</button>
    </>;
  const canvas = <div ref={root} className="compare-canvas mapping-editor-canvas mapping-poc-canvas" data-compare-pane={side} data-camera-view={focus?.id} data-focus-diagram={focus?.focus.type === 'DiagramFocused' ? focus.focus.diagramId : undefined}
      onWheelCapture={() => editor?.focus({ focusContainer: false })}>
      <CanvasRuntimeContext.Provider value={runtime}>
        <Tldraw shapeUtils={shapeUtils} hideUi autoFocus={false} colorScheme={theme} onMount={setEditor}
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} options={{ maxShapesPerPage: 10000 }} />
      </CanvasRuntimeContext.Provider>
    </div>;
  // Bare: only the canvas, with its tools floating in the corner.
  if (bare) return <section className="compare-pane is-bare" aria-label={`Canvas ${copy.view.name}`}>
    <div className="compare-pane-tools">{tools}</div>{focusError && <p role="alert">{focusError}</p>}{canvas}</section>;
  return <ComparePaneFrame side={side} title={copy.view.name} subtitle={copy.canvasName} detail={detail} actions={tools}>
    {focusError && <p role="alert">{focusError}</p>}
    {canvas}
  </ComparePaneFrame>;
}
