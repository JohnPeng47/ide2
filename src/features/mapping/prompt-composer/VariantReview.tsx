import { useState } from 'react';
import type { DiagramVariant, VariantDecision, VariantChange } from '../../../../domain/core/diagrams/diagramVariant';
import type { PromptComposerCoordinator, PromptComposerTarget } from './promptComposerCoordinator';
export interface VariantReviewSource {
  list(target: PromptComposerTarget): { variant: DiagramVariant; changes: VariantChange[]; ascii: string; scopeLabel: string; error?: string }[];
  update(target: PromptComposerTarget, id: string, change: { decisions?: Record<string, VariantDecision>; name?: string; remove?: boolean; apply?: boolean }): Promise<void>;
}
export function VariantReview({ source, target, coordinator, entryKey, locked }: {
  source: VariantReviewSource; target: PromptComposerTarget; coordinator: PromptComposerCoordinator; entryKey: string; locked: boolean;
}) {
  const list = source.list(target), [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const item = list.find(item => item.variant.id === selected) ?? list.at(-1);
  if (!item) return null;
  const { variant, changes } = item;
  const update = async (change: Parameters<VariantReviewSource['update']>[2]) => {
    setBusy(true); setError('');
    try { await source.update(target, variant.id, change); } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
  };
  const disabled = busy || locked;
  return <section className="variant-review" aria-label="Variant review">
    <h3>Variants</h3>
    <label>Review variant <select aria-label="Review variant" value={variant.id} disabled={disabled} onChange={e => { setSelected(e.target.value); setError(''); }}>
      {list.map(({ variant }) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
    </select></label>
    <label>Name <input aria-label="Rename variant" key={variant.id + variant.name} defaultValue={variant.name} maxLength={120} disabled={disabled}
      onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== variant.name) void update({ name: e.target.value }); }} /></label>
    <p>{variant.replacementScope ? variant.replacementScope.mode === 'multi-contiguous' ? 'Adjacent subtrees' : 'Separate subtrees' : variant.ownerNodeId === 'root' ? 'Whole diagram' : `Subtree: ${item.scopeLabel}`} · {variant.revisionIds.length} generated revision(s)</p>
    <details><summary>Generated candidate</summary><pre>{item.ascii}</pre></details>
    <div className="variant-review-actions">
      <button disabled={disabled} onClick={() => void update({ decisions: Object.fromEntries(changes.map(c => [c.id, 'accept'])) })}>Accept all</button>
      <button disabled={disabled} onClick={() => void update({ decisions: Object.fromEntries(changes.map(c => [c.id, 'reject'])) })}>Reject all</button>
      <button disabled={disabled} onClick={() => coordinator.setTarget(entryKey, { operation: 'edit-diagram', generateVariants: true, replaceMode: variant.replacementScope?.mode ?? (variant.ownerNodeId === 'root' ? 'diagram' : 'subnode-single'), variantId: variant.id, variantName: variant.name, variantCount: 1 })}>Refine this variant</button>
    </div>
    <ul>{changes.map(change => <li key={change.id} data-variant-change={change.id}>
      <strong>{change.label}</strong> <small>{change.kind}</small>
      {change.before && change.after && change.before.label !== change.after.label && <div><del>{change.before.label}</del> → {change.after.label}</div>}
      {change.before && change.after && (change.before.parentId !== change.after.parentId || JSON.stringify(change.before.childIds) !== JSON.stringify(change.after.childIds)) && <small>Parent or child order changed; related structural changes must agree.</small>}
      <div><span>{variant.decisions[change.id] ?? 'Pending'}</span>
        <button aria-label={`Accept ${change.label}`} disabled={disabled} aria-pressed={variant.decisions[change.id] === 'accept'} onClick={() => void update({ decisions: { [change.id]: 'accept' } })}>Accept</button>
        <button aria-label={`Reject ${change.label}`} disabled={disabled} aria-pressed={variant.decisions[change.id] === 'reject'} onClick={() => void update({ decisions: { [change.id]: 'reject' } })}>Reject</button>
      </div>
    </li>)}</ul>
    {!changes.length && <p>No content changes in this variant.</p>}
    {item.error && <p role="alert">{item.error}</p>}
    {error && <p role="alert">{error}</p>}
    <p>Pending and rejected changes keep the base content. After applying, change decisions and apply again to roll back selected updates.</p>
    <button className="prompt-primary" disabled={disabled || !!item.error || !changes.length} onClick={() => void update({ apply: true })}>Apply reviewed changes</button>
    <button disabled={disabled} onClick={() => void update({ remove: true })}>Remove variant</button>
  </section>;
}
