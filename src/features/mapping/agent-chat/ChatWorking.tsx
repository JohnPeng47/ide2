import { useEffect, useState } from 'react';

/** Keep clock ticks local so large transcripts do not render every second. */
export function ChatWorking({ startedAt, open, waiting, activity }: { startedAt?: string; open: boolean; waiting: boolean; activity?: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, startedAt]);
  const start = startedAt ? Date.parse(startedAt) : now;
  const seconds = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
  const elapsed = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`;
  return <div className="agent-chat-working" data-animated={open && !waiting}>
    <span className="agent-chat-working-label" role="status"><span aria-hidden="true">• </span>{waiting ? 'Waiting for you' : 'Working'}</span>
    <span className="agent-chat-elapsed" role="timer" aria-label="Elapsed turn time">({elapsed})</span>
    {activity && <span className="agent-chat-working-detail" title={activity}>· {activity}</span>}
  </div>;
}
