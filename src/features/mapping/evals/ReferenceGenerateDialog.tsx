import { useEffect, useRef, useState } from 'react';
import type { ChatEvent, ChatSession } from '../../../../domain/mapping/agent-chat/agentChat';
import type { CompareSource } from '../../../../domain/mapping/compare/comparePageSession';
import { MAX_GENERATED_SNIPPETS, referenceGenerationRounds, referenceSourcesStatus, type ReferenceGenerationRound, type ReferenceGenerationSession } from '../../../../domain/mapping/evals/referenceGeneration';
import { chatRequest } from '../agent-chat/agentChatClient';
import { ChatStream } from '../agent-chat/chatStream';
import { errorMessage } from './evalsFormat';
import { generateReferences, loadReferenceSources, openReferenceSession } from './evalsApi';

/** The diagram's shared generation conversation, live from the chat stream. Reopening it shows earlier rounds. */
function useGenerationChat(target: { source: CompareSource; boxId: string; revisionId: string }) {
  const [opened, setOpened] = useState<ReferenceGenerationSession>(), [chat, setChat] = useState<ChatSession>(), [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    openReferenceSession(target).then(value => { if (!closed) setOpened(value); }).catch(error => { if (!closed) setError(errorMessage(error)); });
    return () => { closed = true; };
  }, [target.revisionId]);
  useEffect(() => {
    if (!opened) return;
    const stream = new ChatStream(setChat); stream.setVisible(true);
    const events = new EventSource(`/api/mapping/agent-chat/sessions/${opened.chatId}/events`);
    events.onmessage = message => stream.receive(JSON.parse(message.data) as ChatEvent);
    return () => { events.close(); stream.dispose(); };
  }, [opened?.chatId]);
  return { opened, chat, error };
}

function RoundBody({ round, isCaptured, onCapture }: { round: ReferenceGenerationRound; isCaptured: (ascii: string) => boolean; onCapture: (ascii: string) => void }) {
  return <>
    {round.snippets.length > 0 && <ol aria-label="Generated snippets">{round.snippets.map((snippet, index) => <li key={index} className="reference-snippet">
      <pre className="reference-ascii" aria-label={`Generated snippet ${index + 1}`}>{snippet}</pre>
      <button type="button" disabled={isCaptured(snippet)} onClick={() => onCapture(snippet)}>{isCaptured(snippet) ? 'Added to captures' : 'Add to captures'}</button>
    </li>)}</ol>}
    {round.partial && <pre className="reference-ascii" aria-label="Snippet being written">{round.partial}</pre>}
    {round.running && <p role="status" className="evals-muted">{round.snippets.length ? `${round.snippets.length} written, generating…` : 'Generating…'}</p>}
    {!round.running && !round.snippets.length && (round.reply ? <><p className="evals-muted">No snippets in this reply:</p><p className="reference-round-prompt">{round.reply}</p></> : <p className="evals-muted">No reply.</p>)}
    <details className="reference-round-sent"><summary>Message sent</summary><pre>{round.message}</pre></details>
  </>;
}

const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
/** Whether the agent has read the diagram's source files, as confirmed in its own reply. */
function SourcesStatus({ session, chat, sending, onLoad }: { session?: ReferenceGenerationSession; chat?: ChatSession; sending: boolean; onLoad: () => void }) {
  if (!session || !chat) return null;
  const files = session.sources.files.length, status = referenceSourcesStatus(chat);
  if (!files) return <p className="reference-sources" data-state="none" role="status">No source files are mapped to this diagram.</p>;
  const loading = sending || status.state === 'loading';
  const label = status.state === 'loaded' ? `Sources loaded: the agent confirmed reading ${countOf(files, 'file')}.`
    : loading ? `Loading ${countOf(files, 'source file')}…${status.reads ? ` ${countOf(status.reads, 'command')} run.` : ''}`
    : status.state === 'unconfirmed' ? 'Sources not loaded: the agent finished without confirming it read them.'
    : status.compacted ? 'Sources no longer held: this conversation was compacted. Load them again to use them.'
    : `Sources not loaded: ${countOf(files, 'file')} mapped to this diagram.`;
  return <div className="reference-sources" data-state={loading ? 'loading' : status.state}>
    <div className="reference-sources-row">
      <span role="status">{label}</span>
      {status.state !== 'loaded' && <button type="button" disabled={loading || chat.status === 'running'} onClick={onLoad}>{loading ? 'Loading…' : status.state === 'unconfirmed' ? 'Retry Load Sources' : 'Load Sources'}</button>}
    </div>
    {status.message && <details className="reference-round-sent"><summary>Details</summary>{status.reply && <p>{status.reply}</p>}<pre>{status.message}</pre></details>}
  </div>;
}

/** Prompt for more snippets like a selection, and collect what comes back. */
export function ReferenceGenerateDialog({ excerpt, session: target, isCaptured, onCapture, onClose }: {
  excerpt: string; session: { source: CompareSource; boxId: string; revisionId: string };
  isCaptured: (ascii: string) => boolean; onCapture: (ascii: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), requestId = useRef<string>(undefined), sourcesRequestId = useRef<string>(undefined);
  const { opened, chat, error: openError } = useGenerationChat(target);
  const [prompt, setPrompt] = useState(''), [count, setCount] = useState(3), [sending, setSending] = useState(false), [loadingSources, setLoadingSources] = useState(false), [error, setError] = useState('');
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, element = dialog.current!;
    element.showModal();
    // Ahead of the canvas behind the dialog, whose own Escape would otherwise clear the selection and keep this open.
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); element.close(); previous?.focus?.(); };
  }, []);
  const rounds = chat ? referenceGenerationRounds(chat).reverse() : [];
  const running = chat?.status === 'running';
  const ready = !!opened && !!chat && !sending && !loadingSources && !running && !!prompt.trim();
  const submit = async () => {
    if (!ready) return;
    setSending(true); setError('');
    // One attempt keeps its ID across a lost response, so retrying cannot run the turn twice.
    requestId.current ??= crypto.randomUUID();
    try { await generateReferences(opened!.id, { requestId: requestId.current, excerpt, prompt, count }); requestId.current = undefined; }
    catch (error) { setError(errorMessage(error)); }
    finally { setSending(false); }
  };
  const loadSources = async () => {
    if (!opened || sending || loadingSources || running) return;
    setLoadingSources(true); setError('');
    // Kept across a lost response, for the same reason as above.
    sourcesRequestId.current ??= crypto.randomUUID();
    try { await loadReferenceSources(opened.id, { requestId: sourcesRequestId.current }); sourcesRequestId.current = undefined; }
    catch (error) { setError(errorMessage(error)); }
    finally { setLoadingSources(false); }
  };
  const stop = () => chat && chatRequest(`/sessions/${chat.id}/interrupt`, {}).catch(error => setError(errorMessage(error)));
  const failure = openError || error || chat?.error;
  return <dialog ref={dialog} className="evals-confirm reference-generate" aria-label="Generate references" onCancel={event => event.preventDefault()}>
    <header><h2>Generate references</h2><button type="button" aria-label="Close" onClick={onClose}>×</button></header>
    <div className="reference-generate-body">
      <SourcesStatus session={opened} chat={chat} sending={loadingSources} onLoad={() => void loadSources()} />
      <details className="reference-generate-source"><summary>Selection · {excerpt.split('\n').length} line{excerpt.includes('\n') ? 's' : ''}</summary><pre className="reference-ascii" aria-label="Excerpt to generate from">{excerpt}</pre></details>
      <form className="reference-generate-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <textarea autoFocus aria-label="Generation prompt" rows={3} maxLength={20_000} placeholder="What should the new snippets show, and how should they differ?" value={prompt} onChange={event => setPrompt(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }} />
        <div className="evals-actions">
          <label>Snippets<input type="number" min={1} max={MAX_GENERATED_SNIPPETS} value={count} onChange={event => setCount(Math.max(1, Math.min(MAX_GENERATED_SNIPPETS, Number(event.target.value) || 1)))} /></label>
          {running && <button type="button" onClick={() => void stop()}>Stop</button>}
          <button type="submit" className="is-primary" disabled={!ready}>{!opened || !chat ? 'Preparing…' : 'Generate'}</button>
        </div>
      </form>
      {failure && <p role="alert" className="evals-error">{failure}</p>}
      {rounds.map((round, index) => index === 0
        ? <section key={round.id} className="reference-round" aria-label="Latest generation"><p className="reference-round-prompt">{round.prompt ?? 'Generation'}</p><RoundBody round={round} isCaptured={isCaptured} onCapture={onCapture} /></section>
        : <details key={round.id} className="reference-round"><summary>{round.prompt ?? 'Generation'} · {round.snippets.length} snippet{round.snippets.length === 1 ? '' : 's'}</summary><RoundBody round={round} isCaptured={isCaptured} onCapture={onCapture} /></details>)}
    </div>
  </dialog>;
}
