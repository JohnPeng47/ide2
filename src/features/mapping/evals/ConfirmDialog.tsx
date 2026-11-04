import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './evalsFormat';

export interface Confirmation {
  title: string; message: string; confirmLabel?: string; pendingLabel?: string;
  onConfirm: () => void | Promise<void>;
}

/** Native dialog provides focus containment and an inert backdrop, styled as part of Evals. */
export function ConfirmDialog({ title, message, confirmLabel = 'Delete', pendingLabel = 'Deleting…', onConfirm, onClose }: Confirmation & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), locked = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  const submit = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await onConfirm(); onClose(); }
    catch (error) { setError(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="evals-confirm" aria-label={title} aria-describedby="evals-confirm-message" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!locked.current) onClose(); }}>
    <h2>{title}</h2><p id="evals-confirm-message">{message}</p>
    {error && <p role="alert" className="evals-error">{error}</p>}
    {busy && <p role="status" className="evals-muted">{pendingLabel}</p>}
    <div className="evals-actions">
      <button type="button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="is-danger" disabled={busy} onClick={() => void submit()}>{busy ? pendingLabel : confirmLabel}</button>
    </div>
  </dialog>;
}
