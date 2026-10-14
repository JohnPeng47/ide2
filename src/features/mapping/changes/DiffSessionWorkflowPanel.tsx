import { useEffect, useState } from 'react';
import type { Repository } from '../../../../domain/core/repositories/repository';
import type { ChangeSessionSummary } from '../../../../domain/mapping/changes/diagramChangeSession';
import type { DiffSessionRun } from '../../../../domain/mapping/changes/diffSessionWorkflow';
import { apiFetch } from '../../../shared/http/http';
import './diffSessionWorkflow.css';

const base = '/api/mapping/workflows/diff-session-create';
async function request(path: string, body?: unknown, signal?: AbortSignal): Promise<DiffSessionRun> {
  const response = await apiFetch(base + path, { signal, ...(body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? 'Workflow request failed');
  return value;
}
export function DiffSessionWorkflowPanel({ sessions, repositories, onOpen }: {
  sessions: ChangeSessionSummary[]; repositories: Repository[]; onOpen(id: string): void;
}) {
  const [source, setSource] = useState('commits'), [baseline, setBaseline] = useState('');
  const [repository, setRepository] = useState(''), [commits, setCommits] = useState(''), [title, setTitle] = useState('Generated ChangeSession');
  const [run, setRun] = useState<DiffSessionRun>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const running = run?.status === 'running';
  useEffect(() => {
    if (!running || !run) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await request(`/${run.id}`, undefined, abort.signal); if (!abort.signal.aborted) { setRun(next); setError(''); } }
      catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(poll, 1500); }
    };
    timer = setTimeout(poll, 1000);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [run?.id, running]);
  const start = async () => {
    setBusy(true); setError('');
    try {
      setRun(await request('', { requestId: crypto.randomUUID(), title,
        ...(source === 'baseline' ? { baselineChangeSessionId: baseline } : {
          repositoryId: repository || repositories[0]?.id, commits: commits.split(/[\s,]+/).filter(Boolean)
        }) }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <details className="diff-session-workflow">
    <summary>Generate ChangeSession with AI</summary>
    <form onSubmit={e => { e.preventDefault(); void start(); }}>
      <p>astra-high · Analyze diagrams, then create a proposal in the same agent session.</p>
      <fieldset disabled={busy || running}>
        <label>Title<input required value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label>Context<select value={source} onChange={e => setSource(e.target.value)}>
          <option value="commits">Selected commits</option><option value="baseline">Existing ChangeSession baseline</option>
        </select></label>
        {source === 'baseline' ? <label>Baseline<select required value={baseline} onChange={e => setBaseline(e.target.value)}>
          <option value="">Choose a ChangeSession…</option>
          {sessions.filter(s => s.head && s.commits?.length).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select><small>Reuses its original diagrams and pinned commits.</small></label> : <>
          <label>Repository<select required value={repository || repositories[0]?.id || ''} onChange={e => setRepository(e.target.value)}>
            {!repositories.length && <option value="">No repositories</option>}
            {repositories.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
          <label>Commits<textarea required placeholder="Commit SHAs or refs, separated by spaces or newlines" value={commits} onChange={e => setCommits(e.target.value)} /></label>
        </>}
        <button type="submit">{busy ? 'Starting…' : 'Generate proposal'}</button>
      </fieldset>
    </form>
    {run && <div role="status"><strong>{run.status} · {run.stage}</strong><p>{run.message}</p>
      {running && <button onClick={() => { void request(`/${run.id}/cancel`, {}).then(setRun).catch(e => setError(String(e))); }}>Cancel generation</button>}
      {run.changeSessionId && <button onClick={() => onOpen(run.changeSessionId!)}>Open {run.status === 'completed' ? 'proposal' : 'draft'}</button>}
      {run.error && <p role="alert">{run.error}</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
