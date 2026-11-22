import { useNavigationDraft } from './evalHistory';
import { useRef, useState } from 'react';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import { renameExperiment } from './evalsApi';
import { errorMessage } from './evalsFormat';

export function ExperimentRename({ experiment, onSaved, onChanged }: {
  experiment: EvalExperiment; onSaved: (updated: EvalExperiment) => void; onChanged: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string>();
  useNavigationDraft(draft !== undefined && draft !== experiment.name, next => next.kind !== 'experiment' || next.id !== experiment.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef<number | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setDraft(undefined);
    setError('');
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async () => {
    const name = draft?.trim();
    if (busy || !name) return;
    if (name === experiment.name) { close(); return; }
    setBusy(true);
    setError('');
    try {
      onSaved(await renameExperiment(experiment.id, { name, expectedRevision: revision.current ?? experiment.revision }));
      close();
    } catch (error) {
      setError(errorMessage(error));
      await onChanged().catch(() => {});
      revision.current = undefined;
    } finally { setBusy(false); }
  };

  if (draft === undefined) return <button ref={trigger} type="button" aria-label="Rename experiment"
    onClick={() => { revision.current = experiment.revision; setDraft(experiment.name); }}>Rename</button>;
  return <form className="experiment-rename" aria-label="Rename experiment" onSubmit={event => { event.preventDefault(); void save(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); } }}>
    <input aria-label="Experiment name" value={draft} maxLength={160} autoFocus onFocus={event => event.target.select()}
      onChange={event => setDraft(event.target.value)} disabled={busy} />
    <button type="submit" disabled={busy || !draft.trim()}>Save</button>
    <button type="button" onClick={close} disabled={busy}>Cancel</button>
    {error && <span role="alert" className="evals-error">{error}</span>}
  </form>;
}
