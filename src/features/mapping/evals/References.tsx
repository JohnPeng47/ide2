import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CompareCandidate, CompareCanvasCopy, CompareSource } from '../../../../domain/mapping/compare/comparePageSession';
import type { CanvasHistoryRecord } from '../../../../domain/core/diagrams/canvasHistory';
import { initialCanvasState, type MappingCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { referenceExcerpt, referenceToken, type EvalReference, type EvalReferenceGroup } from '../../../../domain/mapping/evals/evalReference';
import { diagramLeafKey } from '../../../../domain/mapping/evals/referenceExplorer';
import { diagramTitle } from '../../../../domain/core/diagrams/promoteDiagram';
import { deselectCanvas } from '../../../../domain/mapping/selection/canvasSelection';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { templateReferences } from '../../../../domain/mapping/evals/promptTemplate';
import { CanvasSession } from '../workspace/canvasSession';
import { MappingEditorCanvas } from '../tldraw/MappingEditorCanvas';
import { MappingPocSelectionCanvas } from '../canvas/MappingCanvas';
import { listCompareCandidates } from './compareApi';
import { captureCanvas, createReference, createReferenceGroup, updateReference } from './evalsApi';
import { candidateKey, candidateLabel, sourceOf } from './CanvasPicker';
import { errorMessage, relativeTime } from './evalsFormat';
import { TrashIcon } from './EvalsTree';
import { singleDiagramDocument } from './promoteDiagram';
import { ReferenceGenerateDialog } from './ReferenceGenerateDialog';

const lineCount = (ascii: string) => ascii.split('\n').length;

/** One reference: its frozen text, where it came from, and which prompts cite it. */
export function ReferenceView({ reference, groups, prompts, onChanged, onOpenPrompt }: {
  reference: EvalReference; groups: EvalReferenceGroup[]; prompts: EvalPrompt[]; onChanged: (reference: EvalReference) => void; onOpenPrompt: (id: string) => void;
}) {
  const [name, setName] = useState(reference.name), [comment, setComment] = useState(reference.comment ?? ''), [status, setStatus] = useState(''), [error, setError] = useState('');
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
      <dt>Group</dt><dd><select aria-label="Reference group" value={groups.some(group => group.id === reference.groupId) ? reference.groupId : ''}
        onChange={event => { const groupId = event.target.value || null; void act(() => updateReference(reference.id, { groupId })); }}>
        <option value="">Ungrouped</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></dd>
      <dt>From</dt><dd>{reference.diagramName ? `${reference.diagramName} · ` : ''}{reference.sourceName}{reference.canvasName && reference.canvasName !== reference.sourceName ? ` · ${reference.canvasName}` : ''} · saved {relativeTime(reference.createdAt)}</dd>
      <dt>Cited by</dt><dd>{citing.length ? citing.map((prompt, i) => <span key={prompt.id}>{i > 0 && ', '}
        <button type="button" className="evals-link" onClick={() => onOpenPrompt(prompt.id)}>{prompt.name}</button></span>) : <span className="evals-muted">No prompts yet. Insert it from the References list in the prompt editor.</span>}</dd>
    </dl>
    <label className="reference-comment">Comment <small className="evals-muted">Optional. Placed right after the excerpt in prompts that cite it. Runs already started keep the comment they began with.</small>
      <textarea aria-label="Reference comment" rows={3} maxLength={5000} value={comment} onChange={event => setComment(event.target.value)}
        onBlur={() => { if (comment.trim() !== (reference.comment ?? '')) void act(() => updateReference(reference.id, { comment: comment.trim() })); }} />
    </label>
    <pre className="reference-ascii" aria-label="Reference text">{reference.ascii}</pre>
  </div>;
}

/** Shown when the References area opens with nothing chosen. */
export function ReferencesLanding({ count, onCapture }: { count: number; onCapture: () => void }) {
  return <div className="reference-landing">
    <h2>References</h2>
    <p className="evals-muted">{count ? `${count} saved excerpt${count === 1 ? '' : 's'}. Choose one from the explorer to see its text and which prompts cite it.` : 'Saved diagram excerpts that prompts cite with {{ref:…}}.'}</p>
    <button type="button" className="is-primary" onClick={onCapture}>Capture from a diagram</button>
  </div>;
}

/** A selection held for review. It becomes a reference only when promoted. */
export interface ReferenceCapture {
  /** The request ID of its create call, so retrying a failed promotion cannot duplicate it. */
  id: string;
  ascii: string; name: string; comment?: string; checked: boolean; diagramKey: string; diagramName: string;
  source: CompareSource; sourceName: string; canvasName: string;
}
const CAPTURES = 'evals-reference-captures';
/** Captures outlive switching diagrams, tabs and pages, and a reload of this browser tab. */
export function useReferenceCaptures() {
  const [captures, setCaptures] = useState<ReferenceCapture[]>(() => { try { return (JSON.parse(sessionStorage.getItem(CAPTURES) ?? '[]') as ReferenceCapture[]).map(item => ({ ...item, ascii: referenceExcerpt(item.ascii) })); } catch { return []; } });
  useEffect(() => { sessionStorage.setItem(CAPTURES, JSON.stringify(captures)); }, [captures]);
  return [captures, setCaptures] as const;
}

let candidatesLoading: Promise<CompareCandidate[]> | undefined;
/** Concurrent callers (StrictMode replays) share one request. */
export const loadCandidates = () => candidatesLoading ??= listCompareCandidates().finally(() => { candidatesLoading = undefined; });

const NEW_GROUP = '(new)';
const PANEL_WIDTH = 'evals-reference-panel-width', DEFAULT_PANEL_WIDTH = 340, MIN_PANEL_WIDTH = 260, MIN_CANVAS_WIDTH = 320;
export interface ReferenceTarget { source: CompareSource; diagramId: string }

/** Select part of one diagram, capture selections as you go, then tick which ones to promote into references. */
export function ReferenceWorkbench({ target, candidates, groups, captures, setCaptures, onCreated, onGroupCreated, onOpenReference }: {
  target?: ReferenceTarget; candidates?: CompareCandidate[]; groups: EvalReferenceGroup[];
  captures: ReferenceCapture[]; setCaptures: Dispatch<SetStateAction<ReferenceCapture[]>>;
  onCreated: (reference: EvalReference) => void; onGroupCreated: (group: EvalReferenceGroup) => void; onOpenReference: (id: string) => void;
}) {
  const copies = useRef(new Map<string, Promise<CompareCanvasCopy>>());
  const [loaded, setLoaded] = useState<{ key: string; copy: CompareCanvasCopy }>(), [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string | null>(null), [generating, setGenerating] = useState<string | null>(null);
  const canvasSession = useRef<CanvasSession>(undefined);
  const [groupChoice, setGroupChoice] = useState(''), [newGroup, setNewGroup] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [promoted, setPromoted] = useState<EvalReference[]>([]);
  const newGroupRequest = useRef({ name: '', requestId: '' });
  const body = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(() => Number(localStorage.getItem(PANEL_WIDTH)) || DEFAULT_PANEL_WIDTH);
  const resizePanel = (width: number) => {
    const available = body.current?.getBoundingClientRect().width ?? Infinity;
    const next = Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(available - MIN_CANVAS_WIDTH, width)));
    setPanelWidth(next); localStorage.setItem(PANEL_WIDTH, String(next));
  };
  const sourceKey = target ? JSON.stringify(sourceOf(target.source)) : undefined;
  useEffect(() => {
    if (!target || !sourceKey) { setLoaded(undefined); return; }
    let closed = false; setLoadError(''); setSelected(null);
    // Diagrams of one canvas share a capture, so moving between them is immediate.
    let pending = copies.current.get(sourceKey);
    if (!pending) {
      pending = captureCanvas(sourceOf(target.source));
      copies.current.set(sourceKey, pending);
      pending.catch(() => copies.current.delete(sourceKey));
    }
    void pending.then(copy => { if (!closed) setLoaded({ key: sourceKey, copy }); }).catch(error => { if (!closed) setLoadError(errorMessage(error)); });
    return () => { closed = true; };
  }, [sourceKey, target?.diagramId]);
  const copy = loaded?.key === sourceKey ? loaded?.copy : undefined;
  const diagram = useMemo(() => {
    if (!copy || !target) return undefined;
    try { return { value: singleDiagramDocument(copy.history, target.diagramId.replace(/^grid:/, '')) }; }
    catch (error) { return { error: errorMessage(error) }; }
  }, [copy, target?.diagramId]);
  const candidate = target && candidates?.find(item => candidateKey(item) === candidateKey(target.source));
  const leaf = candidate?.diagrams.find(item => item.diagramId === target?.diagramId);
  // Read from the diagram itself, so it is right even before the diagram list has loaded.
  const content = diagram?.value && target ? Object.values(diagram.value.document.scene.contents)[0] : undefined;
  const diagramName = leaf?.name.trim() ?? (content && diagramTitle(content.content.ascii)) ?? '';
  const diagramKey = target ? diagramLeafKey(target.source, target.diagramId) : '';
  const alreadyCaptured = !!selected && captures.some(item => item.diagramKey === diagramKey && item.ascii === selected);
  const addCapture = (ascii: string) => {
    if (!target) return;
    setPromoted([]); setError('');
    setCaptures(current => [...current, { id: crypto.randomUUID(), ascii, name: firstLabel(ascii), checked: true, diagramKey, diagramName,
      source: sourceOf(target.source), sourceName: candidate?.name ?? 'Current saved canvas', canvasName: candidate?.canvasName ?? copy?.canvasName ?? '' }]);
  };
  const capture = () => {
    if (!selected || alreadyCaptured) return;
    addCapture(selected);
    // Each capture starts the next selection fresh, instead of the next drag adding to this one.
    canvasSession.current?.controller.updateCanvas(deselectCanvas, true);
  };
  const edit = (id: string, change: Partial<ReferenceCapture>) => setCaptures(current => current.map(item => item.id === id ? { ...item, ...change } : item));
  const checked = captures.filter(item => item.checked);
  const allChecked = captures.length > 0 && checked.length === captures.length;
  const ready = checked.length > 0 && checked.every(item => item.name.trim()) && (groupChoice !== NEW_GROUP || !!newGroup.trim());
  const promote = async () => {
    if (!ready) return;
    setBusy(true); setError(''); setPromoted([]);
    const created: EvalReference[] = [];
    try {
      let groupId = groupChoice || undefined;
      if (groupChoice === NEW_GROUP) {
        const name = newGroup.trim();
        if (newGroupRequest.current.name !== name) newGroupRequest.current = { name, requestId: crypto.randomUUID() };
        const group = await createReferenceGroup({ requestId: newGroupRequest.current.requestId, name });
        onGroupCreated(group); groupId = group.id; setGroupChoice(group.id); setNewGroup('');
      }
      // One at a time: IDs are derived from names, and each success leaves the tray even if a later one fails.
      for (const item of checked) {
        const reference = await createReference({ requestId: item.id, name: item.name.trim(), ascii: item.ascii, source: item.source, sourceName: item.sourceName, canvasName: item.canvasName,
          ...(item.diagramName ? { diagramName: item.diagramName.slice(0, 200) } : {}), ...(groupId ? { groupId } : {}), ...(item.comment?.trim() ? { comment: item.comment.trim() } : {}) });
        created.push(reference); onCreated(reference);
        setCaptures(current => current.filter(other => other.id !== item.id));
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setPromoted(created); setBusy(false); }
  };
  return <div className="reference-creator">
    <header className="evals-view-header">
      <div className="evals-breadcrumb"><span>References</span><span aria-hidden>›</span><strong>{target ? diagramName || 'Diagram' : 'Capture from a diagram'}</strong></div>
      {candidate && <span className="evals-muted reference-creator-source">{candidateLabel(candidate)}</span>}
    </header>
    <div className="reference-creator-body" ref={body} style={{ gridTemplateColumns: `minmax(0, 1fr) 5px min(${panelWidth}px, calc(100% - ${MIN_CANVAS_WIDTH}px))` }}>
      <div className="reference-creator-canvas">
        {loadError ? <p role="alert" className="evals-error">{loadError}</p>
          : diagram?.error ? <p role="alert" className="evals-error">{diagram.error}</p>
          : diagram?.value ? <SelectableCanvas key={diagramKey} name={diagramName} document={diagram.value.document} history={diagram.value.history} onSession={value => { canvasSession.current = value; }} onSelectionText={text => setSelected(text === null ? null : referenceExcerpt(text) || null)} />
          : <p className="evals-message" role={target ? 'status' : undefined}>{target ? 'Loading diagram…' : 'Choose a diagram from the Canvas explorer.'}</p>}
      </div>
      <div role="separator" aria-label="Resize captures panel" aria-orientation="vertical" aria-valuemin={MIN_PANEL_WIDTH} aria-valuenow={panelWidth} tabIndex={0} className="evals-divider"
        onDoubleClick={() => resizePanel(DEFAULT_PANEL_WIDTH)}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resizePanel(panelWidth + (event.key === 'ArrowLeft' ? 16 : -16)); } if (event.key === 'Home') resizePanel(DEFAULT_PANEL_WIDTH); }}
        onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizePanel(body.current!.getBoundingClientRect().right - event.clientX); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
      <aside className="reference-creator-draft" aria-label="Reference captures">
        <section aria-label="Current selection">
          <h3>Selection</h3>
          {selected ? <pre className="reference-ascii" aria-label="Selection preview">{selected}</pre>
            : <p className="evals-muted">Click a node, <kbd>Ctrl</kbd>+drag a box, or <kbd>Shift</kbd>+click to add nodes.</p>}
          <div className="evals-actions">
            <button type="button" className="reference-capture-button" disabled={!selected || alreadyCaptured} onClick={capture}>{alreadyCaptured ? 'Already captured' : 'Capture selection'}</button>
            <button type="button" disabled={!selected || !content} onClick={() => setGenerating(selected)}>Generate</button>
          </div>
        </section>
        <section aria-label="Captured selections" className="reference-captures">
          <div className="reference-captures-heading">
            <h3>Captured{captures.length > 0 && <span className="evals-count">{captures.length}</span>}</h3>
            {captures.length > 1 && <label><input type="checkbox" checked={allChecked} onChange={event => setCaptures(current => current.map(item => ({ ...item, checked: event.target.checked })))} /> All</label>}
          </div>
          {!captures.length ? <p className="evals-muted">Captured selections collect here, across diagrams, until you promote them. The text is frozen once promoted.</p>
            : <ul aria-label="Captured selections">{captures.map(item => <li key={item.id} className="reference-capture">
              <input type="checkbox" aria-label={`Promote ${item.name || 'capture'}`} checked={item.checked} onChange={event => edit(item.id, { checked: event.target.checked })} />
              <div className="reference-capture-body">
                <input aria-label="Reference name" value={item.name} maxLength={120} onChange={event => edit(item.id, { name: event.target.value })} />
                <textarea aria-label={`Comment for ${item.name || 'capture'}`} rows={2} maxLength={5000} placeholder="Comment (optional), added to the prompt with this excerpt" value={item.comment ?? ''} onChange={event => edit(item.id, { comment: event.target.value })} />
                <details><summary title={item.diagramName}>{lineCount(item.ascii)} line{lineCount(item.ascii) === 1 ? '' : 's'} · {item.diagramName}</summary><pre className="reference-ascii">{item.ascii}</pre></details>
              </div>
              <button type="button" className="evals-tree-delete reference-capture-remove" aria-label={`Discard ${item.name || 'capture'}`} title="Discard" onClick={() => setCaptures(current => current.filter(other => other.id !== item.id))}><TrashIcon /></button>
            </li>)}</ul>}
        </section>
        {error && <p role="alert" className="evals-error">{error}</p>}
        {promoted.length > 0 && <p role="status" className="evals-notice">Promoted {promoted.length} reference{promoted.length === 1 ? '' : 's'}. <button type="button" className="evals-link" onClick={() => onOpenReference(promoted[0].id)}>Open {promoted[0].name}</button></p>}
        <div className="reference-promote">
          <label>Group
            <select aria-label="Group for promoted references" value={groupChoice} onChange={event => setGroupChoice(event.target.value)}>
              <option value="">Ungrouped</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}<option value={NEW_GROUP}>New group…</option>
            </select>
          </label>
          {groupChoice === NEW_GROUP && <input aria-label="New group name" placeholder="Group name" value={newGroup} maxLength={120} onChange={event => setNewGroup(event.target.value)} />}
          <button type="button" className="is-primary" disabled={!ready || busy} onClick={() => void promote()}>{busy ? 'Promoting…' : `Promote ${checked.length || ''} to reference${checked.length === 1 ? '' : 's'}`}</button>
        </div>
      </aside>
    </div>
    {generating && target && content && <ReferenceGenerateDialog excerpt={generating} session={{ source: sourceOf(target.source), boxId: target.diagramId.replace(/^grid:/, ''), revisionId: content.revisionId }}
      isCaptured={ascii => captures.some(item => item.diagramKey === diagramKey && item.ascii === ascii)} onCapture={addCapture} onClose={() => setGenerating(null)} />}
  </div>;
}

/** The first tree label in the excerpt, e.g. `+-- saved[id]` → `saved[id]`. */
function firstLabel(ascii: string) {
  const line = ascii.split('\n').map(text => text.replace(/^[\s|+`\\-]*/, '').trim()).find(Boolean) ?? '';
  return line.slice(0, 80);
}

/** One diagram on the Mapping canvas with its selection tools, in memory: nothing is saved back. */
function SelectableCanvas({ name, document, history, onSession, onSelectionText }: { name: string; document: ReturnType<typeof singleDiagramDocument>['document']; history: CanvasHistoryRecord; onSession: (session: CanvasSession) => void; onSelectionText: (ascii: string | null) => void }) {
  // Owned by the effect: disposal stops store updates for good, so StrictMode's replay needs a session of its own.
  const [session, setSession] = useState<CanvasSession>();
  useEffect(() => {
    const canvas = structuredClone(history.snapshots[history.headId].view ?? initialCanvasState()) as MappingCanvasState;
    canvas.selection = { items: [] };
    const created = new CanvasSession({ name, savedName: name, savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges), document, canvas, history: structuredClone(history) });
    setSession(created); onSession(created);
    return () => created.dispose();
  }, [document, history]);
  if (!session) return null;
  return <div className="reference-canvas mapping-editor-canvas">
    <MappingEditorCanvas session={session} enabled className="mapping-poc-canvas" centerContent>
      <MappingPocSelectionCanvas session={session} active onSelectionText={onSelectionText} />
    </MappingEditorCanvas>
  </div>;
}
