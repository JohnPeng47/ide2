import { useEffect, useRef, useState } from 'react';
import type { CompareCandidate, ComparePageSession, CreateCompareSession } from '../../../../domain/mapping/compare/comparePageSession';
import { createCompareSession, listCompareCandidates } from './compareApi';
import { errorMessage } from './evalsFormat';
import { CanvasPicker, candidateKey, candidateLabel, sourceOf } from './CanvasPicker';
import { Drawer } from './Drawer';

type Pair = CreateCompareSession['pairs'][number];
/** Hand-picked pairs of any saved or generated canvases. Run outputs can also be compared from their grid. */
export function CompareLauncher({ onClose, onCreated }: { onClose: () => void; onCreated: (session: ComparePageSession) => void }) {
  const [candidates, setCandidates] = useState<CompareCandidate[]>();
  const [title, setTitle] = useState('Diagram comparison'), [presentation, setPresentation] = useState<'canvas' | 'diagram'>('canvas');
  const [views, setViews] = useState({ A: '', B: '' }), [diagrams, setDiagrams] = useState({ A: '', B: '' });
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{ key: string; requestId: string }>(undefined);
  const load = () => listCompareCandidates().then(items => { setCandidates(items); setError(''); }).catch(error => setError(errorMessage(error)));
  useEffect(() => { void load(); }, []);
  const candidateFor = (side: 'A' | 'B') => candidates?.find(candidate => candidateKey(candidate) === views[side]);
  const targetFor = (side: 'A' | 'B') => candidateFor(side)?.diagrams.find(item => item.diagramId === diagrams[side]) ?? candidateFor(side)?.diagrams[0];
  const paneSource = (side: 'A' | 'B') => {
    const candidate = candidateFor(side), target = targetFor(side);
    if (!candidate || presentation === 'diagram' && !target) return;
    return { ...sourceOf(candidate), ...(presentation === 'diagram' && target ? { diagram: { diagramId: target.diagramId, revisionId: target.revisionId } } : {}) };
  };
  const sourceA = paneSource('A'), sourceB = paneSource('B'), pair = sourceA && sourceB ? { A: sourceA, B: sourceB } : undefined;
  const name = (value: Pair['A']) => {
    const candidate = candidates?.find(candidate => candidateKey(candidate) === candidateKey(value));
    return `${candidate ? candidateLabel(candidate) : 'Canvas'}${value.diagram ? ` — ${candidate?.diagrams.find(item => item.diagramId === value.diagram!.diagramId)?.name ?? 'Diagram'}` : ''}`;
  };
  const create = async () => {
    const selected = pairs.length ? pairs : pair ? [pair] : [];
    if (!selected.length || !title.trim()) return;
    const input = { title: title.trim(), pairs: selected }, key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    setBusy(true); setError('');
    try { const saved = await createCompareSession({ requestId: pending.current.requestId, ...input }); pending.current = undefined; onCreated(saved); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <Drawer title="New comparison" onClose={onClose}>
    <form className="evals-form" onSubmit={event => { event.preventDefault(); void create(); }}>
      <p className="evals-muted">Pair any saved views or generated canvases. The session keeps its own copies, so later edits never change it.</p>
      <fieldset disabled={busy}>
        <label>Session name<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div role="radiogroup" aria-label="Presentation" className="evals-segmented">
          {(['canvas', 'diagram'] as const).map(value => <label key={value}><input type="radio" name="presentation" checked={presentation === value}
            onChange={() => setPresentation(value)} />{value === 'canvas' ? 'Canvases' : 'Diagrams'}</label>)}
        </div>
        {!candidates && !error && <p role="status" className="evals-muted">Loading canvases…</p>}
        {candidates && (['A', 'B'] as const).map(side => <div key={side} className="compare-launch-side">
          <CanvasPicker label={`View ${side}`} candidates={candidates} value={views[side]} onChange={value => setViews(previous => ({ ...previous, [side]: value }))} />
          {presentation === 'diagram' && <label>Diagram {side}<select aria-label={`Diagram ${side}`} value={targetFor(side)?.diagramId ?? ''}
            onChange={event => setDiagrams(previous => ({ ...previous, [side]: event.target.value }))}>
            {!candidateFor(side)?.diagrams.length && <option value="">No diagrams in this view</option>}
            {candidateFor(side)?.diagrams.map(target => <option key={target.diagramId} value={target.diagramId}>{target.name}</option>)}
          </select></label>}
        </div>)}
        {candidates && !candidates.length && <p>Save a canvas or view in Mapping, or start a run, then refresh this list.</p>}
        {presentation === 'canvas' && pair && views.A === views.B && <p className="evals-muted">Both panes show this canvas, with up to three diagram focuses in reading order.</p>}
        {pairs.length > 0 && <ol className="evals-pair-list">{pairs.map((item, index) => <li key={index}>
          <span>{name(item.A)} / {name(item.B)}</span><button type="button" aria-label={`Remove pair ${index + 1}`} onClick={() => setPairs(pairs.filter((_, i) => i !== index))}>Remove</button>
        </li>)}</ol>}
      </fieldset>
      <footer className="evals-drawer-footer">
        {error && <p role="alert" className="evals-error">{error}</p>}
        <div className="evals-actions">
          <button type="button" disabled={busy} onClick={() => void load()}>Refresh views</button>
          <button type="button" disabled={busy || !pair || pairs.length >= 40} onClick={() => { if (pair) setPairs([...pairs, pair]); }}>Add pair to session</button>
          <button type="submit" className="is-primary" disabled={busy || !title.trim() || !pairs.length && !pair}>{busy ? 'Saving…' : `Create session${pairs.length ? ` (${pairs.length} pairs)` : ''}`}</button>
        </div>
      </footer>
    </form>
  </Drawer>;
}
