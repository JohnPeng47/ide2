import { useRef, useState } from 'react';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import { experimentOutput } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import { judgeExperiment } from './evalsApi';
import { errorMessage, statusLabel } from './evalsFormat';

export function ExperimentAssessments({ experiment, comparisons, judgements, runs, onOpen, onChanged }: {
  experiment: EvalExperiment; comparisons: EvalExperiment['comparisons']; judgements: JudgementSummary[]; runs: EvalRunSummary[];
  onOpen: (route: { kind: 'judgements'; judgementId: string }) => void; onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ requestId: string; expectedRevision: number; comparisonId: string } | undefined>(undefined);
  const judge = async (comparisonId: string) => {
    if (pending.current?.comparisonId !== comparisonId || pending.current.expectedRevision !== experiment.revision)
      pending.current = { requestId: crypto.randomUUID(), expectedRevision: experiment.revision, comparisonId };
    setBusy(true); setError('');
    try { await judgeExperiment(experiment.id, pending.current); pending.current = undefined; await onChanged(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <>{error && <p role="alert">{error}</p>}<div className="experiment-table-scroll"><table className="experiment-table"><thead><tr><th>Assessment</th><th>Conditions</th><th>Judgements</th></tr></thead><tbody>
    {comparisons.map(comparison => {
      const samples = experiment.samples.filter(s => s.phaseId === comparison.phaseId && comparison.caseIds.includes(s.caseId) && comparison.conditionIds.includes(s.conditionId));
      const ready = samples.length > 0 && samples.every(s => s.outputs.length > 0 && (s.relaunchedFrom || s.outputs.length === experiment.workflow.stages.length)
        && s.outputs.every(o => { const cell = experimentOutput(o, runs); return cell?.status === 'finished' && cell.proposalTree !== undefined && !cell.deleted; }));
      return <tr key={comparison.id}><th scope="row">{comparison.name}{comparison.description && <p className="evals-muted">{comparison.description}</p>}
        {comparison.evaluator && <small>Deterministic · {comparison.evaluator.parser} v{comparison.evaluator.version}</small>}</th>
        <td>{comparison.conditionIds.map(id => experiment.conditions.find(c => c.id === id)?.name).join(' · ')}</td>
        <td>{comparison.judgementIds.length ? comparison.judgementIds.map((id, i) => {
          const report = judgements.find(j => j.id === id);
          return report ? <button className="evals-link experiment-report-link" key={id} onClick={() => onOpen({ kind: 'judgements', judgementId: id })}>
            <span className="evals-dot" data-status={report.status} />{comparison.judgementIds.length === 1 ? 'Open report' : `Assessment ${i + 1}`} · {statusLabel[report.status]}</button>
            : <span key={id} className="evals-muted">Report unavailable</span>;
        }) : <span className="evals-muted">Planned · not run</span>}
        {comparison.evaluator && <p><button disabled={!ready || busy} title={!ready ? 'Requires all completed phase outputs' : undefined} onClick={() => void judge(comparison.id)}>Run deterministic judgement</button></p>}</td></tr>;
    })}
    {!comparisons.length && <tr><td colSpan={3}>No assessments configured.</td></tr>}
  </tbody></table></div></>;
}
