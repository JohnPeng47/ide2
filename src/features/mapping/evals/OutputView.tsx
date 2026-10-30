import type { EvalRunCell } from '../../../../domain/mapping/evals/evalRun';
import { CanvasPreview } from './CanvasPreview';

/** Just the output canvas. Run details and the explanation live in the tree's tooltips. */
export function OutputView({ cell }: { cell: EvalRunCell }) {
  return <div className="output-view">
    {cell.canvasId && !cell.deleted ? <CanvasPreview key={cell.canvasId} canvasId={cell.canvasId} bare />
      : <p className={cell.error ? 'evals-error output-view-message' : 'evals-message'} role={cell.error ? 'alert' : 'status'}>
        {cell.error ?? (cell.deleted ? 'This output was deleted.' : cell.status === 'queued' ? 'Waiting to start…' : cell.status === 'generating' ? 'Generating…' : 'No canvas for this output.')}</p>}
  </div>;
}
