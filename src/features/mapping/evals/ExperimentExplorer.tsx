import { experimentJudgementIds, experimentOutput, experimentProgress, type EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import type { EvalsSelection } from './EvalsTree';

export type ExperimentRoute = { kind: 'experiment'; id: string; view?: 'overview' | 'outputs' | 'judgements'; groupId?: string };
export function ExperimentExplorer({ experiments, runs, judgements, selection, onOpen }: {
  experiments: EvalExperiment[]; runs: EvalRunSummary[]; judgements: JudgementSummary[]; selection?: EvalsSelection;
  onOpen: (route: ExperimentRoute | Exclude<EvalsSelection, { kind: 'other' }>) => void;
}) {
  return <div className="experiment-explorer" aria-label="Experiments">
    {experiments.map(experiment => {
      const progress = experimentProgress(experiment, runs), byCase = experiment.cases.length > 1;
      const groups = byCase ? experiment.cases : experiment.conditions;
      const selected = selection?.kind === 'experiment' && selection.id === experiment.id;
      const reportIds = experimentJudgementIds(experiment);
      const current = selected || selection?.kind === 'judgements' && reportIds.includes(selection.judgementId ?? '')
        || selection?.kind === 'run' && experiment.samples.some(s => s.outputs.some(o => o.runId === selection.id && o.cellKey === selection.output));
      return <details key={experiment.id} open className={`experiment-nav-group${current ? ' is-current' : ''}`}>
        <summary title={experiment.name}><span>{experiment.name}</span><small>{progress.finished}/{progress.total}</small></summary>
        <button className="experiment-nav-link" aria-current={selected && !selection.view ? 'page' : undefined} onClick={() => onOpen({ kind: 'experiment', id: experiment.id })}>Overview</button>
        <details open className="experiment-nav-section"><summary>Judgements <small>{reportIds.length}</small></summary>
          {experiment.comparisons.map(comparison => {
            const reports = comparison.judgementIds.flatMap(id => judgements.find(j => j.id === id) ?? []);
            return reports.length === 1 ? <button key={comparison.id} className="experiment-nav-link" title={comparison.name}
              aria-current={selection?.kind === 'judgements' && selection.judgementId === reports[0].id ? 'page' : undefined}
              onClick={() => onOpen({ kind: 'judgements', judgementId: reports[0].id })}><span className="evals-dot" data-status={reports[0].status} />{comparison.name}</button>
              : <details key={comparison.id}><summary title={comparison.name}>{comparison.name} <small>{reports.length || 'Planned'}</small></summary>
                {reports.map((report, i) => <button key={report.id} className="experiment-nav-link" title={report.title}
                  aria-current={selection?.kind === 'judgements' && selection.judgementId === report.id ? 'page' : undefined}
                  onClick={() => onOpen({ kind: 'judgements', judgementId: report.id })}><span className="evals-dot" data-status={report.status} />Assessment {i + 1}{report.status === 'failed' ? ' · Failed' : ''}</button>)}
              </details>;
          })}
          {!experiment.comparisons.length && <span className="evals-muted">No assessments configured</span>}
        </details>
        <details className="experiment-nav-section" open><summary>Outputs <small>{progress.finished}</small></summary>
          {groups.map(group => {
            const samples = experiment.samples.filter(s => (byCase ? s.caseId : s.conditionId) === group.id);
            const complete = samples.filter(s => experiment.workflow.stages.every(stage => s.outputs.some(o => o.stageId === stage.id && experimentOutput(o, runs)?.status === 'finished' && !experimentOutput(o, runs)?.deleted))).length;
            return <button key={group.id} className="experiment-nav-link" title={group.name}
              aria-current={selected && selection.view === 'outputs' && selection.groupId === group.id ? 'page' : undefined}
              onClick={() => onOpen({ kind: 'experiment', id: experiment.id, view: 'outputs', groupId: group.id })}><span>{group.name}</span><small>{complete}/{samples.length}</small></button>;
          })}
        </details>
      </details>;
    })}
  </div>;
}
