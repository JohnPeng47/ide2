import { tokens, statusLabel } from './evalsFormat';
import type { EvalRunSummary, EvalRunCell } from '../../../../domain/mapping/evals/evalRun';
import { CanvasPreview } from './CanvasPreview';
import { OutputResultPreview } from './OutputResultPreview';

/** Just the output canvas. Run details and the explanation live in the tree's tooltips. */
export function OutputView({ cell, run }: { cell: EvalRunCell; run?: EvalRunSummary }) {
  return <div className="output-view">
    <details className="output-details"><summary>Generation details · {statusLabel[cell.status]}</summary>
      {cell.explanation && <p>{cell.explanation}</p>}
      <p>{run?.request.model} · {run?.request.effort} effort
        {tokens(cell.usage) !== undefined && ` · ${tokens(cell.usage)} tokens`}
        {cell.startedAt && cell.completedAt && ` · ${Math.max(0, (Date.parse(cell.completedAt) - Date.parse(cell.startedAt)) / 1000).toFixed(1)}s`}</p>
      {run?.prompts.filter(prompt => prompt.promptId === cell.promptId).map(prompt => <details key={prompt.promptId}><summary>{prompt.name} · captured prompt</summary>
        {Object.entries(prompt.stages).map(([stage, text]) => <section key={stage}><strong>{stage}</strong><pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre></section>)}
      </details>)}
      {run?.previousNames?.length ? <p>Earlier alternatives: {run.previousNames.join(', ')}</p> : null}
      {run?.compatibility && <p>Generated in Agent Chat. Saved view and chat IDs are retained: {run.compatibility.candidates.map(c => `${c.name}: ${c.viewId} / ${c.chatId}`).join('; ')}</p>}
    </details>
    {!cell.output && cell.deleted && cell.checkpointId && <p className="evals-notice">The original output was deleted. Showing the pinned run snapshot.</p>}
    {cell.output && run ? <OutputResultPreview key={`${run.id}:${cell.key}`} runId={run.id} cellKey={cell.key} />
      : cell.canvasId && (!cell.deleted || cell.checkpointId) ? <CanvasPreview key={cell.canvasId} canvasId={cell.canvasId} checkpointId={cell.checkpointId} promotionSource={run ? { runId: run.id, cellKey: cell.key } : undefined} deleted={cell.deleted} bare />
      : <p className={cell.error ? 'evals-error output-view-message' : 'evals-message'} role={cell.error ? 'alert' : 'status'}>
        {cell.error ?? (cell.deleted ? 'This output was deleted.' : cell.status === 'queued' ? 'Waiting to start…' : cell.status === 'generating' ? 'Generating…' : 'No canvas for this output.')}</p>}
  </div>;
}
