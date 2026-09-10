import { EffectPaneHeader } from "./DisplayPane";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  isLocalChatSubmitHotkey,
  type LocalChatThread,
  type LocalChatVariant
} from "../localChat";

export function LocalChatConvo(props: {
  thread: LocalChatThread;
  displayNodeId?: string;
  style?: CSSProperties;
  onMeasure?: (id: string, width: number, height: number) => void;
  variant: LocalChatVariant;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  onSubmit: (message: string) => void;
  onClose: () => void;
}) {
  const paneRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = paneRef.current; if (!el || !props.onMeasure || !props.displayNodeId) return;
    const report = () => props.onMeasure!(props.displayNodeId!, el.offsetWidth, el.offsetHeight);
    report(); const observer = new ResizeObserver(report); observer.observe(el);
    return () => observer.disconnect();
  }, [props.displayNodeId, props.onMeasure]);
  const [localDraft, setLocalDraft] = useState("");
  const draft = props.draft ?? localDraft;
  const setDraft = props.onDraftChange ?? setLocalDraft;
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [props.thread.messages, props.thread.pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || props.thread.pending) return;
    props.onSubmit(message);
    setDraft("");
  };

  return (
    <section ref={paneRef} style={props.style} data-display-node={props.displayNodeId}
      className={`local-chat-convo is-${props.variant}`}
      data-local-chat-convo={props.variant}
      aria-label={`Local conversation about ${props.thread.title}`}
    >
      <EffectPaneHeader title={props.thread.title} eyebrow="LOCAL CHAT" actions={
        <button type="button" aria-label="Collapse local conversation" onClick={props.onClose}>×</button>
      } />

      <div ref={transcriptRef} className="local-chat-transcript" role="log" aria-live="polite">
        {props.thread.messages.map((message) => (
          <article key={message.id} className={`is-${message.role}`} data-local-chat-role={message.role}>
            <span>{message.role === "user" ? "YOU" : "AI"}</span>
            <p>{message.text}</p>
          </article>
        ))}
        {props.thread.pending ? (
          <article className="is-assistant is-pending" data-local-chat-pending="true">
            <span>AI</span>
            <p>thinking<span aria-hidden="true">…</span></p>
          </article>
        ) : null}
      </div>

      <form onSubmit={submit}>
        <label>
          <span>Follow up</span>
          <textarea
            value={draft}
            rows={2}
            maxLength={4000}
            disabled={props.thread.pending}
            placeholder="Ask about this region…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (!isLocalChatSubmitHotkey({
                key: event.key,
                ctrlKey: event.ctrlKey,
                isComposing: event.nativeEvent.isComposing
              })) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
        </label>
        <button type="submit" disabled={!draft.trim() || props.thread.pending} title="Send (Ctrl+Enter)">
          {props.thread.pending ? "waiting…" : "send"}
        </button>
      </form>
    </section>
  );
}
