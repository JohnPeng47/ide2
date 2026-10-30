import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompareCandidate } from '../../../../domain/mapping/compare/comparePageSession';
import type { ProjectRepresentationRecord } from '../../../../domain/core/representations/projectCatalog';
import { latestVersion, type EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { evalEfforts, type EvalRunRequest, type EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflowIds, evalWorkflows, type EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';
import { templateVariables } from '../../../../domain/mapping/evals/promptTemplate';
import { listCompareCandidates } from './compareApi';
import { listContexts, listGenerated, startRun, type AgentContextSummary } from './evalsApi';
import { errorMessage, promptLabel, relativeTime, runNumbers } from './evalsFormat';
import { candidateKey, sourceOf } from './CanvasPicker';
import { Drawer } from './Drawer';
import { SourceTree, type TreeNode } from './SourceTree';

/** `contextId` and `canvasKeys` preselect tree rows, e.g. from an AgentContext's right-click menu.
 *  `rerun` fills the whole form from that run; the new run is filed under it. */
export interface RunLaunch { workflow: EvalWorkflowId; promptIds?: string[]; contextId?: string; canvasKeys?: string[]; rerun?: EvalRunSummary }
const MAX_PREVIOUS = 6;
const ROLES = ['child', 'parent'] as const;

export function RunLauncher({ prompts, runs, initial, onClose, onStarted }: {
  prompts: EvalPrompt[]; runs: EvalRunSummary[]; initial: RunLaunch; onClose: () => void; onStarted: (run: EvalRunSummary) => void;
}) {
  const rerun = initial.rerun, request = rerun?.request;
  // A run is the authority for its pinned text even while the prompt catalog refreshes.
  prompts = [...prompts];
  for (const pinned of rerun?.prompts ?? []) {
    if (pinned.version === undefined) continue;
    const index = prompts.findIndex(prompt => prompt.id === pinned.promptId);
    const version = { version: pinned.version, stages: pinned.stages, createdAt: rerun!.createdAt };
    if (index < 0) prompts.push({ schemaVersion: 1, id: pinned.promptId, projectId: rerun!.projectId, workflow: rerun!.workflow,
      name: pinned.name, createdAt: rerun!.createdAt, updatedAt: rerun!.createdAt, versions: [version] });
    else if (!prompts[index].versions.some(v => v.version === pinned.version)) prompts[index] = { ...prompts[index], versions: [...prompts[index].versions, version] };
  }
  const [workflowId, setWorkflowId] = useState(rerun?.workflow ?? initial.workflow);
  const workflow = evalWorkflows[workflowId];
  // A rerun keeps the exact prompt versions it used, even if a prompt was archived since.
  const [selected, setSelected] = useState<Record<string, number>>(() => rerun
    ? Object.fromEntries(rerun.prompts.filter(pinned => pinned.version !== undefined && prompts.some(prompt => prompt.id === pinned.promptId)).map(pinned => [pinned.promptId, pinned.version!]))
    : Object.fromEntries(prompts.filter(prompt => initial.promptIds?.includes(prompt.id)).map(prompt => [prompt.id, latestVersion(prompt).version])));
  const available = prompts.filter(prompt => prompt.workflow === workflowId && (!prompt.archivedAt || selected[prompt.id] !== undefined));
  /** A rerun's canvas inputs, which may be older checkpoints than the canvases now offer. */
  const pinned = useMemo(() => new Map(Object.values(rerun?.inputs ?? {}).map(input => [candidateKey(input.source), input])), [rerun]);
  const [candidates, setCandidates] = useState<CompareCandidate[]>();
  const [contexts, setContexts] = useState<AgentContextSummary[]>(), [generated, setGenerated] = useState<ProjectRepresentationRecord[]>();
  /** Roll-up: ticked canvases in order; the first is the child, the second the parent. */
  const [picked, setPicked] = useState<string[]>(rerun ? ROLES.flatMap(role => rerun.inputs[role] ? [candidateKey(rerun.inputs[role].source)] : []) : initial.canvasKeys ?? []);
  /** Alternatives: one source AgentContext plus earlier alternatives from it. */
  const [contextId, setContextId] = useState<string | undefined>(rerun?.contexts?.context?.agentContextId ?? initial.contextId);
  const [previous, setPrevious] = useState<string[]>(request?.previous ?? []);
  const [task, setTask] = useState(request?.task ?? ''), [passes, setPasses] = useState(request?.passes ?? workflow.defaultPasses);
  const [model, setModel] = useState(request?.model ?? 'gpt-6-sol'), [effort, setEffort] = useState<EvalRunRequest['effort']>(request?.effort ?? 'high');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ signature: string; requestId: string }>(undefined);
  useEffect(() => {
    let closed = false;
    const fail = (error: unknown) => { if (!closed) setError(errorMessage(error)); };
    void listCompareCandidates().then(items => {
      if (closed) return;
      setCandidates(items);
      // Preselected canvases may have been saved again since; keep only those still pinned.
      setPicked(current => current.filter(key => pinned.has(key) || items.some(item => candidateKey(item) === key)));
    }).catch(fail);
    void listContexts().then(result => { if (!closed) setContexts(result.items); }).catch(fail);
    void listGenerated().then(items => {
      if (closed) return;
      setGenerated(items);
      // Deleted earlier alternatives can't be attached again.
      setPrevious(current => current.filter(id => rerun?.previousInputs?.some(input => input.source.documentId === id) || items.some(item => item.id === id)));
    }).catch(fail);
    return () => { closed = true; };
  }, []);
  const switchWorkflow = (id: EvalWorkflowId) => {
    setWorkflowId(id); setSelected({}); setPicked([]); setContextId(undefined); setPrevious([]); setPasses(evalWorkflows[id].defaultPasses);
  };

  const numbers = useMemo(() => runNumbers(runs), [runs]);
  const rollUpTree = useMemo<TreeNode[]>(() => {
    if (!candidates) return [];
    const node = (candidate: CompareCandidate): TreeNode => {
      const key = candidateKey(candidate), role = picked.indexOf(key);
      return { id: key, selectable: true, disabled: role < 0 && picked.length >= 2,
        label: candidate.name,
        meta: `${candidate.diagrams.length} diagram${candidate.diagrams.length === 1 ? '' : 's'}`,
        badge: role >= 0 ? <span className={`source-role is-${ROLES[role]}`}>{ROLES[role]}</span> : undefined };
    };
    const saved = candidates.filter(candidate => !candidate.generated), made = candidates.filter(candidate => candidate.generated);
    const older = [...pinned].filter(([key]) => !candidates.some(candidate => candidateKey(candidate) === key));
    return [
      ...(older.length ? [{ id: 'rerun-inputs', label: `Run #${numbers.get(rerun!.id) ?? '?'} inputs`, meta: 'older checkpoints',
        children: older.map(([key, input]) => {
          const role = picked.indexOf(key);
          return { id: key, selectable: true, disabled: role < 0 && picked.length >= 2, label: input.name, detail: input.canvasName,
            badge: role >= 0 ? <span className={`source-role is-${ROLES[role]}`}>{ROLES[role]}</span> : undefined };
        }) }] : []),
      ...[...new Set(saved.map(candidate => candidate.canvasName))].map(name => ({ id: `canvas:${name}`, label: name, meta: 'canvas',
        children: saved.filter(candidate => candidate.canvasName === name).map(node) })),
      ...[...new Set(made.map(candidate => candidate.generated!.agentContextId))].map(id => ({ id: `generated:${id}`, label: made.find(candidate => candidate.generated!.agentContextId === id)!.generated!.contextName, meta: 'generated',
        children: made.filter(candidate => candidate.generated!.agentContextId === id).map(node) }))
    ];
  }, [candidates, picked, pinned, numbers, rerun]);
  const alternativesTree = useMemo<TreeNode[]>(() => {
    if (!contexts || !generated) return [];
    const full = previous.length >= MAX_PREVIOUS;
    const pinnedPrevious: TreeNode[] = (rerun?.previousInputs ?? []).filter(input => !generated.some(canvas => canvas.id === input.source.documentId)).map(input => ({
      id: `alt:${input.source.documentId}`, label: input.name, detail: `${input.generated?.contextName ?? input.canvasName} · pinned checkpoint`, selectable: true, disabled: full && !previous.includes(input.source.documentId) }));
    return [...(pinnedPrevious.length ? [{ id: 'pinned-previous', label: 'Pinned earlier inputs', children: pinnedPrevious }] : []), ...contexts.map(context => {
      const outputs = generated.filter(canvas => canvas.generated?.agentContextId === context.agentContextId && ['alternative', 'legacy'].includes(canvas.generated.stage));
      const groups = [...new Set(outputs.map(canvas => canvas.generated!.runId ?? 'migrated'))];
      return { id: `ctx:${context.agentContextId}`, label: context.name, detail: context.description || undefined, selectable: true,
        meta: `${context.messageCount} msg${context.messageCount === 1 ? '' : 's'} · ${relativeTime(context.createdAt)}`,
        children: groups.map(runId => {
          const items = outputs.filter(canvas => (canvas.generated!.runId ?? 'migrated') === runId);
          const label = runId === 'migrated' ? 'Migrated alternatives' : `Run #${numbers.get(runId) ?? '?'}`;
          return { id: `run:${context.agentContextId}:${runId}`, label, group: true, meta: `${items.length} canvas${items.length === 1 ? '' : 'es'}`,
            children: items.map(canvas => ({ id: `alt:${canvas.id}`, label: canvas.generated!.pass && canvas.generated!.prompt ? `${promptLabel(canvas.generated!.prompt)} · pass ${canvas.generated!.pass}` : canvas.name,
              detail: canvas.generated!.pass ? undefined : promptLabel(canvas.generated!.prompt), selectable: true,
              disabled: full && !previous.includes(canvas.id), meta: relativeTime(canvas.createdAt) })) };
        }) };
    })];
  }, [contexts, generated, previous, numbers, rerun]);

  const contextOf = (canvasId: string) => generated?.find(canvas => canvas.id === canvasId)?.generated?.agentContextId ?? rerun?.previousInputs?.find(input => input.source.documentId === canvasId)?.generated?.agentContextId;
  const toggleRollUp = (node: TreeNode, on: boolean) => setPicked(current => on ? [...current, node.id].slice(0, 2) : current.filter(key => key !== node.id));
  const toggleAlternative = (node: TreeNode, on: boolean) => {
    if (node.id.startsWith('ctx:')) {
      const id = node.id.slice(4);
      if (on) { setContextId(id); setPrevious(current => current.filter(canvas => contextOf(canvas) === id)); }
      else { setContextId(undefined); setPrevious([]); }
      return;
    }
    // Ticking an earlier alternative also selects its context as the run's source.
    const ids = node.id.startsWith('alt:') ? [node.id.slice(4)] : (node.children ?? []).filter(child => !child.disabled || !on).map(child => child.id.slice(4));
    const owner = contextOf(ids[0]);
    if (on && owner && owner !== contextId) { setContextId(owner); setPrevious(ids.slice(0, MAX_PREVIOUS)); return; }
    setPrevious(current => on ? [...new Set([...current, ...ids])].slice(0, MAX_PREVIOUS) : current.filter(id => !ids.includes(id)));
  };
  const checked = useMemo(() => new Set(workflowId === 'roll-up' ? picked : [...(contextId ? [`ctx:${contextId}`] : []), ...previous.map(id => `alt:${id}`)]),
    [workflowId, picked, contextId, previous]);

  const chosen = available.filter(prompt => selected[prompt.id] !== undefined);
  const uses = (name: string) => chosen.some(prompt => Object.values(prompt.versions.find(item => item.version === selected[prompt.id])?.stages ?? {})
    .some(body => templateVariables(body).includes(name)));
  const usesTask = uses('task');
  const candidate = (key: string) => candidates?.find(item => candidateKey(item) === key) ?? (pinned.has(key) ? { ...pinned.get(key)!.source, name: pinned.get(key)!.name, canvasName: pinned.get(key)!.canvasName } : undefined);
  const context = contexts?.find(item => item.agentContextId === contextId);
  const problems = [
    !chosen.length && 'Select at least one prompt.',
    chosen.length > 6 && 'Select at most six prompts.',
    workflowId === 'roll-up' && picked.length < 2 && `Tick ${picked.length ? 'a parent' : 'a child and a parent'} canvas in the tree.`,
    workflowId === 'alternatives' && !contextId && 'Tick an AgentContext in the tree.',
    rerun?.contexts?.context && contextId && contextId !== rerun.contexts.context.agentContextId && `A rerun must use ${rerun.contexts.context.name}.`,
    usesTask && !task.trim() && 'A selected prompt uses {{task}}. Describe the task.'
  ].filter((problem): problem is string => !!problem);
  const outputs = chosen.length * passes * workflow.stages.length;
  const submit = async () => {
    const inputs: EvalRunRequest['inputs'] = workflowId === 'roll-up'
      ? { child: sourceOf(candidate(picked[0])!), parent: sourceOf(candidate(picked[1])!) } : { context: { agentContextId: contextId! } };
    const body = { workflow: workflowId, prompts: chosen.map(prompt => ({ promptId: prompt.id, version: selected[prompt.id] })), passes, model: model.trim(), effort,
      inputs, ...(usesTask ? { task: task.trim() } : {}), ...(workflowId === 'alternatives' && previous.length ? { previous } : {}), ...(rerun ? { parentRunId: rerun.id } : {}) };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try { const run = await startRun({ requestId: pending.current.requestId, ...body }); pending.current = undefined; onStarted(run); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  const loading = workflowId === 'roll-up' ? !candidates : !contexts || !generated;
  const name = (id: string) => generated?.find(canvas => canvas.id === id)?.name ?? rerun?.previousInputs?.find(input => input.source.documentId === id)?.name ?? id;

  return <Drawer title={rerun ? `Rerun #${numbers.get(rerun.id) ?? '?'}` : 'New run'} wide onClose={onClose}>
    <form className="evals-form run-launcher" onSubmit={event => { event.preventDefault(); if (!problems.length) void submit(); }}>
      <div role="radiogroup" aria-label="Workflow" className="evals-segmented">
        {evalWorkflowIds.map(id => <label key={id}><input type="radio" name="workflow" checked={id === workflowId} disabled={!!rerun && id !== workflowId} onChange={() => switchWorkflow(id)} />{evalWorkflows[id].label}</label>)}
      </div>
      {rerun && <p className="evals-notice" role="status">Filled in from Run #{numbers.get(rerun.id) ?? '?'}. Outputs are filed under Run #{numbers.get(rerun.parentRunId ?? rerun.id) ?? '?'}.</p>}
      <div className="run-launcher-body">
        <section className="run-launcher-tree" aria-label="Inputs">
          <h3>{workflowId === 'roll-up' ? 'Canvases' : 'AgentContexts'} <small>{workflowId === 'roll-up' ? 'tick a child, then a parent' : 'tick one context, plus earlier alternatives'}</small></h3>
          {loading && !error ? <p role="status" className="evals-muted">Loading…</p>
            : workflowId === 'roll-up'
              ? <SourceTree key="roll-up" label="Canvases" nodes={rollUpTree} checked={checked} onToggle={toggleRollUp} empty="Save a canvas or view in Mapping first." />
              : <SourceTree key="alternatives" label="AgentContexts" nodes={alternativesTree} checked={checked} onToggle={toggleAlternative} empty="No saved AgentContexts yet. Save one from Agent Chat." />}
          <p className="run-launcher-count" aria-live="polite">{checked.size} selected</p>
        </section>
        <div className="run-launcher-form">
          <fieldset disabled={busy}>
            <p className="evals-muted">{workflow.description}</p>
            <section aria-label="Prompt context" className="prompt-context"><h3>Prompt context</h3>
              {workflowId === 'roll-up' ? <>
                {ROLES.map((role, i) => <div key={role} className="prompt-context-slot">
                  <code>{`{{${role}}}`}</code>
                  {picked[i] ? <><span title={candidate(picked[i])?.canvasName}>{candidate(picked[i])?.name}</span>
                    <small>{role === 'child' ? 'child.json' : 'parent-*.json'}</small>
                    <button type="button" className="evals-link" aria-label={`Remove ${role}`} onClick={() => setPicked(current => current.filter(key => key !== picked[i]))}>×</button></>
                    : <span className="evals-muted">Tick a canvas</span>}
                </div>)}
                {picked.length === 2 && <button type="button" onClick={() => setPicked(([a, b]) => [b, a])}>⇅ Swap child and parent</button>}
              </> : <>
                <div className="prompt-context-slot"><code>{'{{context}}'}</code>
                  {context ? <><span>{context.name}</span><small>context.json · {context.messageCount} msgs</small></> : <span className="evals-muted">Tick an AgentContext</span>}</div>
                <div className="prompt-context-slot"><code>{'{{previous}}'}</code>
                  {previous.length ? <span>{previous.length} earlier alternative{previous.length === 1 ? '' : 's'}</span> : <span className="evals-muted">none</span>}</div>
                {previous.length > 0 && <ul className="prompt-context-files">{previous.map((id, i) => <li key={id}>
                  <code>previous-{i + 1}.json</code><span>{name(id)}{rerun?.previousInputs?.some(input => input.source.documentId === id) ? ' · pinned' : ''}</span>
                  <button type="button" className="evals-link" aria-label={`Remove ${name(id)}`} onClick={() => setPrevious(current => current.filter(item => item !== id))}>×</button></li>)}</ul>}
                {previous.length > 0 && chosen.length > 0 && !uses('previous') && <p className="evals-warning">The selected prompts don't use {'{{previous}}'}; the files are still attached.</p>}
              </>}
            </section>
            <section aria-label="Prompts"><h3>Prompts <small>{chosen.length} of {available.length} selected</small></h3>
              {!available.length && <p className="evals-muted">No prompts for this workflow yet.</p>}
              <ul className="run-prompt-list">{available.map(prompt => {
                const on = selected[prompt.id] !== undefined;
                return <li key={prompt.id} className={on ? 'is-selected' : undefined}>
                  <label><input type="checkbox" checked={on} onChange={event => setSelected(previous => {
                    const next = { ...previous }; if (event.target.checked) next[prompt.id] = latestVersion(prompt).version; else delete next[prompt.id]; return next;
                  })} />{prompt.name}</label>
                  <select aria-label={`${prompt.name} version`} disabled={!on} value={selected[prompt.id] ?? latestVersion(prompt).version}
                    onChange={event => setSelected(previous => ({ ...previous, [prompt.id]: Number(event.target.value) }))}>
                    {[...prompt.versions].reverse().map(item => <option key={item.version} value={item.version}>v{item.version}</option>)}
                  </select>
                </li>;
              })}</ul>
            </section>
            {usesTask && <label>Task <small>fills {'{{task}}'} in the selected prompts</small>
              <textarea aria-label="Task" value={task} maxLength={20000} rows={3} placeholder="What should every alternative accomplish?" onChange={event => setTask(event.target.value)} /></label>}
            <section aria-label="Settings" className="run-settings"><h3>Settings</h3>
              <label>Passes<input type="number" aria-label="Passes" min={1} max={4} value={passes} onChange={event => setPasses(Math.min(4, Math.max(1, Number(event.target.value) || 1)))} /></label>
              <label>Model<input aria-label="Model" value={model} maxLength={100} onChange={event => setModel(event.target.value)} /></label>
              <label>Effort<select aria-label="Effort" value={effort} onChange={event => setEffort(event.target.value as EvalRunRequest['effort'])}>
                {evalEfforts.map(item => <option key={item}>{item}</option>)}</select></label>
            </section>
          </fieldset>
          <footer className="evals-drawer-footer">
            <p aria-live="polite">{chosen.length} prompt{chosen.length === 1 ? '' : 's'} × {passes} pass{passes === 1 ? '' : 'es'}{workflow.stages.length > 1 ? ` × ${workflow.stages.length} stages` : ''} = <strong>{outputs} canvas{outputs === 1 ? '' : 'es'}</strong></p>
            {problems.length > 0 && <ul className="evals-problems">{problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
            {error && <p role="alert" className="evals-error">{error}</p>}
            <div className="evals-actions"><button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" className="is-primary" disabled={busy || !!problems.length || !model.trim()}>{busy ? 'Starting…' : rerun ? 'Start rerun' : 'Start run'}</button></div>
          </footer>
        </div>
      </div>
    </form>
  </Drawer>;
}
