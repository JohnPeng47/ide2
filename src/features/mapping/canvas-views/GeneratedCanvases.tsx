import { useEffect, useRef, useState } from 'react';
import type { ProjectRepresentationRecord } from '../../../../domain/core/representations/projectCatalog';
import { ExplorerSection, Icon } from './ExplorerSection';

const base = `${import.meta.env.BASE_URL}api/mapping/generated-canvases`;
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw Error(value.error ?? 'Generated canvas request failed'); return value;
}
const evals = (search = '') => `${import.meta.env.BASE_URL}evals${search}`;
const RECENT = 8;

/** Generation and comparison live in Evals; Mapping lists recent outputs for editing. */
export function GeneratedCanvases({ activeId, onOpen, onMigrated }: {
  activeId?: string; onOpen: (id: string) => Promise<void>; onMigrated: (items: ProjectRepresentationRecord[]) => void;
}) {
  const [canvases, setCanvases] = useState<ProjectRepresentationRecord[]>([]), [error, setError] = useState('');
  const callback = useRef(onMigrated); callback.current = onMigrated;
  useEffect(() => {
    let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const items = await request<ProjectRepresentationRecord[]>(''); if (!closed) { setCanvases(items); callback.current(items); } }
      catch (error) { if (!closed) setError(String(error)); }
      if (!closed) timer = setTimeout(poll, 10000);
    };
    void request('/migrate', {}).catch(error => { if (!closed) setError(String(error)); }).finally(() => { if (!closed) void poll(); });
    return () => { closed = true; clearTimeout(timer); };
  }, []);
  const recent = [...canvases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT);
  const detail = (canvas: ProjectRepresentationRecord) => {
    const generated = canvas.generated!;
    return [generated.prompt ? `${generated.prompt.name} v${generated.prompt.version}` : 'Unknown prompt', generated.pass && `pass ${generated.pass}`, generated.stage !== 'legacy' && generated.stage].filter(Boolean).join(' · ');
  };
  return <ExplorerSection title="Generated canvases">
    <div className="generated-canvases">
      <a className="generated-canvases-evals" href={evals()}>Generate and compare in Evals ↗</a>
      <ul className="canvas-view-tree" aria-label="Recent generated canvases">
        {recent.map(canvas => <li key={canvas.id}><button type="button" data-generated-canvas={canvas.id}
          className={`canvas-view-row${activeId === canvas.id ? ' is-active' : ''}`} title={`${canvas.name}\n${detail(canvas)}`} onClick={() => void onOpen(canvas.id).catch(error => setError(String(error)))}>
          <Icon name="view" /><span className="canvas-view-name">{canvas.name}</span>
          <span className="canvas-generation-badge">{canvas.generated!.stage === 'legacy' ? 'Legacy' : canvas.generated!.stage}</span>
        </button></li>)}
      </ul>
      {canvases.length > RECENT && <a className="canvas-view-hint" href={evals()}>All {canvases.length} generated canvases in Evals</a>}
      {!canvases.length && <p className="canvas-view-hint">No generated canvases yet. Start a run in Evals.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </ExplorerSection>;
}
