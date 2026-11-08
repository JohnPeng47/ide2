import { useEffect, useRef, useState } from 'react';
import type { OutputPromotion, PromotionReceipt } from '../../../../domain/mapping/evals/outputPromotion';
import { listPromotionTargets, promoteOutput } from './evalsApi';
import { errorMessage } from './evalsFormat';

export function PromoteOutput({ runId, cellKey, canvasId, diagramId, name, onClose }: {
  runId: string; cellKey: string; canvasId?: string; diagramId?: string; name: string; onClose: () => void;
}) {
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof listPromotionTargets>>>();
  const [destination, setDestination] = useState<OutputPromotion['destination']>(canvasId ? 'new-canvas' : 'new-project');
  const [title, setTitle] = useState(name.slice(0, 120)), [group, setGroup] = useState(''), [repository, setRepository] = useState(''), [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState<PromotionReceipt>();
  const attempt = useRef<{ signature: string; input: OutputPromotion } | undefined>(undefined);
  const locked = useRef(false);
  useEffect(() => { let closed = false; void listPromotionTargets().then(value => { if (!closed) { setTargets(value); if (value.repositories.length === 1) setRepository(value.repositories[0].id); } })
    .catch(error => { if (!closed) setError(errorMessage(error)); }); return () => { closed = true; }; }, []);
  const save = async () => {
    if (locked.current || !targets) return;
    locked.current = true; setBusy(true); setError('');
    const chosen = targets.canvases.find(c => c.id === target);
    const body = { cellKey, canvasId, diagramId, destination, name: title.trim(),
      ...(destination !== 'new-project' && group ? { canvasProjectId: group } : {}), ...(repository ? { repositoryId: repository } : {}),
      ...(destination === 'existing-canvas' ? { targetCanvasId: target, expectedRevisionId: chosen?.revisionId } : {}) };
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature) attempt.current = { signature, input: { ...body, requestId: crypto.randomUUID() } };
    try { setReceipt(await promoteOutput(runId, attempt.current.input)); }
    catch (error) { setError(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="output-promotion-backdrop"><section className="output-promotion-dialog" role="dialog" aria-modal="true" aria-label="Promote output"
    onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose(); }}>
    <h2>Promote {diagramId ? 'diagram' : canvasId ? 'canvas' : 'output set'}</h2>
    {receipt ? <><p role="status">Promoted {receipt.canvases.length} canvas{receipt.canvases.length === 1 ? '' : 'es'}.</p>
      <ul>{receipt.canvases.map(c => <li key={c.id}><a href={`${import.meta.env.BASE_URL}?diagram=${encodeURIComponent(c.id)}`} target="_blank" rel="noreferrer">Open {c.name} ↗</a></li>)}</ul>
      <button type="button" onClick={onClose}>Done</button></> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Connections between copied diagrams, source evidence and inter-canvas jumps are preserved. Linked canvases in this output are copied alongside the selection.</p>
      <label>Promote to<select autoFocus aria-label="Promotion destination" disabled={busy} value={destination} onChange={e => setDestination(e.target.value as OutputPromotion['destination'])}>
        <option value="new-project">New project</option><option value="new-canvas">New canvas{!canvasId ? ' set' : ''} in an existing project</option>
        {canvasId && <option value="existing-canvas">{diagramId ? 'Diagram' : 'Diagrams'} in an existing canvas</option>}
      </select></label>
      {destination === 'existing-canvas' ? <label>Destination canvas<select aria-label="Destination canvas" value={target} disabled={busy} onChange={e => setTarget(e.target.value)}>
        <option value="">Choose a canvas</option>{targets?.canvases.map(c => <option key={c.id} value={c.id}>{targets.groups.find(g => g.id === c.canvasProjectId)?.name ?? 'Project diagrams'} / {c.name}</option>)}
      </select></label> : <>
        <label>{destination === 'new-project' ? 'Project name' : 'Canvas name'}<input aria-label={destination === 'new-project' ? 'Project name' : 'Canvas name'} value={title} maxLength={120} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
        {destination === 'new-canvas' && <label>Project<select aria-label="Destination project" value={group} disabled={busy} onChange={e => setGroup(e.target.value)}>
          <option value="">Project diagrams</option>{targets?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select></label>}
      </>}
      {(targets?.repositories.length ?? 0) > 1 && <label>Source repository<select value={repository} aria-label="Source repository" disabled={busy} onChange={e => setRepository(e.target.value)}>
        <option value="">Keep source ownership</option>{targets?.repositories.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select></label>}
      {error && <p role="alert" className="evals-error">{error}</p>}
      <div><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !targets || !title.trim() || destination === 'existing-canvas' && !target}>{busy ? 'Promoting…' : 'Promote'}</button></div>
    </form>}
  </section></div>;
}
