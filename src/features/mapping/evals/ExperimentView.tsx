import { useState } from 'react';
import { experimentOutput, experimentProgress, experimentRunIds, type EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import type { ExperimentRoute } from './ExperimentExplorer';
import type { PickedOutput } from './EvalsTree';
import { statusLabel } from './evalsFormat';

export function ExperimentView({ experiment, route, runs, judgements, onOpen, picked, onPick }: {
  experiment: EvalExperiment; route: ExperimentRoute; runs: EvalRunSummary[]; judgements: JudgementSummary[];
  onOpen: (route: ExperimentRoute | { kind: 'run'; id: string; output?: string } | { kind: 'judgements'; judgementId: string }) => void;
  picked: PickedOutput[]; onPick: (output: PickedOutput, on: boolean) => void;
}) {
  const [filter, setFilter] = useState('');
  const progress = experimentProgress(experiment, runs), byCase = experiment.cases.length > 1;
  const view = route.view ?? 'overview';
  const samples = experiment.samples.filter(s => (!route.groupId || (byCase ? s.caseId : s.conditionId) === route.groupId)
    && (!filter || (byCase ? s.conditionId : s.caseId) === filter));
  const group = (byCase ? experiment.cases : experiment.conditions).find(g => g.id === route.groupId);
  const reports = <div className="experiment-table-scroll"><table className="experiment-table"><thead><tr><th>Comparison</th><th>Conditions</th><th>Judgements</th></tr></thead><tbody>
    {experiment.comparisons.map(comparison => <tr key={comparison.id}><th scope="row">{comparison.name}{comparison.description && <p className="evals-muted">{comparison.description}</p>}</th>
      <td>{comparison.conditionIds.map(id => experiment.conditions.find(c => c.id === id)?.name).join(' · ')}</td>
      <td>{comparison.judgementIds.length ? comparison.judgementIds.map((id, i) => {
        const report = judgements.find(j => j.id === id);
        return report ? <button className="evals-link experiment-report-link" key={id} onClick={() => onOpen({ kind: 'judgements', judgementId: id })}>
          <span className="evals-dot" data-status={report.status} />{comparison.judgementIds.length === 1 ? 'Open report' : `Assessment ${i + 1}`} · {statusLabel[report.status]}</button>
          : <span key={id} className="evals-muted">Report unavailable</span>;
      }) : <span className="evals-muted">Planned</span>}</td></tr>)}
    {!experiment.comparisons.length && <tr><td colSpan={3}>No assessments configured.</td></tr>}
  </tbody></table></div>;
  return <div className="experiment-view">
    <header><h2>{experiment.name}</h2><p>{experiment.description}</p><p className="evals-muted">{progress.finished}/{progress.total} stage outputs · {experiment.cases.length} input cases · {experiment.conditions.length} conditions · {experiment.samples.length} sample attempts</p></header>
    <nav className="evals-actions" aria-label="Experiment views">{(['overview', 'judgements', 'outputs'] as const).map(tab => <button key={tab} aria-current={view === tab ? 'page' : undefined}
      onClick={() => onOpen({ kind: 'experiment', id: experiment.id, view: tab })}>{tab === 'overview' ? 'Overview' : tab === 'judgements' ? 'Judgements' : 'Outputs'}</button>)}</nav>
    {view !== 'outputs' && <><h3>Comparisons</h3>{reports}</>}
    {view === 'overview' && <>
      <h3>Experimental design</h3><div className="experiment-design"><section><h4>Conditions</h4>{experiment.conditions.map(c => <p key={c.id}><button className="evals-link" onClick={() => onOpen({ kind: 'experiment', id: experiment.id, view: 'outputs', ...(!byCase ? { groupId: c.id } : {}) })}>{c.name}</button> · {experiment.samples.filter(s => s.conditionId === c.id).length} samples{c.description && <small>{c.description}</small>}</p>)}</section>
      <section><h4>Input cases</h4>{experiment.cases.map(c => <details key={c.id}><summary>{c.name}</summary><p>Saved context: <code>{c.agentContextId}</code></p>{c.contentHash && <p>Hash: <code>{c.contentHash}</code></p>}</details>)}</section></div>
    </>}
    {view !== 'judgements' && <><h3>{group?.name ?? 'Workflow outputs'}</h3><p className="evals-muted">{experiment.workflow.name} · v{experiment.workflow.version}</p>
      <p className="experiment-pipeline">{experiment.workflow.stages.map(s => s.name).join(' → ')}</p>
      {view === 'outputs' && (byCase ? experiment.conditions : experiment.cases).length > 1 && <label>Filter {byCase ? 'condition' : 'input case'} <select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All</option>{(byCase ? experiment.conditions : experiment.cases).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="experiment-table-scroll"><table className="experiment-table" aria-label="Workflow outputs"><thead><tr><th>Input / condition / sample</th>{experiment.workflow.stages.map(stage => <th key={stage.id} title={stage.dependsOn.length ? `Requires: ${stage.dependsOn.join(', ')}` : 'Initial stage'}>{stage.name}</th>)}</tr></thead><tbody>
        {samples.map(sample => <tr key={sample.id}><th scope="row">{byCase && <small>{experiment.cases.find(c => c.id === sample.caseId)?.name}</small>}{experiment.conditions.find(c => c.id === sample.conditionId)?.name}<small>Sample {sample.number}{sample.attempt > 1 ? ` · Attempt ${sample.attempt}` : ''}</small></th>
          {experiment.workflow.stages.map(stage => {
            const output = sample.outputs.find(o => o.stageId === stage.id), cell = output && experimentOutput(output, runs);
            const label = `${experiment.conditions.find(c => c.id === sample.conditionId)?.name} · sample ${sample.number} · ${stage.name}`;
            return <td key={stage.id}>{!output ? <span className="evals-muted">Pending</span> : !cell || cell.deleted ? <span className="evals-muted">Output unavailable</span> : <>
              {cell.status === 'finished' && cell.canvasId && <input type="checkbox" aria-label={`Select ${label} for comparison`} checked={picked.some(p => p.canvasId === cell.canvasId)}
                onChange={event => onPick({ canvasId: cell.canvasId!, checkpointId: cell.checkpointId, runId: output.runId, label }, event.target.checked)} />}{' '}
              <button className="evals-link" onClick={() => onOpen({ kind: 'run', id: output.runId, output: output.cellKey })}>
              <span className="evals-dot" data-status={cell.status} />{cell.status === 'finished' ? 'Open output' : statusLabel[cell.status]}</button></>}</td>;
          })}</tr>)}
        {!samples.length && <tr><td colSpan={experiment.workflow.stages.length + 1}>No samples planned for this selection.</td></tr>}
      </tbody></table></div>
    </>}
    <details className="experiment-history"><summary>Execution history</summary><p className="evals-muted">Generation batches and retries retain their original pinned prompts and provenance.</p>
      {experimentRunIds(experiment).map(id => { const run = runs.find(r => r.id === id); return <p key={id}>{run ? <button className="evals-link" onClick={() => onOpen({ kind: 'run', id })}>Run #{run.number} · {new Date(run.createdAt).toLocaleString()} · {run.request.model} / {run.request.effort}</button> : `Unavailable run: ${id}`}</p>; })}
    </details>
  </div>;
}
