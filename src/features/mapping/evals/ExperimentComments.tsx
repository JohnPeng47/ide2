import { useNavigationDraft } from './evalHistory';
import { useRef, useState } from 'react';
import type { AddExperimentComment, EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import { addExperimentComment, deleteExperimentComment, updateExperimentComment, updateExperimentCommentTags } from './evalsApi';
import { errorMessage } from './evalsFormat';

const parseTags = (value: string) => [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))];

function CommentTagsInput({ value, onChange, availableTags, disabled }: {
  value: string; onChange: (value: string) => void; availableTags: string[]; disabled: boolean;
}) {
  const selected = parseTags(value);
  return <div className="experiment-comment-tags-input">
    <label className="evals-field">Tags (comma-separated)
      <input value={value} onChange={event => onChange(event.target.value)} disabled={disabled} placeholder="e.g. follow-up, useful" />
    </label>
    {!!availableTags.length && <div className="experiment-comment-tag-suggestions" aria-label="Saved tags">
      {availableTags.map(tag => <button type="button" key={tag} aria-label={`Use tag ${tag}`} disabled={disabled || selected.includes(tag)} onClick={() => onChange([...selected, tag].join(', '))}>{tag}</button>)}
    </div>}
  </div>;
}

export function ExperimentCommentActions({ experimentId, commentId, text, tags, availableTags, onSaved, onChanged }: {
  experimentId: string; commentId: string; text: string; tags: string[]; availableTags: string[];
  onSaved: (experiment: EvalExperiment) => void; onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<'text' | 'tags'>();
  const [textDraft, setTextDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useNavigationDraft(editing === 'text' && textDraft !== text || editing === 'tags' && draft !== tags.join(', '),
    next => next.kind !== 'experiment' || next.id !== experimentId || (next.view ?? 'overview') !== 'overview');
  const mutate = async (remove: boolean) => {
    if (busy || (!remove && editing === 'text' && !textDraft.trim())) return;
    setBusy(true); setError('');
    try {
      const updated = remove ? await deleteExperimentComment(experimentId, commentId)
        : editing === 'text' ? await updateExperimentComment(experimentId, commentId, { text: textDraft.trim() })
        : await updateExperimentCommentTags(experimentId, commentId, parseTags(draft));
      onSaved(updated); setEditing(undefined);
      try { await onChanged(); }
      catch (error) { setError(`Comment saved, but the experiment could not refresh: ${errorMessage(error)}`); }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <>
    {tags.map(tag => <span className="experiment-comment-tag" key={tag}>{tag}</span>)}
    <button type="button" className="evals-link experiment-ascii-action" disabled={busy} aria-label="Edit comment" onClick={() => { setTextDraft(text); setEditing('text'); setError(''); }}>[Edit]</button>
    <button type="button" className="evals-link experiment-ascii-action" disabled={busy} aria-label="Edit comment tags" onClick={() => { setDraft(tags.join(', ')); setEditing(editing === 'tags' ? undefined : 'tags'); setError(''); }}>[Tags]</button>
    <button type="button" className="evals-link experiment-ascii-action" disabled={busy} aria-label="Delete comment" onClick={() => void mutate(true)}>[Delete]</button>
    {editing === 'text' && <form className="experiment-comment-text-editor" onSubmit={event => { event.preventDefault(); void mutate(false); }}>
      <label className="evals-field">Comment
        <textarea autoFocus value={textDraft} onChange={event => setTextDraft(event.target.value)} rows={3} maxLength={10000} disabled={busy} />
      </label>
      <div><button type="submit" disabled={busy || !textDraft.trim()}>{busy ? 'Saving…' : 'Save comment'}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing(undefined); setError(''); }}>Cancel</button></div>
    </form>}
    {editing === 'tags' && <form className="experiment-comment-tag-editor" onSubmit={event => { event.preventDefault(); void mutate(false); }}>
      <CommentTagsInput value={draft} onChange={setDraft} availableTags={availableTags} disabled={busy} />
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save tags'}</button>
      <button type="button" disabled={busy} onClick={() => { setEditing(undefined); setError(''); }}>Cancel</button>
    </form>}
    {error && <p role="alert" className="evals-error">{error}</p>}
  </>;
}

type ComposerProps = {
  experimentId: string; availableTags: string[];
  onChanged: () => Promise<unknown>; onSaved: (experiment: EvalExperiment) => void;
};

function CommentForm({ experimentId, onChanged, onSaved, availableTags, phaseId, onClose }: ComposerProps & {
  phaseId?: string; onClose?: () => void;
}) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useNavigationDraft(!!text || !!tags, next => next.kind !== 'experiment' || next.id !== experimentId || !!phaseId && (next.view ?? 'overview') !== 'overview');
  const pending = useRef<AddExperimentComment | undefined>(undefined);
  const submit = async () => {
    if (busy || !text.trim()) return;
    const parsedTags = parseTags(tags);
    if (pending.current?.text !== text.trim() || JSON.stringify(pending.current?.tags) !== JSON.stringify(parsedTags)) pending.current = { requestId: crypto.randomUUID(), text: text.trim(), tags: parsedTags, phaseId };
    setBusy(true); setError('');
    try {
      const updated = await addExperimentComment(experimentId, pending.current);
      onSaved(updated); setText(''); setTags(''); pending.current = undefined;
      try { await onChanged(); onClose?.(); }
      catch (error) { setError(`Comment saved, but the experiment could not refresh: ${errorMessage(error)}`); }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <form onSubmit={event => { event.preventDefault(); void submit(); }}
    onKeyDown={event => { if (onClose && event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); } }}>
    <label className="evals-field">{phaseId ? 'Phase comment' : 'Your comment'}
      <textarea autoFocus={!!phaseId} value={text} onChange={event => setText(event.target.value)} rows={3} maxLength={10000} disabled={busy}
        placeholder={phaseId ? 'Add a note about this phase…' : 'Add a note about this experiment…'} />
    </label>
    <CommentTagsInput value={tags} onChange={setTags} availableTags={availableTags} disabled={busy} />
    <div className="evals-actions"><button type="submit" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Add comment'}</button>
      {onClose && <button type="button" disabled={busy} onClick={onClose}>Cancel</button>}</div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function PhaseCommentAction({ phaseId, phaseName, onOpen, ...props }: ComposerProps & {
  phaseId: string; phaseName: string; onOpen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => { setEditing(false); button.current?.focus(); };
  return <>
    <button ref={button} type="button" className="evals-link experiment-ascii-action experiment-hover-action"
      aria-label={`Add comment to ${phaseName}`} aria-expanded={editing}
      onClick={() => { onOpen(); setEditing(true); }}>[comment]</button>
    {editing && <div className="experiment-comments experiment-phase-comment-form">
      <CommentForm {...props} phaseId={phaseId} onClose={close} />
    </div>}
  </>;
}

export function ExperimentComments({ experiment, ...props }: Omit<ComposerProps, 'experimentId'> & { experiment: EvalExperiment }) {
  return <section className="experiment-comments" aria-label="User comments">
    <CommentForm key={experiment.id} {...props} experimentId={experiment.id} />
  </section>;
}
