import { useEffect, useRef, useState } from 'react';
import type { LayoutCapture, LayoutGeometry, LayoutPlacement, LayoutTemplate } from '../../../../domain/core/diagrams/layoutTemplate';
import type { CompareCandidate, CompareSource } from '../../../../domain/mapping/compare/comparePageSession';
import { candidateKey, CanvasPicker, sourceOf } from './CanvasPicker';
import { listCompareCandidates } from './compareApi';
import { captureLayoutTemplate, deleteLayoutTemplate, listLayoutTemplates, renameLayoutTemplate, saveLayoutTemplate } from './evalsApi';
import { Drawer } from './Drawer';
import { errorMessage } from './evalsFormat';
import './evals.css';

export function LayoutPreview({ geometry, placements }: { geometry: LayoutGeometry; placements?: LayoutPlacement[] }) {
  const boxes = placements ? placements.map(item => ({ id: item.slotId, ...item.bounds, moved: item.moved }))
    : geometry.slots.map(slot => ({ id: slot.id, ...slot.position, ...slot.size, moved: false }));
  const width = Math.max(...boxes.map(box => box.column + box.columns)) * 8.4, height = Math.max(...boxes.map(box => box.row + box.rows)) * 18;
  return <figure className="layout-template-preview">
    <svg role="img" aria-label={placements ? 'Generated layout positions' : 'Empty layout template slots'} viewBox={`-8 -8 ${width + 16} ${height + 16}`}>
      {boxes.map((box, i) => <g key={box.id} data-layout-slot={box.id} data-moved={box.moved || undefined}>
        <rect x={box.column * 8.4} y={box.row * 18} width={box.columns * 8.4} height={box.rows * 18} />
        <text x={box.column * 8.4 + 3} y={box.row * 18 + 12} fontSize={10}>Slot {i + 1}</text>
        <title>{box.id}: column {box.column}, row {box.row}; {box.columns} × {box.rows}{box.moved ? ' · adjusted' : ''}</title>
      </g>)}
    </svg>
    <figcaption>{boxes.length} {boxes.length === 1 ? 'slot' : 'slots'} · {placements ? 'Final generated positions' : 'Visible diagrams only; original text and edges excluded'}</figcaption>
  </figure>;
}

export function LayoutProvenance({ template, placements }: { template: LayoutTemplate; placements?: LayoutPlacement[] }) {
  const moved = placements?.filter(p => p.moved).length;
  return <details className="output-details layout-provenance"><summary>Layout template: {template.name}{moved !== undefined ? ` · ${moved} ${moved === 1 ? 'slot' : 'slots'} adjusted` : ''}</summary>
    <p>Saved layout pinned for this run. Content can expand right/down while preserving slot order.</p>
    <div className="layout-provenance-previews"><LayoutPreview geometry={template.geometry} />
      {placements && <LayoutPreview geometry={template.geometry} placements={placements} />}</div>
    {placements && <>
      <table><thead><tr><th>Slot</th><th>Saved column, row</th><th>Final column, row</th></tr></thead><tbody>
        {placements.map(p => <tr key={p.slotId}><td>{p.slotId}</td><td>{p.requested.column}, {p.requested.row}</td><td>{p.bounds.column}, {p.bounds.row}{p.moved ? ' · adjusted' : ''}</td></tr>)}
      </tbody></table></>}
  </details>;
}

/** Preview is a geometry snapshot. Saving does not reread a source that may since have changed. */
export function SaveLayoutTemplate({ initial, source, onClose, onSaved }: {
  initial?: LayoutCapture; source?: CompareSource; onClose: () => void; onSaved?: (template: LayoutTemplate) => void;
}) {
  const [candidates, setCandidates] = useState<CompareCandidate[]>();
  const [picked, setPicked] = useState(source ? candidateKey(source) : '');
  const [capture, setCapture] = useState(initial), [name, setName] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef<{ signature: string; id: string }>(undefined);
  useEffect(() => { if (initial || source) return; let closed = false;
    void listCompareCandidates().then(items => { if (!closed) setCandidates(items); }).catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [initial, source]);
  useEffect(() => {
    if (initial) return;
    const selected = source ?? candidates?.find(item => candidateKey(item) === picked);
    setCapture(undefined); if (!selected) return;
    let closed = false; setError('');
    void captureLayoutTemplate(sourceOf(selected)).then(value => { if (!closed) setCapture(value); }).catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [initial, source, picked, candidates]);
  const save = async () => {
    if (!capture || !name.trim() || busy) return;
    const signature = JSON.stringify({ capture, name: name.trim() });
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { const value = await saveLayoutTemplate(capture, name.trim(), pending.current.id); onSaved?.(value); onClose(); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <Drawer title="Save layout as template" onClose={onClose}>
    <form className="evals-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      {!initial && !source && (candidates ? <CanvasPicker label="Source canvas or view" candidates={candidates} value={picked} onChange={setPicked} disabled={busy} /> : <p role="status">Loading canvases…</p>)}
      <label>Template name<input aria-label="Template name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
      {capture ? <LayoutPreview geometry={capture.geometry} /> : (source || picked) && !error ? <p role="status">Capturing layout…</p> : null}
      <p className="evals-muted">Only visible diagram positions and size guidance are captured. New diagrams may expand right/down to avoid overlap.</p>
      {error && <p className="evals-error" role="alert">{error}</p>}
      <div className="evals-actions"><button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || !capture || !name.trim()}>{busy ? 'Saving…' : 'Save template'}</button></div>
    </form>
  </Drawer>;
}

export function LayoutTemplates({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<LayoutTemplate[]>(), [error, setError] = useState(''), [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string>(), [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const refresh = () => listLayoutTemplates().then(setItems).catch(error => setError(errorMessage(error)));
  useEffect(() => { void refresh(); }, []);
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(''); try { await operation(); setEditing(undefined); await refresh(); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  if (creating) return <SaveLayoutTemplate onClose={() => setCreating(false)} onSaved={() => void refresh()} />;
  return <Drawer title="Layout templates" onClose={onClose}>
    <button type="button" onClick={() => setCreating(true)}>Save layout from canvas…</button>
    {error && <p role="alert" className="evals-error">{error}</p>}
    {!items ? <p role="status">Loading templates…</p> : !items.length ? <p>No layout templates yet.</p> : items.map(item => <section className="layout-template-card" key={item.id}>
      <h3>{item.name}</h3><LayoutPreview geometry={item.geometry} />
      {editing === item.id ? <form onSubmit={event => { event.preventDefault(); if (name.trim()) void mutate(() => renameLayoutTemplate(item.id, name.trim())); }}>
        <input aria-label="New template name" value={name} maxLength={120} onChange={event => setName(event.target.value)} />
        <button disabled={busy || !name.trim()}>Save name</button><button type="button" onClick={() => setEditing(undefined)}>Cancel</button>
      </form> : <div className="evals-actions"><button disabled={busy} onClick={() => { setEditing(item.id); setName(item.name); }}>Rename</button>
        <button disabled={busy} onClick={() => { if (confirm(`Delete layout template “${item.name}”? Pinned runs keep their copy.`)) void mutate(() => deleteLayoutTemplate(item.id)); }}>Delete template</button></div>}
    </section>)}
  </Drawer>;
}
