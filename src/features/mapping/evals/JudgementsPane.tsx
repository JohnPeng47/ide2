import { ComparisonReportView } from './ComparisonReportView';
import { FewShotProgress } from './FewShotProgress';
import { useEffect, useState } from 'react';
import { judgementTypes, type Judgement, type JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { ComparisonView } from './ComparisonView';
import { readJudgement } from './evalsApi';
import { errorMessage } from './evalsFormat';

function ComparisonJudgement({ judgement, prompts }: { judgement: Judgement; prompts: EvalPrompt[] }) {
  if (judgement.kind === 'comparison-report') return judgement.data ? <ComparisonReportView report={judgement.data} canvases={judgement.canvases} /> : null;
  if (!judgement.data || judgement.kind === 'few-shot-progress') return null;
  return <ComparisonView session={{ schemaVersion: 1, id: judgement.id, projectId: judgement.projectId, title: judgement.title,
    createdAt: judgement.createdAt, requestHash: judgement.source.fingerprint, canvases: judgement.canvases, compares: judgement.data.comparisons }} prompts={prompts} />;
}

/** Every result type owns its data schema and display; comparison types reuse their existing panes. */
const judgementViews = {
  'comparison-report': ComparisonJudgement,
  'few-shot-progress': FewShotProgress,
  'diagram-comparison': ComparisonJudgement,
  'canvas-comparison': ComparisonJudgement
} satisfies Record<Judgement['kind'], typeof ComparisonJudgement>;

export function JudgementsPane({ items, selectedId, prompts, onSelect, onDelete }: {
  items: JudgementSummary[]; selectedId?: string; prompts: EvalPrompt[];
  onSelect: (id: string) => void; onDelete: (item: JudgementSummary) => void;
}) {
  const selected = items.find(item => item.id === selectedId) ?? items.at(-1);
  const [loaded, setLoaded] = useState<Judgement>(), [error, setError] = useState('');
  useEffect(() => {
    setLoaded(undefined); setError('');
    if (!selected) return;
    let closed = false;
    void readJudgement(selected.id).then(value => { if (!closed) setLoaded(value); }).catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [selected?.id, selected?.status, selected?.updatedAt]);
  if (!selected) return <section className="evals-message" aria-label="Judgements"><h2>Judgements</h2><p>No judgements are attached.</p></section>;
  const judgement = loaded?.id === selected.id ? loaded : undefined;
  const View = judgementViews[selected.kind];
  return <section className="judgements-pane" aria-label="Judgements">
    <header className="judgements-toolbar">
      <h2>Judgements</h2>
      <label>Result <select aria-label="Judgement" value={selected.id} onChange={event => onSelect(event.target.value)}>
        {items.map(item => <option key={item.id} value={item.id}>{item.title} · {judgementTypes[item.kind].label}</option>)}
      </select></label>
      <span className="evals-muted">{selected.evaluator.kind === 'model' ? `${selected.evaluator.model} · ${selected.evaluator.effort} effort` : 'Manual comparison'}</span>
      {selected.runIds.length > 1 && <span className="evals-muted">Shared by {selected.runIds.length} runs</span>}
      <button type="button" className="is-danger" onClick={() => onDelete(selected)}>Delete judgement</button>
    </header>
    {judgement?.kind === 'comparison-report' && judgement.evaluator.kind === 'model' && judgement.evaluator.prompt && <details className="judgement-prompt"><summary>Judge prompt and inputs</summary><pre>{judgement.evaluator.prompt}</pre></details>}
    {error ? <p role="alert" className="evals-error">{error}</p> : !judgement ? <p role="status" className="evals-message">Loading judgement…</p>
      : judgement.kind === 'few-shot-progress' ? <>{judgement.error && <p role="alert" className="evals-error">{judgement.error}</p>}{judgement.status === 'generating' && <p role="status">Refining examples and evaluating outputs…</p>}<FewShotProgress judgement={judgement} /></>
      : judgement.status === 'failed' ? <p role="alert" className="evals-error">{judgement.error ?? 'Evaluation failed.'}</p>
      : judgement.status !== 'finished' ? <p role="status" className="evals-message">{judgement.status === 'queued' ? 'Queued for evaluation…' : 'Evaluating outputs…'}</p>
      : <View judgement={judgement} prompts={prompts} />}
  </section>;
}
