import { repositoryGroups, type Repository } from '../../../../domain/core/repositories/repository';
import { RepositoryTreeGroup } from '../workspace/RepositoryTreeGroup';
import type { DiagramMigration, MigrationRole } from '../../../../domain/mapping/changes/diagramMigration';
import { useEffect, useState } from 'react';
import { listChangeSessions, type DisplayModeChange } from './changeSessionApi';
import type { ChangeSessionSummary, DiagramChange } from '../../../../domain/mapping/changes/diagramChangeSession';
import './changeSessions.css';
import { prefetchDiffTree } from './diffTreeData';
const labels = { 1: 'Modify', 2: 'Add diagram', 3: 'New canvas', 4: 'Major update' };
export function ChangeBadge({ change }: { change: DiagramChange }) {
  return <span className={`change-type change-type-${change.type}`}>{change.reasons.length && change.type === 1 ? change.reasons.join('+') : change.type} {labels[change.type]}</span>;
}
export function ChangeSessionExplorer(props: { repositories?: Repository[]; mode?: DisplayModeChange; onSelect: (mode: DisplayModeChange) => void }) {
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
  const openDiffTree = (sessionId: string, documentId: string) => props.onSelect({ kind: 'change-session', sessionId, documentId, view: 'diff-tree', serial: (props.mode?.serial ?? 0) + 1 });
  const selectMigration = (sessionId: string, migration: DiagramMigration, role: MigrationRole) => props.onSelect({
    kind: 'change-session', sessionId, documentId: migration[role].documentId, migrationId: migration.id,
    migrationRole: role, serial: (props.mode?.serial ?? 0) + 1 });
  return <>
    <input type="search" aria-label="Filter change sessions" placeholder="Find changes…" value={query} onChange={e => setQuery(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Loading changes…</p> : !sessions.length && <p>No active change sessions.</p>}
    <nav aria-label="Diagram changes"><ul>{repositoryGroups(props.repositories ?? [], sessions).map(group => ({ ...group, items: group.items.filter(s => `${group.name} ${s.title} ${s.changes.map(c => c.title).join(' ')} ${(s.migrations ?? []).map(m => `${m.title} ${m.description}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())) })).filter(group => group.items.length).map(group => <RepositoryTreeGroup key={group.id} id={group.id} name={group.name} reveal={!!query || group.items.some(session => session.id === props.mode?.sessionId)}>{group.items.map(session =>
      <li key={session.id}><details open={props.mode?.sessionId === session.id || undefined}>
        <summary onPointerEnter={() => { if (session.diffTree) void prefetchDiffTree(session.id); }} onFocus={() => { if (session.diffTree) void prefetchDiffTree(session.id); }} data-change-session-summary={session.id}>{session.title} <small>{session.status} · {session.changes.length}</small></summary>
        <p className="change-repository-context">{session.head
          ? <><span title={session.head}>HEAD {session.head.slice(0, 12)}</span> · {session.commits?.length ?? 0} commits</>
          : 'Historical repository context unknown'}</p>
        {!!session.commits?.length && <details className="change-commit-list"><summary>Selected commits</summary><ul>{session.commits.map(commit => <li key={commit}><code title={commit}>{commit.slice(0, 12)}</code></li>)}</ul></details>}
        {session.diffTree && <button data-open-difftree={session.id}
          onClick={() => openDiffTree(session.id, props.mode?.sessionId === session.id ? props.mode.documentId : session.documents[0]?.id ?? '')}>
          Diff tree · {session.diffTree.hunkCount} hunks</button>}
        <button data-open-treemaps={session.id} onClick={() => props.onSelect({ kind: 'change-session', sessionId: session.id,
          documentId: props.mode?.sessionId === session.id ? props.mode.documentId : session.documents[0]?.id ?? '',
          view: 'treemaps', serial: (props.mode?.serial ?? 0) + 1 })}>Treemaps · changed LOC</button>
        <ul>{session.documents.filter(doc => session.diffTree || session.changes.some(c => c.documentId === doc.id)).map(doc => <li key={doc.id}>
          <button onClick={() => select(session.id, doc.id)}>{doc.name}</button>
          {session.diffTree && <button data-open-difftree-document={doc.id}
            className={props.mode?.sessionId === session.id && props.mode.documentId === doc.id && props.mode.view === 'diff-tree' ? 'is-active' : ''}
            aria-label={`Open diff tree for ${doc.name}`}
            onClick={() => openDiffTree(session.id, doc.id)}>Diff tree</button>}
          <ul>{session.changes.filter(c => c.documentId === doc.id).map(change => <li key={change.id}>
            <button className={props.mode?.sessionId === session.id && props.mode.changeId === change.id ? 'is-active' : ''}
              data-change-id={change.id} onClick={() => select(session.id, doc.id, change.id)}>
              <span>{change.title}</span><ChangeBadge change={change} />
            </button>
          </li>)}</ul>
        </li>)}</ul>
        {!!session.migrations?.length && <ul aria-label="Migrations">{session.migrations.map(migration => <li key={migration.id}>
          <strong>{migration.id} · {migration.title}</strong>
          <div className="migration-links">{(['source', 'destination'] as const).map(role => <button key={role}
            className={`migration-${role}`} data-migration-link={migration.id} data-migration-role={role}
            aria-pressed={props.mode?.sessionId === session.id && props.mode.migrationId === migration.id && props.mode.migrationRole === role}
            onClick={() => selectMigration(session.id, migration, role)}>
            {role === 'source' ? 'Source ↗' : 'Destination ↙'} · {session.documents.find(d => d.id === migration[role].documentId)?.name}
          </button>)}</div>
        </li>)}</ul>}
        {!session.changes.length && <p>No edits yet.</p>}
      </details></li>)}</RepositoryTreeGroup>)}</ul></nav>
  </>;
}
