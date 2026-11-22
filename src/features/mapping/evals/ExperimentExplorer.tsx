import { experimentJudgementIds, experimentProgress, type EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { EvalsSelection } from './EvalsTree';

export type ExperimentRoute = { kind: 'experiment'; id: string; view?: 'overview' | 'outputs' | 'judgements' | 'prompts'; groupId?: string; phaseId?: string; focusPhase?: string };
export function ExperimentExplorer({ experiments, runs, selection, onOpen }: {
  experiments: EvalExperiment[]; runs: EvalRunSummary[]; selection?: EvalsSelection;
  onOpen: (route: ExperimentRoute | Exclude<EvalsSelection, { kind: 'other' }>) => void;
}) {
  const dates = new Map<string, { label: string; experiments: EvalExperiment[] }>();
  for (const experiment of [...experiments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const date = new Date(experiment.createdAt);
    const key = date.toDateString();
    let group = dates.get(key);
    if (!group) {
      group = { label: date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), experiments: [] };
      dates.set(key, group);
    }
    group.experiments.push(experiment);
  }
  return <div className="experiment-explorer" aria-label="Experiments">
    {[...dates].map(([date, group]) => <details key={date} className="experiment-date-folder" open>
      <summary>{group.label}<small>{group.experiments.length}</small></summary>
      <div className="experiment-date-entries">{group.experiments.map(experiment => {
        const progress = experimentProgress(experiment, runs);
        const selected = selection?.kind === 'experiment' && selection.id === experiment.id;
        const reportIds = experimentJudgementIds(experiment);
        const current = selected || selection?.kind === 'judgements' && reportIds.includes(selection.judgementId ?? '')
          || selection?.kind === 'run' && experiment.samples.some(s => s.outputs.some(o => o.runId === selection.id && o.cellKey === selection.output));
        return <button key={experiment.id} className="experiment-nav-link" title={experiment.name}
          aria-current={current ? 'page' : undefined}
          onClick={() => onOpen({ kind: 'experiment', id: experiment.id })}>
          <span>{experiment.name}{!!experiment.tags?.length && <span className="experiment-nav-tags">{experiment.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}</span><small>{progress.finished}/{progress.total}</small>
        </button>;
      })}</div>
    </details>)}
  </div>;
}
