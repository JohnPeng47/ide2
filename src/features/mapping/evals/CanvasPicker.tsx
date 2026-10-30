import type { CompareCandidate, CompareSource } from '../../../../domain/mapping/compare/comparePageSession';
import { provenance } from './evalsFormat';

export const candidateKey = ({ documentId, viewId, checkpointId }: CompareSource) => JSON.stringify([documentId, viewId ?? '', checkpointId]);
export const sourceOf = ({ documentId, viewId, checkpointId }: CompareSource): CompareSource => ({ documentId, ...(viewId ? { viewId } : {}), checkpointId });
export const candidateLabel = (candidate: CompareCandidate) => candidate.generated ? candidate.name : `${candidate.canvasName} — ${candidate.name}`;

/** Saved canvases and views first, then generated canvases grouped by their run context. */
export function CanvasPicker({ label, candidates, value, onChange, disabled, exclude }: {
  label: string; candidates: CompareCandidate[]; value?: string; onChange: (key: string) => void; disabled?: boolean; exclude?: string;
}) {
  const saved = candidates.filter(candidate => !candidate.generated), generated = candidates.filter(candidate => candidate.generated);
  const groups = [...new Set(saved.map(candidate => candidate.canvasName))].map(name => [name, saved.filter(candidate => candidate.canvasName === name)] as const);
  const contexts = [...new Set(generated.map(candidate => candidate.generated!.agentContextId))]
    .map(id => [`Generated · ${generated.find(candidate => candidate.generated!.agentContextId === id)!.generated!.contextName}`, generated.filter(candidate => candidate.generated!.agentContextId === id)] as const);
  const selected = candidates.find(candidate => candidateKey(candidate) === value);
  return <label className="canvas-picker">{label}
    <select aria-label={label} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">Choose a canvas…</option>
      {[...groups, ...contexts].map(([group, items]) => <optgroup key={items[0].generated?.agentContextId ?? items[0].documentId} label={group}>
        {items.map(candidate => <option key={candidateKey(candidate)} value={candidateKey(candidate)} disabled={candidateKey(candidate) === exclude}>
          {candidateLabel(candidate)}</option>)}
      </optgroup>)}
    </select>
    {selected && <small>{selected.diagrams.length} diagram{selected.diagrams.length === 1 ? '' : 's'}{selected.generated ? ` · ${provenance(selected.generated)}` : selected.viewId ? ' · saved view' : ' · current saved canvas'}</small>}
  </label>;
}
