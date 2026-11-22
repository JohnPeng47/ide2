import { useNavigationDraft } from './evalHistory';
import { useId, useRef, useState } from 'react';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import { updateExperimentTags } from './evalsApi';
import { errorMessage } from './evalsFormat';

export function ExperimentTags({ experiment, availableTags, onSaved, onChanged }: {
  experiment: EvalExperiment; availableTags: string[];
  onSaved: (experiment: EvalExperiment) => void; onChanged: () => Promise<unknown>;
}) {
  const suggestionsId = useId();
  const [draft, setDraft] = useState('');
  useNavigationDraft(!!draft, next => next.kind !== 'experiment' || next.id !== experiment.id);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const tags = experiment.tags ?? [];
  const tag = draft.trim();
  const save = async (next: string[], added = false) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const updated = await updateExperimentTags(experiment.id, { expectedRevision: experiment.revision, tags: next });
      onSaved(updated);
      if (added) setDraft('');
      try { await onChanged(); }
      catch (error) { setError(`Tags saved, but the experiment could not refresh: ${errorMessage(error)}`); }
    } catch (error) {
      setError(errorMessage(error));
      // Refresh a stale revision while retaining the user's unsaved tag for retry.
      await onChanged().catch(() => {});
    } finally { pending.current = false; setBusy(false); }
  };
  return <section className="experiment-tags" aria-label="Experiment tags" aria-busy={busy}>
    <div className="experiment-tags-row">
      <span className="evals-muted">Tags</span>
      {tags.map(tag => <span className="experiment-tag" key={tag}>{tag}
        <button type="button" disabled={busy} aria-label={`Remove experiment tag ${tag}`} onClick={() => void save(tags.filter(value => value !== tag))}>×</button>
      </span>)}
      {!tags.length && <span className="evals-muted">No tags</span>}
    </div>
    <form onSubmit={event => { event.preventDefault(); if (tag && !tags.includes(tag) && tags.length < 20) void save([...tags, tag], true); }}>
      <input aria-label="New experiment tag" list={suggestionsId} value={draft} maxLength={50} disabled={busy || tags.length >= 20}
        placeholder="Create or choose a tag" onChange={event => setDraft(event.target.value)} />
      <datalist id={suggestionsId}>{[...new Set(availableTags)].filter(value => !tags.includes(value)).sort().map(value => <option key={value} value={value} />)}</datalist>
      <button type="submit" disabled={busy || !tag || tags.includes(tag) || tags.length >= 20}>Add tag</button>
    </form>
    {tags.length >= 20 && <span className="evals-muted">20-tag limit reached.</span>}
    {error && <p role="alert" className="evals-error">{error}</p>}
  </section>;
}
