import { DiagramChangeTreeJudgement } from './DiagramChangeTreeJudgement';
import { ComparisonReportView } from './ComparisonReportView';
import { FewShotProgress } from './FewShotProgress';
import { useEffect, useState } from 'react';
import { judgementTypes, type Judgement, type JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { ComparisonView } from './ComparisonView';
import { readJudgement } from './evalsApi';
import { errorMessage } from './evalsFormat';
import { ExperimentOutputPanel } from './ExperimentOutputPanel';
import { ItemToolbarPortal, useItemToolbar } from './ItemToolbar';

function ComparisonJudgement({ judgement, prompts, step, onStep }: { judgement: Judgement; prompts: EvalPrompt[]; step?: string; onStep?: (key: string) => void }) {
  if (judgement.kind === 'comparison-report') return judgement.data ? <ComparisonReportView key={judgement.id} report={judgement.data} canvases={judgement.canvases} step={step} onStep={onStep} /> : null;
  if (!judgement.data || judgement.kind === 'few-shot-progress' || judgement.kind === 'diagram-change-tree') return null;
  return <ComparisonView key={judgement.id} session={{ schemaVersion: 1, id: judgement.id, projectId: judgement.projectId, title: judgement.title,
    createdAt: judgement.createdAt, requestHash: judgement.source.fingerprint, canvases: judgement.canvases, compares: judgement.data.comparisons }} prompts={prompts} />;
}

/** Every result type owns its data schema and display; comparison types reuse their existing panes. */
const judgementViews = {
  'diagram-change-tree': DiagramChangeTreeJudgement,
  'comparison-report': ComparisonJudgement,
  'few-shot-progress': FewShotProgress,
  'diagram-comparison': ComparisonJudgement,
  'canvas-comparison': ComparisonJudgement
} satisfies Record<Judgement['kind'], typeof ComparisonJudgement>;

export function JudgementsPane({ items, selectedId, prompts, onSelect, onDelete, step, onStep, onLoaded }: {
  items: JudgementSummary[]; selectedId?: string; prompts: EvalPrompt[];
  onSelect: (id: string) => void; onDelete: (item: JudgementSummary) => void;
  /** Controlled report step, mirrored in the URL; onLoaded exposes the open judgement to the sidebar tree. */
  step?: string; onStep?: (key: string) => void; onLoaded?: (judgement: Judgement | undefined) => void;
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
  const selectedIndex = items.findIndex(item => item.id === selected?.id);
  const slot = useItemToolbar();
  const shown = selected && loaded?.id === selected.id ? loaded : undefined;
  useEffect(() => { onLoaded?.(shown); }, [shown]);
  if (!selected) return <section className="evals-message" aria-label="Judgements"><h2>Judgements</h2><p>No judgements are attached.</p></section>;
  const judgement = loaded?.id === selected.id ? loaded : undefined;
  const View = judgementViews[selected.kind];
  const resultSelect = <select aria-label="Judgement" value={selected.id} onChange={event => onSelect(event.target.value)}>
    {items.map(item => <option key={item.id} value={item.id}>{item.title} · {judgementTypes[item.kind].label}</option>)}
  </select>;
  const details = <details className="judgements-info"><summary>Details</summary><div>
        <p>{selected.evaluator.kind === 'model' ? `${selected.evaluator.model} · ${selected.evaluator.effort} effort` : selected.evaluator.kind === 'deterministic' ? `Deterministic · ${selected.evaluator.parser} v${selected.evaluator.version}` : 'Manual comparison'}</p>
        {selected.runIds.length > 1 && <p>Shared by {selected.runIds.length} runs</p>}
        {judgement?.kind === 'comparison-report' && judgement.evaluator.kind === 'model' && judgement.evaluator.prompt && <details className="judgement-prompt"><summary>Judge prompt and inputs</summary><pre>{judgement.evaluator.prompt}</pre></details>}
        <button type="button" className="is-danger" onClick={() => onDelete(selected)}>Delete judgement</button>
      </div></details>;
  return <section className="judgements-pane" aria-label="Judgements">
    {slot ? <ItemToolbarPortal group="judgement">{items.length > 1 && resultSelect}{details}</ItemToolbarPortal>
      : <header className="judgements-toolbar">
        <h2>Judgements</h2>
        <label>Result {resultSelect}</label>
        <span className="judgement-position">{selectedIndex + 1} / {items.length}</span>
        {details}
      </header>}
    {error ? <p role="alert" className="evals-error">{error}</p> : !judgement ? <p role="status" className="evals-message">Loading judgement…</p>
      : judgement.kind === 'few-shot-progress' ? <ExperimentOutputPanel key={judgement.id} title={judgement.title}>{judgement.error && <p role="alert" className="evals-error">{judgement.error}</p>}{judgement.status === 'generating' && <p role="status">Refining examples and evaluating outputs…</p>}<FewShotProgress judgement={judgement} /></ExperimentOutputPanel>
      : judgement.status === 'failed' ? <p role="alert" className="evals-error">{judgement.error ?? 'Evaluation failed.'}</p>
      : judgement.status !== 'finished' ? <p role="status" className="evals-message">{judgement.status === 'queued' ? 'Queued for evaluation…' : 'Evaluating outputs…'}</p>
      : judgement.kind === 'diagram-change-tree' ? <ExperimentOutputPanel key={judgement.id} title={judgement.title}><DiagramChangeTreeJudgement judgement={judgement} /></ExperimentOutputPanel>
      : <View judgement={judgement} prompts={prompts} step={step} onStep={onStep} />}
  </section>;
}
