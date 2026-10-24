import { useMemo, useRef } from 'react';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import { restoreMappingCamera } from '../tldraw/cameraCompatibility';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { canvasViewDiff } from '../../../../domain/mapping/changes/canvasViewDiff';
import { DiagramDiffCanvas } from '../changes/ChangeSessionPreview';
import { changeMigrationPreview } from '../changes/changeMigrationPreview';

export function CanvasViewDiffPreview({ controller, viewId, onClose, camera }: {
  controller: MappingDocumentController; viewId: string; onClose: () => void; camera?: CanvasTransform;
}) {
  // The old canvas wire format includes a legacy stage margin. This preview's
  // stage starts at (0, 0), just like the native canvas, so convert once on open.
  const nativeCamera = camera ? restoreMappingCamera(camera) : { x: 360, y: 100, z: 1 };
  const viewport = useRef<CanvasTransform>({ offset: { x: nativeCamera.x * nativeCamera.z, y: nativeCamera.y * nativeCamera.z }, scale: nativeCamera.z });
  const result = useMemo(() => {
    try {
      const preview = canvasViewDiff(controller.canvasViewComparison(viewId));
      return { preview, migrations: changeMigrationPreview(preview.doc, []) };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [controller, viewId]);
  const { preview } = result;
  return <div className="change-session-preview canvas-view-diff-preview" data-canvas-view-diff={viewId}>
    <div className="change-session-actions">
      <span>{preview?.doc.name ?? 'CanvasView'} · Recorded diagram changes</span>
      {preview && <small>{preview.diff.counts.added} added · {preview.diff.counts.removed} removed · {preview.diff.counts.modified} modified · {preview.diff.counts.moved} moved</small>}
      <button type="button" onClick={onClose}>Close diff</button>
    </div>
    {result.error && <p className="change-preview-message" role="alert">{result.error}</p>}
    {preview && <DiagramDiffCanvas key={preview.doc.id} {...preview} highlightAdded
      initialTransform={viewport.current} onTransformChange={value => { viewport.current = value; }}
      migrations={result.migrations!} serial={0} onJump={() => {}} />}
  </div>;
}
