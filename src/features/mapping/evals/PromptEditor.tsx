import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { composePrompt, evalWorkflows, promptHasErrors, validatePromptStages, type EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';
import { latestVersion, type EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { templateVariables } from '../../../../domain/mapping/evals/promptTemplate';
import { archivePrompt, savePrompt } from './evalsApi';
import { errorMessage, relativeTime } from './evalsFormat';
import { TemplateEditor, isMac, modKey, type TemplateChange, type TemplateEditorHandle } from './TemplateEditor';
import { canRedo, canUndo, createHistory, record, redo, undo, type EditHistory, type HistoryStep, type TextSelection } from './editHistory';

export type PromptDraft = { workflow: EvalWorkflowId; from?: EvalPrompt };

export function PromptEditor({ prompt, draft, version, onSaved, onDirty, onRun, onDuplicate }: {
  prompt?: EvalPrompt; draft?: PromptDraft;
  /** Opens on this version instead of the latest. */
  version?: number;
  onSaved: (prompt: EvalPrompt) => void; onDirty: (dirty: boolean) => void;
  onRun: (prompt: EvalPrompt) => void; onDuplicate: (prompt: EvalPrompt) => void;
}) {
  const workflow = evalWorkflows[prompt?.workflow ?? draft!.workflow];
  const latest = prompt && latestVersion(prompt);
  const opened = prompt?.versions.find(item => item.version === version) ?? latest;
  const initialStages = opened?.stages ?? (draft?.from ? latestVersion(draft.from).stages : workflow.defaultPrompt.stages);
  const [viewing, setViewing] = useState(opened?.version);
  const baseStages = prompt?.versions.find(item => item.version === viewing)?.stages ?? initialStages;
  const [name, setName] = useState(prompt?.name ?? (draft?.from ? `${draft.from.name} copy`.slice(0, 120) : `New ${workflow.label.toLowerCase()} prompt`));
  const [description, setDescription] = useState(prompt?.description ?? '');
  const [note, setNote] = useState('');
  const [stageId, setStageId] = useState(workflow.stages[0].id);
  const [history, setHistory] = useState(() => createHistory(initialStages, workflow.stages[0].id));
  const stages = history.entries[history.index].value;
  const restore = useRef<{ scope: string; selection: TextSelection }>(undefined);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const editor = useRef<TemplateEditorHandle>(null);
  const pending = useRef<{ signature: string; requestId: string }>(undefined);
  const stage = workflow.stages.find(item => item.id === stageId)!;
  const issues = useMemo(() => validatePromptStages(workflow, stages), [workflow, stages]);
  const known = useMemo(() => new Set(workflow.variables.map(variable => variable.name)), [workflow]);
  const used = new Set(templateVariables(stages[stageId] ?? ''));
  const stagesChanged = JSON.stringify(stages) !== JSON.stringify(prompt ? baseStages : initialStages) || !!prompt && viewing !== latest!.version;
  const dirty = !prompt || stagesChanged || name !== prompt.name || description !== (prompt.description ?? '');
  useEffect(() => { onDirty(!!prompt && dirty); }, [dirty, prompt, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const errors = promptHasErrors(issues), stageErrors = (id: string) => issues[id]?.filter(issue => issue.severity === 'error').length ?? 0;
  const view = (version: number) => {
    if (stagesChanged && !confirm('Discard unsaved prompt edits?')) return;
    setViewing(version); setHistory(createHistory(prompt!.versions.find(item => item.version === version)!.stages, stageId));
  };
  const save = async () => {
    const body = { workflow: workflow.id, name: name.trim(), stages, ...(description.trim() || prompt?.description ? { description: description.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}), ...(prompt ? { promptId: prompt.id, baseVersion: latest!.version } : {}) };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try { const saved = await savePrompt({ requestId: pending.current.requestId, ...body }); pending.current = undefined; setNote(''); onSaved(saved); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  const archive = async () => {
    setBusy(true); setError('');
    try { onSaved(await archivePrompt(prompt!.id, !prompt!.archivedAt)); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  const sample = Object.fromEntries(workflow.variables.map(variable => [variable.name,
    variable.type === 'canvas' ? `"‹${workflow.inputs.find(input => input.name === variable.name)?.label ?? variable.name}›"`
      : variable.name === 'task' ? '‹task entered when the run starts›' : variable.name === 'passes' ? '2' : '1']));
  const edit = (change: TemplateChange) => setHistory(current => record(current,
    { value: { ...current.entries[current.index].value, [stageId]: change.value }, scope: stageId, before: change.before, after: change.after, kind: change.kind }));
  // Undo can cross stages: switch to the stage the change was in, then restore its caret.
  const step = (move: (current: EditHistory<Record<string, string>>) => HistoryStep<Record<string, string>> | undefined) => {
    const result = move(history); if (!result) return;
    setHistory(result.history); setStageId(result.scope); restore.current = { scope: result.scope, selection: result.selection };
  };
  useLayoutEffect(() => {
    if (restore.current?.scope === stageId) { editor.current?.focusRange(restore.current.selection.start, restore.current.selection.end); restore.current = undefined; }
  });
  const canSave = !busy && !errors && dirty && !!name.trim();
  const shortcuts = useRef({ save: () => {}, canSave }); shortcuts.current = { save: () => void save(), canSave };
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (!modKey(event) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault(); if (shortcuts.current.canSave) shortcuts.current.save();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  /** Undo from anywhere in the editor except other text fields, which keep their native undo. */
  const formKeys = (event: KeyboardEvent<HTMLFormElement>) => {
    if (!modKey(event) || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === 'z') { event.preventDefault(); step(event.shiftKey ? redo : undo); }
    if (key === 'y' && !isMac) { event.preventDefault(); step(redo); }
  };
  const mod = isMac ? '⌘' : 'Ctrl+';
  const nextLabel = !prompt ? 'Create prompt' : stagesChanged ? `Save as v${latest!.version + 1}` : 'Save details';

  return <form className="prompt-editor" onKeyDown={formKeys} onSubmit={event => { event.preventDefault(); if (canSave) void save(); }}>
    <header className="evals-view-header">
      <div className="evals-breadcrumb"><span>{workflow.label}</span><span aria-hidden>›</span>
        <input aria-label="Prompt name" className="prompt-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        {prompt?.builtin && <span className="evals-badge">Built-in</span>}
        {prompt?.archivedAt && <span className="evals-badge is-muted">Archived</span>}
      </div>
      <div className="evals-actions">
        {prompt && <label className="evals-inline-field">Version<select aria-label="Prompt version" value={viewing} onChange={event => view(Number(event.target.value))}>
          {[...prompt.versions].reverse().map(item => <option key={item.version} value={item.version}>
            v{item.version}{item.version === latest!.version ? ' (latest)' : ''} · {relativeTime(item.createdAt)}</option>)}
        </select></label>}
        {prompt && <button type="button" onClick={() => onDuplicate(prompt)}>Duplicate</button>}
        {prompt && <button type="button" disabled={busy} onClick={() => void archive()}>{prompt.archivedAt ? 'Restore' : 'Archive'}</button>}
        {prompt && !prompt.archivedAt && <button type="button" disabled={dirty} title={dirty ? 'Save before running' : undefined} onClick={() => onRun(prompt)}>Run…</button>}
        <span className="evals-button-group">
          <button type="button" aria-label="Undo" title={`Undo (${mod}Z)`} disabled={!canUndo(history)} onClick={() => step(undo)}>↶</button>
          <button type="button" aria-label="Redo" title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} disabled={!canRedo(history)} onClick={() => step(redo)}>↷</button>
        </span>
        <button type="submit" className="is-primary" title={`${nextLabel} (${mod}S)`} aria-keyshortcuts={isMac ? 'Meta+S' : 'Control+S'} disabled={!canSave}>{busy ? 'Saving…' : nextLabel}</button>
      </div>
    </header>
    {prompt && viewing !== latest!.version && <p className="evals-notice" role="status">Viewing v{viewing}. Saving creates v{latest!.version + 1} from this text.</p>}
    {error && <p role="alert" className="evals-error">{error}</p>}
    <div className="prompt-editor-body">
      <div className="prompt-editor-main">
        <div className="prompt-meta">
          <label>Description<input value={description} maxLength={500} placeholder="What this prompt tries" onChange={event => setDescription(event.target.value)} /></label>
          {prompt && stagesChanged && <label>Version note<input value={note} maxLength={500} placeholder={`What changed in v${latest!.version + 1}`} onChange={event => setNote(event.target.value)} /></label>}
        </div>
        {workflow.stages.length > 1 && <div role="tablist" aria-label="Prompt stages" className="evals-tabs">
          {workflow.stages.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === stageId} onClick={() => setStageId(item.id)}>
            {item.label}{stageErrors(item.id) > 0 && <span className="evals-count is-error" aria-label={`${stageErrors(item.id)} errors`}>{stageErrors(item.id)}</span>}
          </button>)}
        </div>}
        <p className="evals-muted">{stage.description}</p>
        <details className="prompt-locked"><summary><LockIcon />Context files <small>written by the workflow</small></summary><pre>{stage.contextHeader}</pre></details>
        <TemplateEditor ref={editor} label={`${stage.label} instructions`} known={known} value={stages[stageId] ?? ''}
          onChange={edit} onUndo={() => step(undo)} onRedo={() => step(redo)} />
        <p className="prompt-shortcuts" aria-label="Keyboard shortcuts"><kbd>{mod}Z</kbd> undo <kbd>{isMac ? '⇧⌘Z' : 'Ctrl+Y'}</kbd> redo <kbd>{mod}S</kbd> save
          <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> indent <kbd>{isMac ? '⌥' : 'Alt+'}↑↓</kbd> move line <kbd>{isMac ? '⇧⌥' : 'Shift+Alt+'}↑↓</kbd> duplicate line <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor</p>
        <details className="prompt-locked"><summary><LockIcon />Output format <small>validated by the workflow</small></summary><pre>{stage.outputFormat}</pre></details>
        <button type="button" className="evals-link" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Hide' : 'Show'} full prompt preview</button>
        {preview && <pre className="prompt-preview" aria-label="Full prompt preview">{(() => {
          try { return composePrompt(workflow, stageId, stages[stageId] ?? '', sample); } catch (error) { return errorMessage(error); }
        })()}</pre>}
      </div>
      <aside className="prompt-sidebar" aria-label="Template variables">
        <h3>Variables</h3>
        <p className="evals-muted">Click to insert at the cursor.</p>
        {(['input', 'system'] as const).map(source => <div key={source} className="prompt-variable-group">
          <h4>{source === 'input' ? 'Run inputs' : 'System'}</h4>
          {workflow.variables.filter(variable => variable.source === source).map(variable => <button type="button" key={variable.name} className="prompt-variable"
            onClick={() => editor.current?.insert(`{{${variable.name}}}`)} aria-label={`Insert {{${variable.name}}}`}>
            <code>{`{{${variable.name}}}`}</code><span className="evals-badge is-muted">{variable.type}</span>{used.has(variable.name) && <span className="prompt-used" title="Used in this stage">used</span>}
            <small>{variable.description}</small>
          </button>)}
        </div>)}
        <h3>Files <LockIcon /></h3>
        <ul className="prompt-files">{stage.files.map(file => <li key={file.name}><code>{file.name}</code><small>{file.description}</small></li>)}</ul>
        <h3>Checks</h3>
        {issues[stageId]?.length ? <ul className="prompt-issues">{issues[stageId].map((issue, i) => <li key={i} className={`is-${issue.severity}`}>
          <button type="button" className="evals-link" disabled={issue.start === undefined} onClick={() => editor.current?.focusRange(issue.start!, issue.end!)}>{issue.message}</button>
        </li>)}</ul> : <p className="evals-ok">No problems in this stage.</p>}
      </aside>
    </div>
  </form>;
}

export const LockIcon = () => <svg className="evals-lock" width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7zm2 0h4V5a2 2 0 1 0-4 0z" /></svg>;
