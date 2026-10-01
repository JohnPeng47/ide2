import { memo, useEffect, useState } from 'react';
import type { CodeRepoService } from '../../../domain/core/source/codeRepoService';
import type { RepositoryDirectoryListing } from '../../../domain/core/records/domain';

// Listings are shared, but subscriptions and expansion state belong to each explorer.
const serviceListings = new WeakMap<CodeRepoService, Map<string, Promise<RepositoryDirectoryListing>>>();
function cache(service: CodeRepoService) {
  let entries = serviceListings.get(service);
  if (!entries) { entries = new Map(); serviceListings.set(service, entries); }
  return entries;
}
function load(service: CodeRepoService, projectId: string, directory: string, sourceId?: string) {
  const listings = cache(service);
  const key = JSON.stringify([projectId, sourceId, directory]);
  let request = listings.get(key);
  if (!request) {
    request = service.listDirectory({ projectId, sourceId: sourceId ?? '' }, directory).then(entries => ({ directory, entries: entries.map(entry => ({ ...entry, name: entry.path.split('/').at(-1)! })) }));
    listings.set(key, request);
    if (listings.size > 256) listings.delete(listings.keys().next().value!);
    void request.catch(() => { if (listings.get(key) === request) listings.delete(key); });
  }
  return request;
}
function Directory(props: { codeRepo: CodeRepoService; projectId: string; sourceId?: string; directory: string; selected: string; onOpen: (path: string) => void; generation: number }) {
  const { codeRepo } = props;
  const [listing, setListing] = useState<RepositoryDirectoryListing>();
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(''); setListing(undefined);
    void load(codeRepo, props.projectId, props.directory, props.sourceId).then(value => { if (active) setListing(value); }, error => { if (active) setError(String(error.message ?? error)); });
    return () => { active = false; };
  }, [codeRepo, props.projectId, props.sourceId, props.directory, props.generation, attempt]);
  if (error) return <div role="alert">{error} <button onClick={() => setAttempt(n => n + 1)}>Retry directory</button></div>;
  if (!listing) return <span role="status">Loading files…</span>;
  return <ul className="repository-file-list">
    {listing.entries.map(entry => <li key={entry.path}>
      {entry.kind === 'directory' ? <>
        <button type="button" aria-expanded={expanded.has(entry.path)} data-directory={entry.path} onClick={() => setExpanded(current => {
          const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next;
        })}>{expanded.has(entry.path) ? '▾' : '▸'} {entry.name}/</button>
        {expanded.has(entry.path) && <Directory {...props} directory={entry.path} />}
      </> : <button type="button" data-repository-file={entry.path} aria-current={props.selected === entry.path ? 'page' : undefined}
        title={entry.path} onClick={() => props.onOpen(entry.path)}>{entry.name}</button>}
    </li>)}
    {!listing.entries.length && <li>Empty directory</li>}
  </ul>;
}
export const RepositoryFileExplorer = memo(function RepositoryFileExplorer(props: { codeRepo: CodeRepoService; projectId: string; sourceId?: string; selected: string; onOpen: (path: string) => void }) {
  const { codeRepo } = props;
  const listings = cache(codeRepo);
  const [generation, setGeneration] = useState(0);
  return <aside className="repository-file-explorer" aria-label="Repository files" onKeyDown={event => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-directory], button[data-repository-file]')];
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    const next = event.key === 'ArrowDown' ? buttons[index + 1] : event.key === 'ArrowUp' ? buttons[index - 1]
      : event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1) : undefined;
    if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
    else if (event.key === 'ArrowRight' && event.target.dataset.directory && event.target.getAttribute('aria-expanded') === 'false') {
      event.preventDefault(); event.stopPropagation(); event.target.click();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault(); event.stopPropagation();
      if (event.target.getAttribute('aria-expanded') === 'true') event.target.click();
      else event.target.closest('ul')?.parentElement?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
    }
  }}>
    <button type="button" onClick={() => {
      for (const key of listings.keys()) if (JSON.parse(key)[0] === props.projectId) listings.delete(key);
      setGeneration(n => n + 1);
    }}>Refresh files</button>
    <Directory {...props} directory="" generation={generation} />
  </aside>;
});
