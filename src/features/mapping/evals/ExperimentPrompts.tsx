import { PromptTextBox } from './PromptSectionsEditor';
import { legacyPromptTemplateBase } from '../../../../domain/mapping/evals/promptTemplateBase';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { experimentPromptLineage, promptVersionKey } from '../../../../domain/mapping/evals/promptLineage';
import type { EvalExperiment, RelaunchExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflows, promptHasErrors, validatePromptStages } from '../../../../domain/mapping/evals/evalWorkflows';
import { Drawer } from './Drawer';
import { relaunchExperiment } from './evalsApi';
import { errorMessage } from './evalsFormat';

export function ExperimentPrompts({ experiment, runs, prompts, onChanged }: { experiment: EvalExperiment; runs: EvalRunSummary[]; prompts: EvalPrompt[]; onChanged: () => Promise<unknown> }) {
  const entries = experiment.samples.flatMap(sample => sample.outputs.map(output => {
    const run = runs.find(r => r.id === output.runId), cell = run?.cells.find(c => c.key === output.cellKey);
    return { id: `${sample.id}:${output.stageId}`, sample, output, run, cell,
      prompt: run?.prompts.find(p => p.promptId === cell?.promptId && (!cell.promptVersion || p.version === cell.promptVersion)),
      label: [experiment.cases.length > 1 ? experiment.cases.find(c => c.id === sample.caseId)?.name : undefined,
        experiment.conditions.find(c => c.id === sample.conditionId)?.name, `Sample ${sample.number}`, `Attempt ${sample.attempt}`,
        experiment.workflow.stages.find(s => s.id === output.stageId)?.name].filter(Boolean).join(' · ') };
  }));
  const nodes = experimentPromptLineage(experiment, runs, prompts);
  const [openedId, setOpenedId] = useState<string>();
  const openedNode = nodes.find(n => n.id === openedId);
  const visibleEntries = entries.filter(e => openedNode?.outputKeys.includes(e.id));
  const [selected, setSelected] = useState(''), [editing, setEditing] = useState(false), [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef<{ signature: string; input: RelaunchExperiment } | undefined>(undefined);
  const entry = visibleEntries.find(e => e.id === selected) ?? visibleEntries[0];
  const inspectedPrompt = entry?.prompt ?? openedNode?.prompt;
  const inspectedWorkflow = entry?.run?.workflow ?? openedNode?.workflow;
  const derivation = inspectedPrompt?.derivation ?? prompts.find(p => p.id === inspectedPrompt?.promptId)?.versions.find(v => v.version === inspectedPrompt?.version)?.derivation;
  const editable = !!entry?.prompt && !!entry.run && !entry.run.compatibility && !entry.run.legacy;
  const issues = entry?.run ? validatePromptStages(evalWorkflows[entry.run.workflow], draft) : {};
  const launch = async () => {
    if (!entry) return;
    const body = { expectedRevision: experiment.revision, sampleId: entry.sample.id, stageId: entry.output.stageId, stages: draft };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, input: { ...body, requestId: crypto.randomUUID() } };
    setBusy(true); setError('');
    try {
      const result = await relaunchExperiment(experiment.id, pending.current.input);
      const sample = result.experiment.samples.find(s => s.outputs.some(o => o.runId === result.runId))!;
      setSelected(`${sample.id}:${entry.output.stageId}`); setEditing(false); setNotice(`Attempt ${sample.attempt} launched. Its output and prompt are recorded in this experiment.`);
      pending.current = undefined; await onChanged(); setOpenedId(promptVersionKey(`attempt-${result.runId}`, 1));
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  const renderBranch = (parentId?: string, prefix = ''): ReactNode => {
    const children = nodes.filter(node => node.parentId === parentId);
    return children.map((node, index) => {
      const last = index === children.length - 1;
      const outputs = entries.filter(e => node.outputKeys.includes(e.id));
      return <li key={node.id}>
        <div className="experiment-prompt-tree-row"><span className="experiment-tree-branch" aria-hidden="true">{prefix}{parentId ? (last ? '└── ' : '├── ') : ''}</span>
          <div>{node.prompt ? <button className="evals-link" aria-label={`Open ${node.name} prompt`} onClick={() => { setOpenedId(node.id); setSelected(outputs[0]?.id ?? ''); }}>{node.name}</button> : <strong>{node.name}</strong>}
          {node.prompt && <span className="evals-muted"> [{outputs.length} {outputs.length === 1 ? 'output' : 'outputs'}]</span>}
          {node.prompt?.version && <span className="evals-muted"> · v{node.prompt.version}</span>}
          {node.description && <small className="evals-muted">{node.description}</small>}</div>
        </div>
        {nodes.some(child => child.parentId === node.id) && <ul>{renderBranch(node.id, prefix + (parentId ? (last ? '    ' : '│   ') : ''))}</ul>}
      </li>;
    });
  };
  return <section className="experiment-prompts" aria-label="Generation prompts">
    <h3>Prompt tree</h3>
    {!nodes.length && <p className="evals-muted">No saved prompt versions are attached to outputs yet.</p>}
    <ul className="experiment-prompt-tree" aria-label="Prompt variations">{renderBranch()}</ul>
    {notice && <p role="status">{notice}</p>}
    {openedNode && !editing && createPortal(<Drawer title={`${openedNode.name} prompt`} wide onClose={() => setOpenedId(undefined)}>
      <div className="experiment-prompt-inspector"><p className="evals-muted">Exact prompt text saved with each output.</p>
      {!!visibleEntries.length && <label className="evals-field">Output<select aria-label="Output prompt" value={entry?.id} onChange={event => setSelected(event.target.value)}>{visibleEntries.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {derivation && <p className="evals-muted">{derivation.kind} of <button className="evals-link" onClick={() => setOpenedId(promptVersionKey(derivation.parent.promptId, derivation.parent.version))}>{prompts.find(p => p.id === derivation.parent.promptId)?.name ?? derivation.parent.promptId} · v{derivation.parent.version}</button>{derivation.dimension && ` · ${derivation.dimension.name}: ${derivation.dimension.value}`}</p>}
      {inspectedPrompt && inspectedWorkflow ? <>
        <div className="evals-actions"><strong>{inspectedPrompt.name} · v{inspectedPrompt.version ?? '?'}</strong><span className="evals-muted">{entry?.run?.request.model} · {entry?.run?.request.effort}</span>
          <button type="button" disabled={!editable} onClick={() => { setDraft({ ...inspectedPrompt.stages }); setError(''); setEditing(true); }}>Edit and relaunch</button></div>
        {Object.entries(inspectedPrompt.stages).map(([stage, text]) => <details open key={`${openedNode.id}:${stage}`} className="experiment-prompt-source"><summary>{evalWorkflows[inspectedWorkflow].stages.find(s => s.id === stage)?.label ?? stage} · Pinned prompt</summary><PromptTextBox base={inspectedPrompt.templateBase ?? legacyPromptTemplateBase(inspectedPrompt.stages)} label={`${stage} pinned prompt`} value={text} readOnly onChange={() => {}} /></details>)}
        {!!Object.keys(inspectedPrompt.references ?? {}).length && <details><summary>Pinned reference text</summary>{Object.entries(inspectedPrompt.references!).map(([id, ref]) => <div key={id}><h4>{ref.name} · {id}</h4><pre>{ref.ascii}</pre>{ref.comment && <p>{ref.comment}</p>}</div>)}</details>}
      </> : <p className="evals-muted">This output has no retained prompt text.</p>}
    </div></Drawer>, document.body)}
    {editing && entry?.run && createPortal(<Drawer title="Edit prompt and relaunch" wide onClose={() => { if (!busy) setEditing(false); }}>
      <p>{entry.label}</p><p>Launches a new attempt with a separate prompt copy. The input context, template, upstream outputs, model and effort stay pinned to the original generation.</p>
      <p>{entry.run.workflow === 'alternatives' ? 'This launches one output. Other stages in this experiment are not automatically relaunched.' : `This reruns the underlying ${evalWorkflows[entry.run.workflow].label} workflow; all of its prompt stages are editable below.`}</p>
      {Object.entries(draft).map(([stage, text]) => <label key={stage} className="evals-field experiment-prompt-edit-field">{evalWorkflows[entry.run!.workflow].stages.find(s => s.id === stage)?.label ?? stage}
        <PromptTextBox base={entry.prompt?.templateBase ?? legacyPromptTemplateBase(entry.prompt?.stages ?? draft)} label={`Prompt ${stage}`} value={text} readOnly={busy} onChange={text => setDraft(current => ({ ...current, [stage]: text }))} />
        {issues[stage]?.filter(i => i.severity === 'error').map((i, n) => <span key={n} className="evals-error-text">{i.message}</span>)}
      </label>)}
      {error && <p role="alert">{error} <button type="button" onClick={() => void onChanged()}>Refresh experiment</button></p>}
      <div className="evals-actions"><button type="button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button><button type="button" className="is-primary" disabled={busy || promptHasErrors(issues)} onClick={() => void launch()}>{busy ? 'Launching…' : 'Launch new attempt'}</button></div>
    </Drawer>, document.body)}
  </section>;
}
