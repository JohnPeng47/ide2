import { LocalChatVerbosityToggle } from "./LocalChatVerbosityToggle";
import { TerminalMarkdownContent } from "../../core/components/TerminalMarkdownContent";
import {
  useEffect,
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
} from "../localChat";

export function LocalChatConvo(props: {
  thread: LocalChatThread;
  variant: LocalChatVariant;
  onSubmit: (message: string) => void;
  onClose: () => void;
  onVerbosityChange: (value: LocalChatVerbosity) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
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
    if (!message || props.thread.pending) return;
    props.onSubmit(message);
    setDraft("");
  };

  return (
    <section
      className={`local-chat-convo is-${props.variant}`}
      data-local-chat-convo={props.variant}
      aria-label={`Local conversation about ${props.thread.title}`}
    >
      <header>
        <div>
          <span>LOCAL CHAT</span>
          <strong>{props.thread.title}</strong>
        </div>
        <button type="button" aria-label="Collapse local conversation" onClick={props.onClose}>×</button>
      </header>

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
        <button type="button" onClick={props.onRetry} disabled={props.thread.pending}>Retry</button>
      </div>}
      <LocalChatVerbosityToggle value={props.thread.verbosity} disabled={props.thread.pending} onChange={props.onVerbosityChange} />
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
