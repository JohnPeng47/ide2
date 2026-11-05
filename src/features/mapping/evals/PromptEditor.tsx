import { PromptSectionsEditor } from './PromptSectionsEditor';
import { defaultPromptTemplateBase, legacyPromptTemplateBase, parsePromptSections, renderPromptSections, structurePrompt } from '../../../../domain/mapping/evals/promptTemplateBase';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { composePrompt, evalWorkflows, promptHasErrors, validatePromptStages, type EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';
import { latestVersion, type EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { referenceKey, templateReferences, templateVariables } from '../../../../domain/mapping/evals/promptTemplate';
import { referenceToken, renderReference, type EvalReference } from '../../../../domain/mapping/evals/evalReference';
import { archivePrompt, savePrompt, listPrompts, snapshotPrompts } from './evalsApi';
import { errorMessage, relativeTime } from './evalsFormat';
import { TemplateEditor, isMac, modKey, type TemplateChange, type TemplateEditorHandle } from './TemplateEditor';
import { canRedo, canUndo, createHistory, record, redo, undo, type EditHistory, type HistoryStep, type TextSelection } from './editHistory';

export type PromptDraft = { workflow: EvalWorkflowId; from?: EvalPrompt; fromVersion?: number };

export function PromptEditor({ prompt, draft, version, references, onSaved, onDirty, onRun, onDuplicate }: {
  prompt?: EvalPrompt; draft?: PromptDraft;
  /** Saved references, archived included; undefined while loading (then only token syntax is checked). */
  references?: EvalReference[];
  /** Opens on this version instead of the latest. */
  version?: number;
  onSaved: (prompt: EvalPrompt) => void; onDirty: (dirty: boolean) => void;
  onRun: (prompt: EvalPrompt) => void; onDuplicate: (prompt: EvalPrompt, version: number) => void;
}) {
  const workflow = evalWorkflows[prompt?.workflow ?? draft!.workflow];
  const latest = prompt && latestVersion(prompt);
  const opened = prompt?.versions.find(item => item.version === version) ?? latest;
  const sourceVersion = draft?.from && (draft.from.versions.find(v => v.version === draft.fromVersion) ?? latestVersion(draft.from));
  const initialStages = opened?.stages ?? sourceVersion?.stages ?? Object.fromEntries(Object.entries(workflow.defaultPrompt.stages).map(([key, text]) => [key, structurePrompt(text)]));

  const [viewing, setViewing] = useState(opened?.version);
  const viewedVersion = prompt?.versions.find(v => v.version === viewing);
  const templateBase = viewedVersion?.templateBase ?? sourceVersion?.templateBase ?? (viewedVersion || sourceVersion ? legacyPromptTemplateBase((viewedVersion ?? sourceVersion)!.stages) : defaultPromptTemplateBase);
  const baseStages = prompt?.versions.find(item => item.version === viewing)?.stages ?? initialStages;
  const [name, setName] = useState(prompt?.name ?? (draft?.from ? `${draft.from.name} copy`.slice(0, 120) : `New ${workflow.label.toLowerCase()} prompt`));
  const [description, setDescription] = useState(prompt?.description ?? '');
  const [dimension, setDimension] = useState(''), [dimensionValue, setDimensionValue] = useState('');
  const viewedDerivation = prompt?.versions.find(v => v.version === viewing)?.derivation;
  const [note, setNote] = useState('');
  const [parentsCatalog, setParentsCatalog] = useState<EvalPrompt[]>([]), [mergeParent, setMergeParent] = useState(''), [snapshotNotice, setSnapshotNotice] = useState('');
  useEffect(() => { void listPrompts().then(setParentsCatalog).catch(() => {}); }, []);
  const [stageId, setStageId] = useState(workflow.stages[0].id);
  const [history, setHistory] = useState(() => createHistory(initialStages, workflow.stages[0].id));
  const stages = history.entries[history.index].value;
  const restore = useRef<{ scope: string; selection: TextSelection }>(undefined);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const editor = useRef<TemplateEditorHandle>(null);
  const pending = useRef<{ signature: string; requestId: string }>(undefined);
  const stage = workflow.stages.find(item => item.id === stageId)!;
  const referenceIds = useMemo(() => references && new Set(references.map(item => item.id)), [references]);
  const [checkedStages, setCheckedStages] = useState(stages);
  useEffect(() => { const timer = setTimeout(() => setCheckedStages(stages), 2000); return () => clearTimeout(timer); }, [stages]);
  const issues = useMemo(() => {
    const result = validatePromptStages(workflow, stages, referenceIds);
    for (const [key, text] of Object.entries(checkedStages)) (result[key] ??= []).push(...parsePromptSections(text, templateBase).issues);
    return result;
  }, [workflow, stages, checkedStages, referenceIds, templateBase]);
  const known = useMemo(() => new Set([...workflow.variables.map(variable => variable.name), ...(references ?? []).map(item => referenceKey(item.id))]), [workflow, references]);
  const used = new Set(templateVariables(stages[stageId] ?? ''));
  const cited = new Set(templateReferences(stages[stageId] ?? ''));
  const [referenceQuery, setReferenceQuery] = useState(''), [peek, setPeek] = useState<string>();
  // Archived references stay listed while this stage still cites them.
  const pickable = (references ?? []).filter(item => (!item.archivedAt || cited.has(item.id))
    && `${item.name}\n${item.id}`.toLowerCase().includes(referenceQuery.toLowerCase()));
  const peeked = references?.find(item => item.id === peek);
  const textChanged = JSON.stringify(stages) !== JSON.stringify(prompt ? baseStages : initialStages);
  const stagesChanged = textChanged || !!prompt && viewing !== latest!.version || !!mergeParent;
  const dirty = !!mergeParent || !prompt || textChanged || name !== prompt.name || description !== (prompt.description ?? '');
  useEffect(() => { onDirty(!!prompt && dirty); }, [dirty, prompt, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const errors = promptHasErrors(issues), stageErrors = (id: string) => issues[id]?.filter(issue => issue.severity === 'error').length ?? 0;
  const [pendingVersion, setPendingVersion] = useState<number>();
  const applyVersion = (version: number) => { setViewing(version); setHistory(createHistory(prompt!.versions.find(item => item.version === version)!.stages, stageId)); };
  const view = (version: number) => { if (textChanged) setPendingVersion(version); else applyVersion(version); };
  const save = async () => {
    const tagErrors = Object.values(stages).flatMap(text => parsePromptSections(text, templateBase).issues);
    if (tagErrors.length) { setCheckedStages(stages); setError(tagErrors.map(i => i.message).join(' ' )); return; }
    const merge = mergeParent ? JSON.parse(mergeParent) as { promptId: string; version: number } : undefined;
    const body = { ...(merge && prompt ? { parents: [{ promptId: prompt.id, version: viewing!, relation: 'merge' as const }, { ...merge, relation: 'merge' as const }] } : {}), templateBase, workflow: workflow.id, name: name.trim(), stages, ...(description.trim() || prompt?.description ? { description: description.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}), ...(prompt ? { promptId: prompt.id, baseVersion: latest!.version, derivation: { parent: { promptId: prompt.id, version: viewing! }, kind: 'revision' as const } }
        : draft?.from && sourceVersion ? { derivation: { parent: { promptId: draft.from.id, version: sourceVersion.version }, kind: dimension.trim() ? 'variation' as const : 'fork' as const,
          ...(dimension.trim() ? { dimension: { id: dimension.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80), name: dimension.trim(), value: dimensionValue.trim() } } : {}) } } : {}) };
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
      : variable.name === 'references' ? '‹selected reference titles and ASCII examples›' : variable.name === 'passes' ? '1' : variable.name === 'pass' ? '1'
      : variable.name === 'previous' ? 'previous-1.json ("‹earlier alternative›")' : `"‹${variable.name} name›"`]
    ).concat((references ?? []).map(item => [referenceKey(item.id), renderReference(item.ascii, item.comment)])));
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
  const canSave = !busy && !errors && (dirty || stagesChanged) && !!name.trim() && (!draft?.from || (!dimension.trim() && !dimensionValue.trim()) || (!!dimension.trim() && !!dimensionValue.trim()));
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
    {pendingVersion !== undefined && <ConfirmDialog title="Discard edits" message="Discard unsaved prompt edits?" confirmLabel="Discard"
      onConfirm={() => applyVersion(pendingVersion)} onClose={() => setPendingVersion(undefined)} />}
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
        {prompt && <button type="button" onClick={() => onDuplicate(prompt, viewing!)}>Fork prompt</button>}
        {prompt && <button type="button" disabled={busy} onClick={() => void archive()}>{prompt.archivedAt ? 'Restore' : 'Archive'}</button>}
        {prompt && !prompt.archivedAt && <button type="button" disabled={dirty || stagesChanged} title={dirty || stagesChanged ? 'Save before running' : undefined} onClick={() => onRun(prompt)}>Run…</button>}
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const snapshot = await snapshotPrompts(); setSnapshotNotice(`Project prompt snapshot saved: ${snapshot.id}`); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>Snapshot project prompts</button>
        <span className="evals-button-group">
          <button type="button" aria-label="Undo" title={`Undo (${mod}Z)`} disabled={!canUndo(history)} onClick={() => step(undo)}>↶</button>
          <button type="button" aria-label="Redo" title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`} disabled={!canRedo(history)} onClick={() => step(redo)}>↷</button>
        </span>
        <button type="submit" className="is-primary" title={`${nextLabel} (${mod}S)`} aria-keyshortcuts={isMac ? 'Meta+S' : 'Control+S'} disabled={!canSave}>{busy ? 'Saving…' : nextLabel}</button>
      </div>
    </header>
    {prompt && viewing !== latest!.version && <p className="evals-notice" role="status">Viewing v{viewing}. Saving creates v{latest!.version + 1} from this text.</p>}
    {draft?.from && sourceVersion && <p className="evals-notice">Variation of {draft.from.name} · v{sourceVersion.version}. This parent version stays pinned when its prompt changes.</p>}
    {!!viewedVersion?.parents?.length && <p className="evals-notice">Parents: {viewedVersion.parents!.map((p, i) => <span key={i}>{i ? ' · ' : ''}{p.relation}: <a href={`?prompt=${p.promptId}&version=${p.version}`}>{parentsCatalog.find(item => item.id === p.promptId)?.name ?? p.promptId} v{p.version}</a></span>)}{viewedDerivation?.dimension && ` · ${viewedDerivation.dimension.name}: ${viewedDerivation.dimension.value}`}</p>}
    {viewedDerivation && !viewedVersion?.parents?.length && <p className="evals-notice">{viewedDerivation.kind} of <a href={`?prompt=${encodeURIComponent(viewedDerivation.parent.promptId)}&version=${viewedDerivation.parent.version}`}>{viewedDerivation.parent.promptId} · v{viewedDerivation.parent.version}</a>{viewedDerivation.dimension && ` · ${viewedDerivation.dimension.name}: ${viewedDerivation.dimension.value}`}</p>}
    {snapshotNotice && <p role="status" className="evals-notice">{snapshotNotice}</p>}
    {error && <p role="alert" className="evals-error">{error}</p>}
    <div className="prompt-editor-body">
      <div className="prompt-editor-main">
        <div className="prompt-meta">
          {prompt && <label>Merge parent (optional)<select aria-label="Merge parent" value={mergeParent} onChange={event => setMergeParent(event.target.value)}><option value="">No merge</option>{parentsCatalog.filter(p => p.workflow === workflow.id).flatMap(p => p.versions.filter(v => p.id !== prompt.id || v.version !== viewing).map(v => <option key={`${p.id}:${v.version}`} value={JSON.stringify({ promptId: p.id, version: v.version })}>{p.name} · v{v.version}</option>))}</select><small>Edit the combined text below; saving records both exact parent versions.</small></label>}

          {draft?.from && <>
            <label>Changed dimension<input aria-label="Changed dimension" list="prompt-dimensions" maxLength={120} value={dimension} onChange={e => setDimension(e.target.value)} placeholder="e.g. Expression" /></label>
            <datalist id="prompt-dimensions"><option value="Expression" /><option value="Organizing focus" /><option value="Tree topology" /></datalist>
            <label>Dimension setting<input aria-label="Dimension setting" maxLength={500} value={dimensionValue} onChange={e => setDimensionValue(e.target.value)} placeholder="e.g. 100% code / 0% natural language" /></label>
          </>}
          <label>Description<input value={description} maxLength={500} placeholder="What this prompt tries" onChange={event => setDescription(event.target.value)} /></label>
          {prompt && stagesChanged && <label>Version note<input value={note} maxLength={500} placeholder={`What changed in v${latest!.version + 1}`} onChange={event => setNote(event.target.value)} /></label>}
        </div>
        {workflow.stages.length > 1 && <div role="tablist" aria-label="Prompt stages" className="evals-tabs">
          {workflow.stages.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === stageId} onClick={() => setStageId(item.id)}>
            {item.label}{stageErrors(item.id) > 0 && <span className="evals-count is-error" aria-label={`${stageErrors(item.id)} errors`}>{stageErrors(item.id)}</span>}
          </button>)}
        </div>}
        <p className="evals-muted">{stage.description}</p>
        <p className="evals-muted">This is the full prompt. Include input files, template guidance, and output requirements here. Execution only fills the visible variables.</p>
        <PromptSectionsEditor base={templateBase} ref={editor} label={`${stage.label} instructions`} known={known} value={stages[stageId] ?? ''}
          onChange={edit} onUndo={() => step(undo)} onRedo={() => step(redo)} />
        <p className="prompt-shortcuts" aria-label="Keyboard shortcuts"><kbd>{mod}Z</kbd> undo <kbd>{isMac ? '⇧⌘Z' : 'Ctrl+Y'}</kbd> redo <kbd>{mod}S</kbd> save
          <kbd>Tab</kbd>/<kbd>⇧Tab</kbd> indent <kbd>{isMac ? '⌥' : 'Alt+'}↑↓</kbd> move line <kbd>{isMac ? '⇧⌥' : 'Shift+Alt+'}↑↓</kbd> duplicate line <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor</p>

        <button type="button" className="evals-link" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? 'Hide' : 'Show'} full prompt preview</button>
        {preview && <pre className="prompt-preview" aria-label="Full prompt preview">{(() => {
          try { return composePrompt(workflow, stageId, stages[stageId] ?? '', sample, templateBase); } catch (error) { return errorMessage(error); }
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
        <h3>References</h3>
        <p className="evals-muted">Saved diagram excerpts. Click to cite one at the cursor; its text is placed there when the prompt runs.</p>
        {references && references.length > 0 && <input type="search" className="prompt-reference-filter" aria-label="Filter references" placeholder="Filter references…"
          value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} />}
        {!references ? <p role="status" className="evals-muted">Loading…</p>
          : !references.some(item => !item.archivedAt) ? <p className="evals-muted">None yet. Create one in the explorer's References tab.</p>
          : <div className="prompt-reference-list" onMouseLeave={() => setPeek(undefined)}>{pickable.map(item => <button type="button" key={item.id} className="prompt-variable"
            aria-label={`Insert reference ${item.name}`} onClick={() => editor.current?.insert(referenceToken(item.id))}
            onMouseEnter={() => setPeek(item.id)} onFocus={() => setPeek(item.id)}>
            <code>{referenceToken(item.id)}</code>{cited.has(item.id) && <span className="prompt-used" title="Cited in this stage">used</span>}
            {item.archivedAt && <span className="evals-badge is-muted">archived</span>}
            <small>{item.name} · {item.ascii.split('\n').length} lines</small>
          </button>)}</div>}
        {peeked && <pre className="reference-ascii prompt-reference-peek" aria-label={`Preview of ${peeked.name}`}>{renderReference(peeked.ascii, peeked.comment)}</pre>}
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
