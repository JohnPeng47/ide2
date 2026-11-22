import { authoredStages } from '../../../../domain/mapping/evals/promptTemplateIncludes';
import { useNavigationDraft } from './evalHistory';
import { useRef, useState } from 'react';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import type { ExperimentPromptSource } from '../../../../domain/mapping/evals/experimentOverview';
import type { EvalRunPrompt, EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { legacyPromptTemplateBase } from '../../../../domain/mapping/evals/promptTemplateBase';
import { Drawer } from './Drawer';
import { rerunExperiment, savePrompt } from './evalsApi';
import { errorMessage } from './evalsFormat';

export interface PromptEditSource {
  source: ExperimentPromptSource;
  run: EvalRunSummary;
  prompt: EvalRunPrompt;
}

export function ExperimentPromptEdit({ sources, stage, experiment, onClose, onRerun, onChanged }: {
  sources: PromptEditSource[]; stage: string; experiment: EvalExperiment; onClose: () => void;
  onRerun: (experiment: EvalExperiment, runId: string) => void; onChanged: () => Promise<unknown>;
}) {
  const [index, setIndex] = useState(0);
  const { source, run, prompt } = sources[index];
  const bodies = authoredStages(prompt);
  const [text, setText] = useState(bodies[stage]);
  const [saved, setSaved] = useState<EvalPrompt>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useNavigationDraft(!saved && text !== bodies[stage]);
  const saveId = useRef<string>(undefined);
  const rerunId = useRef<string>(undefined);
  const registered = experiment.samples.some(sample => sample.id === source.sampleId && sample.outputs.some(output => output.runId === run.id && output.cellKey === source.cellKey));
  const replayable = registered && !run.coordinator && !run.legacy && !run.compatibility && run.workflow !== 'diagram-history' && !run.request.task;
  const save = async () => {
    setBusy(true); setError('');
    try {
      const result = await savePrompt({ requestId: saveId.current ??= crypto.randomUUID(), workflow: run.workflow,
        name: `${prompt.name.slice(0, 111)} · edited`, stages: { ...bodies, [stage]: text },
        templateBase: prompt.templateBase ?? legacyPromptTemplateBase(prompt.stages),
        derivation: source.version ? { kind: 'fork', parent: { promptId: source.promptId, version: source.version } } : undefined });
      setSaved(result);
      void onChanged().catch(() => {});
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  const launch = async () => {
    if (!saved) return;
    setBusy(true); setError('');
    try {
      const result = await rerunExperiment(experiment.id, { requestId: rerunId.current ??= crypto.randomUUID(), expectedRevision: experiment.revision,
        runId: run.id, cellKey: source.cellKey, prompt: { promptId: saved.id, version: saved.versions[0].version } });
      onRerun(result.experiment, result.runId);
      void onChanged().catch(() => {});
    } catch (cause) {
      setError(errorMessage(cause));
      await onChanged().catch(() => {});
    } finally { setBusy(false); }
  };
  const runLabel = (run: EvalRunSummary) => `${run.name ?? (run.number ? `Run #${run.number}` : run.id)} · ${run.request.model} / ${run.request.effort} · n=${run.request.passes}`;
  return <Drawer key={saved ? 'saved' : 'edit'} title={saved ? 'Prompt saved' : 'Edit prompt'} wide={!saved} onClose={() => { if (!busy) onClose(); }}>
    {saved ? <>
      <p>Saved <a className="evals-link" href={`?prompt=${encodeURIComponent(saved.id)}&version=${saved.versions[0].version}`}>{saved.name}</a> in the prompt library.</p>
      {replayable ? <><p>Rerun with the same arguments?</p><p className="evals-muted">{runLabel(run)}</p></>
        : <p className="evals-muted">{registered ? 'This run requires its original executor.' : 'This generation has not started yet.'}</p>}
      <div className="evals-actions">
        {replayable && <button type="button" className="is-primary" disabled={busy} onClick={launch}>{busy ? 'Starting…' : 'Rerun'}</button>}
        <button type="button" disabled={busy} onClick={onClose}>{replayable ? 'Not now' : 'Done'}</button>
      </div>
    </> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      {sources.length > 1 && <label className="evals-field">Source run<select disabled={busy} value={index} onChange={event => {
        setIndex(Number(event.target.value)); setText(authoredStages(sources[Number(event.target.value)].prompt)[stage]); saveId.current = undefined; setError('');
      }}>{sources.map(({ run, prompt }, i) => <option key={i} value={i}>{runLabel(run)} · {prompt.name}</option>)}</select></label>}
      <label className="experiment-prompt-edit-field">{prompt.name} · {stage}
        <textarea autoFocus aria-label="Prompt text" disabled={busy} value={text} onChange={event => {
          setText(event.target.value); saveId.current = undefined; setError('');
        }} />
      </label>
      <div className="evals-actions">
        <button className="is-primary" type="submit" disabled={busy || !text.trim() || text === bodies[stage]}>{busy ? 'Saving…' : 'Save prompt'}</button>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </form>}
    {error && <p className="evals-error" role="alert">{error}</p>}
  </Drawer>;
}
