import { useEffect, useState } from 'react';
import { listChangeSessions, type DisplayModeChange } from './changeSessionApi';
import type { ChangeSessionSummary, DiagramChange } from '../../../../domain/mapping/changes/diagramChangeSession';
import './changeSessions.css';
const labels = { 1: 'Modify', 2: 'Add diagram', 3: 'New canvas', 4: 'Major update' };
export function ChangeBadge({ change }: { change: DiagramChange }) {
  return <span className={`change-type change-type-${change.type}`}>{change.reasons.length && change.type === 1 ? change.reasons.join('+') : change.type} {labels[change.type]}</span>;
}
export function ChangeSessionExplorer(props: { mode?: DisplayModeChange; onSelect: (mode: DisplayModeChange) => void }) {
  const [sessions, setSessions] = useState<ChangeSessionSummary[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const result = await listChangeSessions(abort.signal); if (!abort.signal.aborted) { setSessions(result); setError(''); setLoading(false); } }
      catch (e) { if (!abort.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } }
      finally { if (!abort.signal.aborted) timer = setTimeout(refresh, 2000); }
    };
    void refresh(); return () => { abort.abort(); clearTimeout(timer); };
  }, []);
  const select = (sessionId: string, documentId: string, changeId?: string) => props.onSelect({ kind: 'change-session', sessionId, documentId, changeId, serial: (props.mode?.serial ?? 0) + 1 });
  return <>
    <input type="search" aria-label="Filter change sessions" placeholder="Find changes…" value={query} onChange={e => setQuery(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Loading changes…</p> : !sessions.length && <p>No active change sessions.</p>}
    <nav aria-label="Diagram changes"><ul>{sessions.filter(s => `${s.title} ${s.changes.map(c => c.title).join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(session =>
      <li key={session.id}><details open={props.mode?.sessionId === session.id || undefined}>
        <summary>{session.title} <small>{session.status} · {session.changes.length}</small></summary>
        <ul>{session.documents.filter(doc => session.changes.some(c => c.documentId === doc.id)).map(doc => <li key={doc.id}>
          <button onClick={() => select(session.id, doc.id)}>{doc.name}</button>
          <ul>{session.changes.filter(c => c.documentId === doc.id).map(change => <li key={change.id}>
            <button className={props.mode?.sessionId === session.id && props.mode.changeId === change.id ? 'is-active' : ''}
              data-change-id={change.id} onClick={() => select(session.id, doc.id, change.id)}>
              <span>{change.title}</span><ChangeBadge change={change} />
            </button>
          </li>)}</ul>
        </li>)}</ul>
        {!session.changes.length && <p>No edits yet.</p>}
      </details></li>)}</ul></nav>
  </>;
}
