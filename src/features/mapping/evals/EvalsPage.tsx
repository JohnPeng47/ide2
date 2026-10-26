import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { compareSessionSummary, type CompareCandidate, type ComparePageSession, type CompareSessionSummary, type CompareSource, type CreateCompareSession } from '../../../../domain/mapping/compare/comparePageSession';
import { createCompareSession, listCompareCandidates, listCompareSessions, readCompareSession } from './compareApi';
import { CompareCanvasPane } from './CompareCanvasPane';
import './evals.css';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const source = ({ documentId, checkpointId, viewId }: CompareCandidate): CompareSource => ({ documentId, ...(viewId ? { viewId } : {}), checkpointId });
class ComparisonBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { error: message(error) }; }
  render() { return this.state.error ? <p role="alert" className="evals-message">Unable to display this comparison: {this.state.error}</p> : this.props.children; }
}

export function EvalsPage() {
  const [summaries, setSummaries] = useState<CompareSessionSummary[]>([]);
  const [candidates, setCandidates] = useState<CompareCandidate[]>([]);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get('session') ?? '');
  const [session, setSession] = useState<ComparePageSession>();
  const [position, setPosition] = useState(0), [split, setSplit] = useState(50);
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [title, setTitle] = useState('Diagram comparison');
  const [A, setA] = useState('0'), [B, setB] = useState('1');
  const [pairs, setPairs] = useState<CreateCompareSession['pairs']>([]);
  const pending = useRef<{ key: string; request: CreateCompareSession } | undefined>(undefined);
  const splitRoot = useRef<HTMLDivElement>(null);
  const select = (id: string) => {
    setSelectedId(id); setCreating(false); setPosition(0); setError('');
    const url = new URL(location.href); url.searchParams.set('session', id); history.replaceState(null, '', url);
  };
  useEffect(() => {
    let cancelled = false;
    void Promise.all([listCompareSessions(), listCompareCandidates()]).then(([sessions, candidates]) => {
      if (cancelled) return;
      setSummaries(sessions); setCandidates(candidates);
      if (!selectedId && sessions.length) setSelectedId(sessions[0].id);
      if (!selectedId && !sessions.length) setCreating(true);
    }).catch(error => { if (!cancelled) setError(message(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false; setSession(undefined); setLoading(true);
    void readCompareSession(selectedId).then(session => { if (!cancelled) { setSession(session); setPosition(0); } })
      .catch(error => { if (!cancelled) setError(message(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);
  const pair = candidates[Number(A)] && candidates[Number(B)] && A !== B
    ? { A: source(candidates[Number(A)]), B: source(candidates[Number(B)]) } : undefined;
  const refresh = async () => {
    setBusy(true); setError('');
    try { setCandidates(await listCompareCandidates()); setPairs([]); setA('0'); setB('1'); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const create = async () => {
    const selectedPairs = pairs.length ? pairs : pair ? [pair] : [];
    if (!selectedPairs.length || !title.trim()) return;
    const input = { title: title.trim(), pairs: selectedPairs }, key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, request: { requestId: crypto.randomUUID(), ...input } };
    setBusy(true); setError('');
    try {
      const saved = await createCompareSession(pending.current.request);
      setSummaries(previous => [compareSessionSummary(saved), ...previous.filter(item => item.id !== saved.id)]);
      setSession(saved); setPairs([]); select(saved.id); pending.current = undefined;
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  const comparison = session?.compares[position];
  const name = (value: CompareSource) => candidates.find(candidate => JSON.stringify(source(candidate)) === JSON.stringify(value))?.name ?? 'Saved view';
  return <main className="evals-page">
    <header className="evals-header"><a href={import.meta.env.BASE_URL}>← Mapping</a><h1>Evals</h1><span>Compare saved canvas views</span></header>
    <div className="evals-layout">
      <aside className="evals-sidebar" aria-label="Comparison sessions">
        <div className="evals-sidebar-heading"><h2>Sessions</h2><button type="button" onClick={() => { setCreating(true); setError(''); }}>New session</button></div>
        {!summaries.length && !loading && <p className="evals-muted">No comparison sessions yet.</p>}
        {summaries.map(item => <button type="button" key={item.id} className={`evals-session${item.id === selectedId && !creating ? ' is-active' : ''}`}
          aria-current={item.id === selectedId && !creating ? 'true' : undefined} onClick={() => select(item.id)}>
          <strong>{item.title}</strong><small>{item.compareCount} comparison{item.compareCount === 1 ? '' : 's'} · {new Date(item.createdAt).toLocaleDateString()}</small>
        </button>)}
        {session && !creating && <nav className="evals-comparisons" aria-label="Comparisons"><h2>Comparisons</h2>
          {session.compares.map((item, index) => <button type="button" key={item.id} aria-current={index === position ? 'step' : undefined}
            onClick={() => setPosition(index)}>{index + 1}. {item.title}</button>)}
        </nav>}
      </aside>
      <section className="evals-content">
        {error && <p role="alert" className="evals-error">{error}</p>}
        {loading && <p role="status" className="evals-message">Loading comparisons…</p>}
        {creating && <form className="evals-create" onSubmit={event => { event.preventDefault(); void create(); }}>
          <h2>New comparison session</h2>
          <p>Choose two saved views. Each pane starts at its saved camera position. This session keeps its own copies.</p>
          <fieldset disabled={busy || loading}>
            <label>Session name<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
            {(['A', 'B'] as const).map(side => <label key={side}>View {side}<select aria-label={`View ${side}`} value={side === 'A' ? A : B}
              onChange={event => (side === 'A' ? setA : setB)(event.target.value)}>
              {candidates.map((candidate, index) => <option key={`${candidate.documentId}:${candidate.viewId ?? 'current'}`} value={index}>
                {candidate.canvasName} — {candidate.name}
              </option>)}
            </select></label>)}
            {candidates.length < 2 && <p>Save at least two canvases or CanvasViews in Mapping, then refresh this list.</p>}
            {A === B && candidates.length > 1 && <p>Choose a different view for each side.</p>}
            {pairs.length > 0 && <ol className="evals-pair-list">{pairs.map((pair, index) => <li key={index}>
              <span>{name(pair.A)} / {name(pair.B)}</span><button type="button" aria-label={`Remove pair ${index + 1}`} onClick={() => setPairs(pairs.filter((_, i) => i !== index))}>Remove</button>
            </li>)}</ol>}
            <div className="evals-form-actions">
              <button type="button" onClick={() => void refresh()}>Refresh views</button>
              <button type="button" disabled={!pair || pairs.length >= 10} onClick={() => { if (pair) setPairs([...pairs, pair]); }}>Add pair to session</button>
              <button type="submit" disabled={!title.trim() || !pairs.length && !pair}>{busy ? 'Saving…' : `Create session${pairs.length ? ` (${pairs.length} pairs)` : ''}`}</button>
              {session && <button type="button" onClick={() => setCreating(false)}>Cancel</button>}
            </div>
          </fieldset>
        </form>}
        {!creating && comparison && session && <>
          <header className="evals-comparison-heading"><div><strong>{session.title}</strong><span>{comparison.title}</span></div>
            <button type="button" disabled={position === 0} onClick={() => setPosition(position - 1)}>Previous</button>
            <span aria-live="polite">{position + 1} / {session.compares.length}</span>
            <button type="button" disabled={position === session.compares.length - 1} onClick={() => setPosition(position + 1)}>Next</button>
          </header>
          <ComparisonBoundary key={`${session.id}:${comparison.id}`}>
            <div className="evals-split" ref={splitRoot} style={{ gridTemplateColumns: `minmax(0, ${split}fr) 7px minmax(0, ${100 - split}fr)` }}>
              <CompareCanvasPane side="A" copy={session.canvases.find(copy => copy.id === comparison.A.canvasCopyId)!} camera={comparison.A.camera} />
              <div role="separator" aria-label="Resize comparison panes" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(split)}
                tabIndex={0} className="evals-divider" onDoubleClick={() => setSplit(50)}
                onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home') {
                  event.preventDefault(); setSplit(value => event.key === 'Home' ? 50 : Math.max(20, Math.min(80, value + (event.key === 'ArrowLeft' ? -2 : 2))));
                } }}
                onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
                onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                  const bounds = splitRoot.current!.getBoundingClientRect(); setSplit(Math.max(20, Math.min(80, (event.clientX - bounds.left) / bounds.width * 100)));
                }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
              <CompareCanvasPane side="B" copy={session.canvases.find(copy => copy.id === comparison.B.canvasCopyId)!} camera={comparison.B.camera} />
            </div>
          </ComparisonBoundary>
        </>}
        {!creating && !session && !loading && !error && <p className="evals-message">Select a session or create one to compare saved views.</p>}
      </section>
    </div>
  </main>;
}
