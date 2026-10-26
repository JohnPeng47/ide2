import { useEffect, useMemo, useRef, useState } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import type { CompareCanvasCopy, CameraView } from '../../../../domain/mapping/compare/comparePageSession';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { initialCanvasState, type MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CanvasSession } from '../workspace/canvasSession';
import { CanvasRuntime, CanvasRuntimeContext } from '../tldraw/CanvasRuntimeContext';
import { MappingShapeUtil } from '../tldraw/MappingShapeUtil';
import { projectMappingShapes } from '../tldraw/shapeProjection';
import { restoreMappingCamera } from '../tldraw/cameraCompatibility';
import { useTheme } from '../../../shared/theme/theme';
import 'tldraw/tldraw.css';
import '../tldraw/mappingEditor.css';

const shapeUtils = [MappingShapeUtil];
/** Static domain projection with a private editor camera. No live bridge or autosave. */
export function CompareCanvasPane({ copy, camera, side }: { copy: CompareCanvasCopy; camera: CameraView; side: 'A' | 'B' }) {
  const theme = useTheme(), root = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor>();
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
    editor.setCamera(restoreMappingCamera(camera.transform));
    editor.setCurrentTool('hand');
    editor.updateInstanceState({ isReadonly: true });
    return () => { runtime.editor = undefined; };
  }, [editor, session, runtime, camera]);
  // Keep the world point at the pane's center fixed during split resizing.
  useEffect(() => {
    if (!editor || !root.current) return;
    let previous: { width: number; height: number } | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (previous && width > 0 && height > 0) {
        const camera = editor.getCamera();
        editor.setCamera({ ...camera, x: camera.x + (width - previous.width) / (2 * camera.z), y: camera.y + (height - previous.height) / (2 * camera.z) });
      }
      previous = { width, height };
    });
    observer.observe(root.current); return () => observer.disconnect();
  }, [editor]);
  return <section className="compare-pane" aria-label={`Comparison pane ${side}`}>
    <header className="compare-pane-heading"><span className="compare-side">{side}</span>
      <div><strong>{copy.view.name}</strong><small>{copy.canvasName}</small></div>
      <button type="button" onClick={() => editor?.setCamera(restoreMappingCamera(camera.transform))}>Reset camera</button>
      <button type="button" onClick={() => { const bounds = editor?.getCurrentPageBounds(); if (bounds) editor?.zoomToBounds(bounds.clone().expandBy(40)); }}>Fit</button>
    </header>
    <div ref={root} className="compare-canvas mapping-editor-canvas mapping-poc-canvas" data-compare-pane={side}
      onWheelCapture={() => editor?.focus({ focusContainer: false })}>
      <CanvasRuntimeContext.Provider value={runtime}>
        <Tldraw shapeUtils={shapeUtils} hideUi autoFocus={false} colorScheme={theme} onMount={setEditor}
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY} options={{ maxShapesPerPage: 10000 }} />
      </CanvasRuntimeContext.Provider>
    </div>
  </section>;
}
