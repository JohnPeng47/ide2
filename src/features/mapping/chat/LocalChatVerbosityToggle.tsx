import type { LocalChatVerbosity } from "../../../../domain/mapping/chat/localChat";

export function LocalChatVerbosityToggle(props: {
  value: LocalChatVerbosity;
  disabled?: boolean;
  onChange: (value: LocalChatVerbosity) => void;
}) {
  return <div className="local-chat-verbosity" role="group" aria-label="Response verbosity">
    <span>Verbosity</span>
    {(["low", "high"] as const).map((value) => <button key={value} type="button"
      disabled={props.disabled} aria-pressed={props.value === value}
      onClick={() => props.onChange(value)}>{value === "low" ? "Low" : "High"}</button>)}
  </div>;
}
