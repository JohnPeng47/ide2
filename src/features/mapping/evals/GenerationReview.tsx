import { authoredStages } from '../../../../domain/mapping/evals/promptTemplateIncludes';
import { canResizeGenerationRun, configureGenerationRun, generationModelPresets, generationModelPreset } from '../../../../domain/mapping/evals/generationSettings';
import { PromptSectionsEditor, PromptTextBox } from './PromptSectionsEditor';
import { legacyPromptTemplateBase, parsePromptSections, type PromptTemplateBase } from '../../../../domain/mapping/evals/promptTemplateBase';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { EvalRunPrompt, EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import { approveExperiment, readPrompt, savePrompt, saveExperiment } from './evalsApi';
import { errorMessage } from './evalsFormat';

type SettingsDraft = { passes: number; preset: string; valid: boolean };

export function GenerationReview({ experiment: incomingExperiment, onChanged }: { experiment: EvalExperiment; onChanged: () => Promise<unknown> }) {
  const [savedExperiment, setSavedExperiment] = useState<EvalExperiment>();
  const experiment = savedExperiment && savedExperiment.revision > incomingExperiment.revision ? savedExperiment : incomingExperiment;
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [dirtySettings, setDirtySettings] = useState<Map<string, SettingsDraft>>(new Map());
  const settingsAttempt = useRef<{ signature: string; request: Parameters<typeof saveExperiment>[0] } | undefined>(undefined);
  const pending = useRef<{ requestId: string; expectedRevision: number } | undefined>(undefined);
  const [editing, setEditing] = useState<{ promptId: string; version: number; stage: string; text: string }>();
  const savedEdit = useRef<{ signature: string; promptRequestId: string; experimentRequestId: string; version?: number } | undefined>(undefined);
  useEffect(() => { setReviewed(false); setDirtySettings(new Map()); pending.current = undefined; settingsAttempt.current = undefined; }, [experiment.revision]);
  const review = experiment.generationReview;
  if (!review) return null;
  // A run binds one input; the same pinned prompt can be shared by many runs.
  const promptGroups = new Map<string, { prompt: EvalRunPrompt; runs: EvalRunSummary[] }>();
  for (const run of review.runs) for (const prompt of run.prompts) {
    const key = JSON.stringify(prompt);
    const group = promptGroups.get(key) ?? { prompt, runs: [] };
    group.runs.push(run); promptGroups.set(key, group);
  }
  const inputCount = new Set(review.runs.map(run => run.agentContextId)).size;
  const settings = [...new Set(review.runs.map(run => `${run.request.model} / ${run.request.effort}`))];
  const pendingRunIds = new Set(review.runs.map(run => run.id));
  const editingPrompt = editing && review.runs.flatMap(run => run.prompts).find(p => p.promptId === editing.promptId && p.version === editing.version);
  const launch = async () => {
    pending.current ??= review.approval ?? { requestId: crypto.randomUUID(), expectedRevision: experiment.revision };
    setBusy(true); setError('');
    try { await approveExperiment(experiment.id, pending.current); await onChanged(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const saveSettings = async (runId: string, passes: number, preset: string) => {
    if (busy || review.status !== 'awaiting-approval') return;
    setBusy(true); setError(''); setReviewed(false);
    try {
      const signature = JSON.stringify({ runId, passes, preset, revision: experiment.revision });
      if (settingsAttempt.current?.signature !== signature) settingsAttempt.current = { signature, request: {
        requestId: crypto.randomUUID(), experimentId: experiment.id, expectedRevision: experiment.revision,
        experiment: configureGenerationRun(experiment, runId, passes, preset)
      } };
      const saved = await saveExperiment(settingsAttempt.current.request);
      setSavedExperiment(saved); settingsAttempt.current = undefined; pending.current = undefined;
      await onChanged();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const saveSection = async (keepOpen = false) => {
    if (busy || !editing || review.status !== 'awaiting-approval') return;
    const pinned = review.runs.flatMap(run => run.prompts).find(p => p.promptId === editing.promptId && p.version === editing.version)!;
    const base = pinned.templateBase ?? legacyPromptTemplateBase(pinned.stages);
    const issues = parsePromptSections(editing.text, base).issues;
    if (issues.length) { setError(issues.map(i => i.message).join(' ')); return; }
    if (authoredStages(pinned)[editing.stage] === editing.text) {
      setSaveStatus('Saved');
      if (!keepOpen) setEditing(undefined);
      return;
    }
    const signature = JSON.stringify({ editing, revision: experiment.revision });
    if (savedEdit.current?.signature !== signature) savedEdit.current = { signature, promptRequestId: crypto.randomUUID(), experimentRequestId: crypto.randomUUID() };
    const attempt = savedEdit.current;
    setBusy(true); setError(''); setSaveStatus(''); setReviewed(false);
    try {
      if (!attempt.version) {
        const source = await readPrompt(pinned.promptId);
        const result = await savePrompt({ requestId: attempt.promptRequestId, promptId: source.id, baseVersion: source.versions.at(-1)!.version,
          workflow: source.workflow, name: source.name, templateBase: base, derivation: { parent: { promptId: pinned.promptId, version: editing.version }, kind: 'revision' },
          stages: { ...authoredStages(pinned), [editing.stage]: editing.text }, note: 'Edited during experiment review, before generation approval.' });
        attempt.version = result.versions.at(-1)!.version;
      }
      const { id, projectId, schemaVersion, revision, createdAt, updatedAt, generationReview, ...design } = experiment;
      const plannedRuns = design.plannedRuns?.map(plan => !pendingRunIds.has(plan.request.requestId) ? plan : ({ ...plan, request: { ...plan.request, prompts: plan.request.prompts.map(p => p.promptId === editing.promptId && p.version === editing.version ? { ...p, version: attempt.version! } : p) } }));
      const saved = await saveExperiment({ requestId: attempt.experimentRequestId, experimentId: id, expectedRevision: revision, experiment: { ...design, plannedRuns } });
      setSavedExperiment(saved);
      setEditing(keepOpen ? { ...editing, version: attempt.version! } : undefined);
      setSaveStatus('Saved'); savedEdit.current = undefined; pending.current = undefined; await onChanged();
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <section className="generation-review" aria-label="Generation review">
    <h3>{review.status === 'started' ? 'Approved generation plan' : 'Review before generation'}</h3>
    <p>{review.status === 'awaiting-approval' ? 'Ready for your approval. Generation has not started.' : review.status === 'starting' ? 'Approval recorded. Finishing launch…' : 'Generation was approved and started.'}</p>
    <p><strong>{review.runs.reduce((sum, run) => sum + run.cells.length, 0)} planned outputs</strong> · {inputCount} input{inputCount === 1 ? '' : 's'} · {settings.length === 1 ? settings[0] : `${settings.length} model settings`}</p>
    {review.status === 'awaiting-approval' && review.runs.map(run => <GenerationSettings key={`${run.id}:${experiment.revision}`} run={run}
      disabled={busy || !!editing || (dirtySettings.size > 0 && !dirtySettings.has(run.id))} resizable={canResizeGenerationRun(experiment, run)}
      onDirty={(dirty, draft) => { setReviewed(false); setError(''); setDirtySettings(current => { const next = new Map(current); if (dirty) next.set(run.id, draft); else next.delete(run.id); return next; }); }}
      onSave={(passes, preset) => void saveSettings(run.id, passes, preset)} />)}
    {dirtySettings.size > 0 && <p role="status">Save or reset the changed settings before approving generation.</p>}
    {review.runs.some(run => run.request.contextDelivery === 'session') && <p>Prepared AgentContext sessions · independent samples run sequentially within each input to encourage prompt-cache reuse.</p>}
    <details className="generation-review-inputs"><summary>Inputs and settings · {inputCount} input{inputCount === 1 ? '' : 's'}</summary>
      <div className="experiment-table-scroll"><table className="experiment-table" aria-label="Planned generation inputs">
        <thead><tr><th>Input</th><th>Outputs</th>{settings.length > 1 && <th>Model / effort</th>}<th>Pinned details</th></tr></thead>
        <tbody>{review.runs.map(run => <tr key={run.id}><th scope="row">{run.contextName}</th><td>{run.cells.length}</td>
          {settings.length > 1 && <td>{run.request.model} / {run.request.effort}</td>}
          <td><details><summary>Pinned input and settings</summary><pre>{JSON.stringify({ contexts: run.contexts, inputs: run.inputs, previous: run.previousNames, layoutTemplate: run.layoutTemplate, request: run.request }, null, 2)}</pre></details></td>
        </tr>)}</tbody>
      </table></div>
    </details>
    {[...promptGroups].map(([key, { prompt, runs }]) => <section key={key} className="experiment-prompt-source"><h4>{prompt.name} · v{prompt.version} · exact generation prompt</h4>
        {runs.length > 1 && <p className="evals-muted">Shared by {runs.length} input runs · {runs.reduce((sum, run) => sum + run.cells.filter(cell => cell.promptId === prompt.promptId && cell.promptVersion === prompt.version).length, 0)} outputs.{review.status === 'awaiting-approval' && ' Editing this prompt updates all of these planned runs.'}</p>}
        {Object.entries(prompt.stages).map(([stage, text]) => {
          const base = prompt.templateBase ?? legacyPromptTemplateBase(prompt.stages);
          return <section key={stage}><div className="evals-actions"><h4>{stage}</h4>
            {review.status === 'awaiting-approval' && <button type="button" disabled={busy || dirtySettings.size > 0} onClick={() => { setEditing({ promptId: prompt.promptId, version: prompt.version!, stage, text: authoredStages(prompt)[stage] }); setReviewed(false); setError(''); setSaveStatus(''); }}>Edit section</button>}
          </div>
          <PromptSectionsEditor base={base} readOnly known={new Set()} label={`${stage} pinned prompt`} value={text} onChange={() => {}} onUndo={() => {}} onRedo={() => {}} />
          </section>;
        })}
        {Object.values(prompt.references ?? {}).map((reference, index) => <pre key={index}>{reference.ascii}</pre>)}
      </section>)}
    {review.status !== 'started' && <div aria-label="Generation approval" role="group">
      {dirtySettings.size > 0 && <div className="evals-notice" role="status">
        <p>Your output count or model has unsaved changes. Save them to enable the review checkbox. Saving does not start generation.</p>
        {[...dirtySettings].map(([runId, draft]) => <div key={runId} className="evals-actions">
          <span>{draft.valid ? `${draft.passes} sample${draft.passes === 1 ? '' : 's'} · ${generationModelPresets.find(p => p.id === draft.preset)?.label}` : 'Choose a model and a whole output count from 1 to 20 in the settings above.'}</span>
          <button type="button" disabled={busy || !!editing || !draft.valid} onClick={() => void saveSettings(runId, draft.passes, draft.preset)}>{busy ? 'Saving settings…' : 'Save settings to continue'}</button>
        </div>)}
      </div>}
      <label><input type="checkbox" checked={reviewed} disabled={busy || !!editing || dirtySettings.size > 0} onChange={event => setReviewed(event.target.checked)} /> I have reviewed these prompts and settings</label>
      {!reviewed && !busy && !editing && !dirtySettings.size && <p className="evals-hint">Check the box above to enable generation.</p>}
      <p><button className="is-primary" disabled={!reviewed || busy || !!editing || dirtySettings.size > 0} onClick={() => void launch()}>{busy ? 'Working…' : review.status === 'starting' ? 'Finish approved launch' : 'Approve and start generation'}</button></p>
    </div>}
    {error && !editing && <p role="alert">{error}</p>}
    {editing && editingPrompt && <PromptSectionModal stage={editing.stage} value={editing.text} busy={busy} error={error} saveStatus={saveStatus}
      base={editingPrompt.templateBase ?? legacyPromptTemplateBase(editingPrompt.stages)}
      onChange={text => { setEditing(current => current && ({ ...current, text })); setSaveStatus(''); setError(''); }}
      onSave={keepOpen => void saveSection(keepOpen)} onClose={() => { if (!busy) { setEditing(undefined); setError(''); } }} />}
  </section>;
}

function GenerationSettings({ run, disabled, resizable, onDirty, onSave }: {
  run: EvalRunSummary; disabled: boolean; resizable: boolean;
  onDirty: (dirty: boolean, draft: SettingsDraft) => void; onSave: (passes: number, preset: string) => void;
}) {
  const originalPreset = generationModelPreset(run.request.model, run.request.effort)?.id ?? '';
  const [count, setCount] = useState(String(run.request.passes)), [preset, setPreset] = useState<string>(originalPreset);
  const dirty = count !== String(run.request.passes) || preset !== originalPreset;
  const valid = /^\d+$/.test(count) && Number(count) >= 1 && Number(count) <= 20 && !!preset;
  const change = (nextCount: string, nextPreset: string) => {
    setCount(nextCount); setPreset(nextPreset);
    onDirty(nextCount !== String(run.request.passes) || nextPreset !== originalPreset, {
      passes: Number(nextCount), preset: nextPreset, valid: /^\d+$/.test(nextCount) && Number(nextCount) >= 1 && Number(nextCount) <= 20 && !!nextPreset
    });
  };
  const simple = run.cells.length === run.request.passes;
  return <fieldset disabled={disabled} className="run-settings" aria-label={`Generation settings for ${run.contextName}`}>
    <legend>{run.contextName}</legend>
    <label>{simple ? 'Outputs' : 'Samples per prompt'}<input type="number" aria-label={simple ? 'Outputs' : 'Samples per prompt'} min={1} max={20} step={1} disabled={!resizable}
      value={count} onChange={event => change(event.target.value, preset)} /></label>
    <label>Model<select aria-label="Model" value={preset} onChange={event => change(count, event.target.value)}>
      {!originalPreset && <option value="" disabled>Choose a model (currently {run.request.model} / {run.request.effort})</option>}
      {generationModelPresets.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
    </select></label>
    {run.workflow === 'linked-canvases' && <p>Each output is an independent linked canvas set{run.canvasInputs?.length ? ` using the same ${run.canvasInputs.length} pinned canvases` : ''}.</p>}
    {!resizable && <p>This workflow's sample count is fixed or shared with another stage.</p>}
    {!valid && <p>Choose a model and a whole number from 1 to 20.</p>}
    <div className="evals-actions"><button type="button" disabled={!dirty || !valid} onClick={() => onSave(Number(count), preset)}>Save settings</button>
      {dirty && <button type="button" onClick={() => change(String(run.request.passes), originalPreset)}>Reset settings</button>}</div>
  </fieldset>;
}

function PromptSectionModal({ stage, value, base, busy, error, saveStatus, onChange, onSave, onClose }: {
  stage: string; value: string; base: PromptTemplateBase; busy: boolean; error: string; saveStatus: string;
  onChange: (text: string) => void; onSave: (keepOpen?: boolean) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fontSizePt, setFontSizePt] = useState(13 * 72 / 96 + 4);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector('textarea')?.focus();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} role="dialog" className="prompt-section-modal" aria-label={`Edit ${stage} section`} aria-busy={busy}
    style={{ '--prompt-editor-font-size': `${fontSizePt}pt` } as CSSProperties}
    onKeyDownCapture={event => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() === 's' && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation();
        if (!busy && !event.repeat) onSave(true);
        return;
      }
      const direction = ['+', '='].includes(event.key) ? 1 : ['-', '_'].includes(event.key) ? -1 : 0;
      if (!direction) return;
      event.preventDefault(); event.stopPropagation();
      setFontSizePt(size => Math.min(32, Math.max(8, size + direction)));
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>Edit {stage} section</h2></header>
    <div className="prompt-section-modal-body">
      <PromptTextBox base={base} label={`${stage} section`} value={value} onChange={onChange} readOnly={busy} />
      {error && <p role="alert" className="evals-error">{error}</p>}
    </div>
    <footer className="evals-actions">
      <span role="status" className="evals-ok evals-spacer">{busy ? 'Saving…' : saveStatus}</span>
      <button type="button" disabled={busy} onClick={onClose}>Cancel edit</button>
      <button type="button" className="is-primary" disabled={busy} onClick={() => onSave()} aria-keyshortcuts="Control+S" title="Save section (Ctrl+S saves without closing)">{busy ? 'Saving…' : 'Save section'}</button>
    </footer>
  </dialog>;
}
