import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompareCandidate, CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { initialCanvasState, type MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { referenceToken, type EvalReference } from '../../../../domain/mapping/evals/evalReference';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { templateReferences } from '../../../../domain/mapping/evals/promptTemplate';
import { CanvasSession } from '../workspace/canvasSession';
import { MappingEditorCanvas } from '../tldraw/MappingEditorCanvas';
import { MappingPocSelectionCanvas } from '../canvas/MappingCanvas';
import { listCompareCandidates } from './compareApi';
import { captureCanvas, createReference, updateReference } from './evalsApi';
import { candidateKey, CanvasPicker, sourceOf } from './CanvasPicker';
import { errorMessage, relativeTime } from './evalsFormat';
import { TrashIcon } from './EvalsTree';

const lineCount = (ascii: string) => ascii.split('\n').length;

/** The References tab of the explorer: saved diagram excerpts that prompts cite. */
export function ReferenceList({ references, current, onOpen, onNew, onArchive }: {
  references: EvalReference[]; current?: string; onOpen: (id: string) => void; onNew: () => void; onArchive: (reference: EvalReference) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = references.filter(item => `${item.name}\n${item.id}\n${item.canvasName}\n${item.sourceName}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="reference-list">
    <div className="reference-list-tools">
      <input type="search" aria-label="Filter references" placeholder="Filter…" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" className="is-primary" onClick={onNew}>+ New</button>
    </div>
    {!references.length ? <p className="evals-muted reference-empty">Select part of a diagram and save it as a reference. Prompts can then cite it with <code>{'{{ref:…}}'}</code>.</p>
      : <ul role="list" aria-label="References">{shown.map(item => <li key={item.id} className={`evals-tree-row${item.id === current ? ' is-current' : ''}`} title={item.ascii}>
        <button type="button" className="evals-tree-label" aria-current={item.id === current ? 'page' : undefined} onClick={() => onOpen(item.id)}>
          <span>{item.name}</span><small className="reference-id">{item.id}</small>
        </button>
        <span className="evals-tree-meta">{lineCount(item.ascii)} lines</span>
        <button type="button" className="evals-tree-delete" aria-label={`Archive reference ${item.name}`} title="Archive (prompts that cite it keep working)" onClick={() => onArchive(item)}><TrashIcon /></button>
      </li>)}</ul>}
  </div>;
}

/** One reference: its frozen text, where it came from, and which prompts cite it. */
export function ReferenceView({ reference, prompts, onChanged, onOpenPrompt }: {
  reference: EvalReference; prompts: EvalPrompt[]; onChanged: (reference: EvalReference) => void; onOpenPrompt: (id: string) => void;
}) {
  const [name, setName] = useState(reference.name), [status, setStatus] = useState(''), [error, setError] = useState('');
  const citing = prompts.filter(prompt => prompt.versions.some(version => Object.values(version.stages).some(body => templateReferences(body).includes(reference.id))));
  const token = referenceToken(reference.id);
  const act = async (task: () => Promise<EvalReference>) => {
    setError('');
    try { onChanged(await task()); } catch (error) { setError(errorMessage(error)); }
  };
  return <div className="reference-view">
    <header className="evals-view-header">
      <div className="evals-breadcrumb"><span>References</span><span aria-hidden>›</span>
        <input aria-label="Reference name" className="prompt-name" value={name} maxLength={120} onChange={event => setName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          onBlur={() => { if (name.trim() && name.trim() !== reference.name) void act(() => updateReference(reference.id, { name: name.trim() })); }} />
        {reference.archivedAt && <span className="evals-badge is-muted">Archived</span>}
      </div>
      <div className="evals-actions">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(token).then(() => setStatus('Token copied'), () => setStatus('Copy failed'))}>Copy token</button>
        <button type="button" onClick={() => void act(() => updateReference(reference.id, { archived: !reference.archivedAt }))}>{reference.archivedAt ? 'Restore' : 'Archive'}</button>
      </div>
    </header>
    {error && <p role="alert" className="evals-error">{error}</p>}
    <dl className="reference-facts">
      <dt>Token</dt><dd><code>{token}</code> <small className="evals-muted" aria-live="polite">{status}</small></dd>
      <dt>From</dt><dd>{reference.sourceName}{reference.canvasName && reference.canvasName !== reference.sourceName ? ` · ${reference.canvasName}` : ''} · saved {relativeTime(reference.createdAt)}</dd>
      <dt>Cited by</dt><dd>{citing.length ? citing.map((prompt, i) => <span key={prompt.id}>{i > 0 && ', '}
        <button type="button" className="evals-link" onClick={() => onOpenPrompt(prompt.id)}>{prompt.name}</button></span>) : <span className="evals-muted">No prompts yet. Insert it from the References list in the prompt editor.</span>}</dd>
    </dl>
    <pre className="reference-ascii" aria-label="Reference text">{reference.ascii}</pre>
  </div>;
}

/** Pick a canvas, select part of a diagram with the Mapping selection tools, and save the copied ASCII. */
export function ReferenceCreator({ onCreated, onCancel }: { onCreated: (reference: EvalReference) => void; onCancel: () => void }) {
  const [candidates, setCandidates] = useState<CompareCandidate[]>(), [key, setKey] = useState('');
  const [copy, setCopy] = useState<CompareCanvasCopy>(), [loading, setLoading] = useState(false);
  /** The live selection's text; the name survives reselecting. */
  const [selected, setSelected] = useState<string | null>(null), [name, setName] = useState('');
  const draft = selected ? { ascii: selected, name } : undefined;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ signature: string; requestId: string }>(undefined);
  useEffect(() => { void listCompareCandidates().then(setCandidates).catch(error => setError(errorMessage(error))); }, []);
  const candidate = candidates?.find(item => candidateKey(item) === key);
  useEffect(() => {
    if (!candidate) { setCopy(undefined); return; }
    let closed = false; setLoading(true); setError(''); setCopy(undefined);
    void captureCanvas(sourceOf(candidate)).then(value => { if (!closed) setCopy(value); })
      .catch(error => { if (!closed) setError(errorMessage(error)); }).finally(() => { if (!closed) setLoading(false); });
    return () => { closed = true; };
  }, [key]);
  const save = async () => {
    if (!draft || !candidate) return;
    const body = { name: draft.name.trim(), ascii: draft.ascii, source: sourceOf(candidate), sourceName: candidate.name, canvasName: candidate.canvasName };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try { onCreated(await createReference({ requestId: pending.current.requestId, ...body })); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <div className="reference-creator">
    <header className="evals-view-header">
      <div className="evals-breadcrumb"><span>References</span><span aria-hidden>›</span><strong>New reference</strong></div>
      <div className="reference-creator-source">
        {candidates ? <CanvasPicker label="Canvas" candidates={candidates} value={key || undefined} onChange={setKey} /> : <span role="status" className="evals-muted">Loading canvases…</span>}
      </div>
    </header>
    {error && <p role="alert" className="evals-error">{error}</p>}
    <div className="reference-creator-body">
      <div className="reference-creator-canvas">
        {copy ? <SelectableCanvas key={copy.id + copy.source.checkpointId} copy={copy}
            onSelectionText={text => {
              // Copy always ends with a code-refs heading; drop it when no refs follow.
              const ascii = text?.replace(/\nAssociated Code Entities:\s*$/, '') ?? null;
              setSelected(ascii); if (ascii) setName(current => current || firstLabel(ascii));
            }} />
          : <p className="evals-message">{loading ? 'Loading canvas…' : 'Choose a canvas, then select nodes or drag a box around part of a diagram.'}</p>}
      </div>
      <aside className="reference-creator-draft" aria-label="Reference draft">
        <h3>Excerpt</h3>
        {draft ? <>
          <pre className="reference-ascii" aria-label="Excerpt preview">{draft.ascii}</pre>
          <label>Name<input aria-label="Reference name" value={draft.name} maxLength={120} onChange={event => setName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && draft.name.trim()) { event.preventDefault(); void save(); } }} /></label>
          <p className="evals-muted">This is exactly what <kbd>C</kbd> Copy ASCII copies. The text is frozen when saved; change the selection to change the excerpt.</p>
        </> : <p className="evals-muted">Select part of a diagram: click a node, <kbd>Ctrl</kbd>+drag a box, or <kbd>Shift</kbd>+click to add nodes. The excerpt appears here.</p>}
        <div className="evals-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="is-primary" disabled={!draft || !draft.name.trim() || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save reference'}</button>
        </div>
      </aside>
    </div>
  </div>;
}

/** The first tree label in the excerpt, e.g. `+-- saved[id]` → `saved[id]`. */
function firstLabel(ascii: string) {
  const line = ascii.split('\n').map(text => text.replace(/^[\s|+`\\-]*/, '').trim()).find(Boolean) ?? '';
  return line.slice(0, 80);
}

/** The Mapping canvas with its selection tools, on an in-memory copy: nothing is saved back. */
function SelectableCanvas({ copy, onSelectionText }: { copy: CompareCanvasCopy; onSelectionText: (ascii: string | null) => void }) {
  const session = useMemo(() => {
    const history = structuredClone(copy.history), document = documentFromHistory(history);
    const canvas = structuredClone(history.snapshots[history.headId].view ?? initialCanvasState()) as MappingCanvasState;
    canvas.selection = { items: [] };
    return new CanvasSession({ name: copy.view.name, savedName: copy.view.name,
      savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), document, canvas, history });
  }, [copy]);
  useEffect(() => () => session.dispose(), [session]);
  const viewport = session.controller.getSnapshot().canvas.viewport;
  return <div className="reference-canvas mapping-editor-canvas">
    <MappingEditorCanvas session={session} enabled className="mapping-poc-canvas" initialTransform={viewport}>
      <MappingPocSelectionCanvas session={session} active onSelectionText={onSelectionText} />
    </MappingEditorCanvas>
  </div>;
}
