import { ExperimentAssessments } from './ExperimentAssessments';
import { GenerationReview } from './GenerationReview';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { ExperimentPrompts } from './ExperimentPrompts';
import { useState } from 'react';
import { experimentOutput, experimentProgress, experimentRunIds, type EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import type { ExperimentRoute } from './ExperimentExplorer';
import type { PickedOutput } from './EvalsTree';
import { statusLabel } from './evalsFormat';

export function ExperimentView({ experiment, route, runs, prompts, judgements, onOpen, picked, onPick, onChanged }: {
  experiment: EvalExperiment; route: ExperimentRoute; runs: EvalRunSummary[]; prompts: EvalPrompt[]; judgements: JudgementSummary[];
  onOpen: (route: ExperimentRoute | { kind: 'run'; id: string; output?: string } | { kind: 'judgements'; judgementId: string }) => void;
  onChanged: () => Promise<unknown>;
  picked: PickedOutput[]; onPick: (output: PickedOutput, on: boolean) => void;
}) {
  const [filter, setFilter] = useState('');
  const progress = experimentProgress(experiment, runs), byCase = experiment.cases.length > 1;
  const view = route.view ?? 'overview';
  const samples = experiment.samples.filter(s => (!route.phaseId || s.phaseId === route.phaseId) && (!route.groupId || (byCase ? s.caseId : s.conditionId) === route.groupId)
    && (!filter || (byCase ? s.conditionId : s.caseId) === filter));
  const group = (byCase ? experiment.cases : experiment.conditions).find(g => g.id === route.groupId);
  const assessments = (phaseId?: string) => <ExperimentAssessments experiment={experiment} comparisons={experiment.comparisons.filter(c => c.phaseId === phaseId)} runs={runs} judgements={judgements} onOpen={onOpen} onChanged={onChanged} />;
  const phase = experiment.phases?.find(p => p.id === route.phaseId);
  return <div className="experiment-view">
    <header><h2>{experiment.name}</h2><p>{experiment.description}</p><p className="evals-muted">{progress.finished}/{progress.total} stage outputs · {experiment.cases.length} input cases · {experiment.conditions.length} conditions · {experiment.samples.length} sample attempts</p></header>
    <nav className="evals-actions" aria-label="Experiment views">{(['overview', 'judgements', 'outputs'] as const).map(tab => <button key={tab} aria-current={view === tab ? 'page' : undefined}
      onClick={() => onOpen({ kind: 'experiment', id: experiment.id, view: tab, phaseId: route.phaseId })}>{tab === 'overview' ? 'Overview' : tab === 'judgements' ? 'Judgements' : 'Outputs'}</button>)}</nav>
    {view !== 'outputs' && !!experiment.phases?.length && <section className="experiment-phases" aria-label="Phases"><h3>Phases</h3>
      {experiment.phases.filter(p => !route.phaseId || p.id === route.phaseId).map(phase => {
        const index = experiment.phases!.findIndex(p => p.id === phase.id);
        const phaseSamples = experiment.samples.filter(s => s.phaseId === phase.id);
        const progress = experimentProgress({ ...experiment, samples: phaseSamples }, runs);
        return <section className="experiment-phase" key={phase.id} aria-label={`Phase ${index + 1}: ${phase.name}`}>
          <header><h4>Phase {index + 1} · {phase.name}</h4><span>{progress.finished}/{progress.total} outputs · {progress.status}</span></header>
          <p>{phase.description}</p>
          <button onClick={() => onOpen({ kind: 'experiment', id: experiment.id, view: 'outputs', phaseId: phase.id })}>View {phase.name} outputs</button>
          <h5>Phase judgements</h5>{assessments(phase.id)}
        </section>;
      })}
    </section>}
    {view === 'overview' && <GenerationReview key={experiment.id} experiment={experiment} onChanged={onChanged} />}
    {view === 'overview' && <ExperimentPrompts experiment={experiment} runs={runs} prompts={prompts} onChanged={onChanged} />}
    {view !== 'outputs' && !experiment.phases?.length && <><h3>Comparisons</h3>{assessments()}</>}
    {view === 'outputs' && <><h3>{phase ? `${phase.name} outputs` : group?.name ?? 'Workflow outputs'}</h3><p className="evals-muted">{experiment.workflow.name} · v{experiment.workflow.version}</p>
      {!!experiment.phases?.length && <label>Phase <select aria-label="Output phase" value={route.phaseId ?? ''} onChange={event => onOpen({ ...route, phaseId: event.target.value || undefined })}><option value="">All phases</option>{experiment.phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {byCase && <label>Input <select aria-label="Output input" value={route.groupId ?? ''} onChange={event => onOpen({ ...route, groupId: event.target.value || undefined })}>
        <option value="">All inputs</option>{experiment.cases.map(input => <option key={input.id} value={input.id}>{input.name}</option>)}
      </select></label>}
      <p className="experiment-pipeline">{experiment.workflow.stages.map(s => s.name).join(' → ')}</p>
      {view === 'outputs' && (byCase ? experiment.conditions : experiment.cases).length > 1 && <label>Filter {byCase ? 'condition' : 'input case'} <select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All</option>{(byCase ? experiment.conditions : experiment.cases).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="experiment-table-scroll"><table className="experiment-table" aria-label="Workflow outputs"><thead><tr><th>Input / condition / sample</th>{experiment.workflow.stages.map(stage => <th key={stage.id} title={stage.dependsOn.length ? `Requires: ${stage.dependsOn.join(', ')}` : 'Initial stage'}>{stage.name}</th>)}</tr></thead><tbody>
        {samples.map(sample => <tr key={sample.id}><th scope="row">{sample.phaseId && <small>{experiment.phases?.find(p => p.id === sample.phaseId)?.name}</small>}{byCase && <small>{experiment.cases.find(c => c.id === sample.caseId)?.name}</small>}{experiment.conditions.find(c => c.id === sample.conditionId)?.name}<small>Sample {sample.number}{sample.attempt > 1 ? ` · Attempt ${sample.attempt}` : ''}</small></th>
          {experiment.workflow.stages.map(stage => {
            const output = sample.outputs.find(o => o.stageId === stage.id), cell = output && experimentOutput(output, runs);
            const label = `${experiment.conditions.find(c => c.id === sample.conditionId)?.name} · sample ${sample.number}${sample.attempt > 1 ? ` · attempt ${sample.attempt}` : ''} · ${stage.name}`;
            return <td key={stage.id}>{!output ? <span className="evals-muted">{sample.relaunchedFrom ? 'Not relaunched' : 'Pending'}</span> : !cell || cell.deleted ? <span className="evals-muted">Output unavailable</span> : <>
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
