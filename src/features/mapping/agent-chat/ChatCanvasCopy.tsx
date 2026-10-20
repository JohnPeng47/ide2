import { createContext, useContext, useEffect, useState } from 'react';

export const ChatCanvasCopyContext = createContext<((ascii: string) => void) | undefined>(undefined);

export function CopyToCanvasButton({ text, enabled }: { text: string; enabled: boolean }) {
  const copy = useContext(ChatCanvasCopyContext);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  useEffect(() => setFeedback(undefined), [text, copy]);
  return <div className="agent-canvas-copy">
    <button type="button" disabled={!copy || !enabled}
      title={copy ? 'Stage this diagram, then move onto the canvas and press Ctrl/Cmd+V' : 'Open a live canvas to paste a diagram'}
      onClick={() => {
        if (!copy) return;
        try {
          copy(text);
          setFeedback({ error: false, text: 'Move onto the canvas · Ctrl/Cmd+V to paste · Esc to cancel' });
        } catch (error) {
          setFeedback({ error: true, text: error instanceof Error ? error.message : String(error) });
        }
      }}>Copy to canvas</button>
    {feedback && <small role={feedback.error ? 'alert' : 'status'}>{feedback.text}</small>}
  </div>;
}
