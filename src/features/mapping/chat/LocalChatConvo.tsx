import { EffectPaneHeader } from "../canvas/DisplayPane";
import { LocalChatVerbosityToggle } from "./LocalChatVerbosityToggle";
import { TerminalMarkdownContent } from "../../../shared/markdown/TerminalMarkdownContent";
import {
  useEffect,
  useLayoutEffect,
  type CSSProperties,
  useCallback,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  isLocalChatSubmitHotkey,
  type LocalChatThread,
  type LocalChatVerbosity,
  type LocalChatVariant
} from "../../../../domain/mapping/chat/localChat";

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
  onVerbosityChange: (value: LocalChatVerbosity) => void;
  onRetry: () => void;
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
  const scrollToLatest = useCallback(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [props.thread.messages, props.thread.pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || props.thread.pending || !props.thread.context) return;
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
            {message.role === "assistant"
              ? <TerminalMarkdownContent source={message.text} className="local-chat-markdown" onRendered={scrollToLatest} />
              : <p>{message.text}</p>}
          </article>
        ))}
        {props.thread.pending ? (
          <article className="is-assistant is-pending" data-local-chat-pending="true">
            <span>AI</span>
            <p>{props.thread.progress ?? "Thinking…"}</p>
          </article>
        ) : null}
      </div>

      {props.thread.error && <div className="local-chat-error" role="alert">
        <p>{props.thread.error}</p>
        {props.thread.context && <button type="button" onClick={props.onRetry} disabled={props.thread.pending || !props.thread.context}>Retry</button>}
      </div>}
      <LocalChatVerbosityToggle value={props.thread.verbosity} disabled={props.thread.pending || !props.thread.context} onChange={props.onVerbosityChange} />
      <form onSubmit={submit}>
        <label>
          <span>Follow up</span>
          <textarea
            value={draft}
            rows={2}
            maxLength={4000}
            disabled={props.thread.pending || !props.thread.context}
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
        <button type="submit" disabled={!draft.trim() || props.thread.pending || !props.thread.context} title="Send (Ctrl+Enter)">
          {props.thread.pending ? "waiting…" : "send"}
        </button>
      </form>
    </section>
  );
}
