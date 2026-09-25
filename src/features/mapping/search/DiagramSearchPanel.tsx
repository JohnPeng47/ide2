import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DiagramSearchService } from './diagramSearchService';
import type { DiagramLineSearchResult } from '../../../../domain/mapping/search/diagramSearch';
import './diagramSearch.css';

export function DiagramSearchPanel({ service, activeDocumentId, activeName, onReveal }: {
  service: DiagramSearchService; activeDocumentId?: string; activeName?: string;
  onReveal: (result: DiagramLineSearchResult) => Promise<void>;
}) {
  const [opened, setOpened] = useState(false), [global, setGlobal] = useState(false);
  const [query, setQuery] = useState(''), [caseSensitive, setCaseSensitive] = useState(false);
  const [selected, setSelected] = useState(0), [navigationError, setNavigationError] = useState('');
  const [focusSerial, setFocusSerial] = useState(0);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const open = (all: boolean) => {
    if (!opened) previousFocus.current = document.activeElement as HTMLElement;
    setGlobal(all); setOpened(true); setFocusSerial(value => value + 1);
  };
  const close = () => { setOpened(false); service.cancel(); previousFocus.current?.focus(); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); open(event.shiftKey);
      } else if (opened && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [opened]);
  useEffect(() => { if (opened) { input.current?.focus(); input.current?.select(); } }, [opened, focusSerial]);
  useEffect(() => {
    service.cancel(); setSelected(0); setNavigationError('');
    if (!opened || (!global && !activeDocumentId)) return;
    const timer = setTimeout(() => service.search({ text: query, caseSensitive,
      scope: global ? { kind: 'global' } : { kind: 'canvas', documentId: activeDocumentId! } }), 120);
    return () => clearTimeout(timer);
  }, [service, opened, global, activeDocumentId, query, caseSensitive]);
  const reveal = async (result: DiagramLineSearchResult) => {
    setNavigationError('');
    try { await onReveal(result); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : String(error)); }
  };
  const current = Math.min(selected, Math.max(0, state.results.length - 1));
  return <>
    {!opened && <button className="diagram-search-open" aria-label="Search diagrams" title="Find in canvas (Ctrl+F); find in project (Ctrl+Shift+F)" onClick={() => open(false)}>Search</button>}
    {opened && <section className="diagram-search-panel" role="search" aria-label="Diagram search" onKeyDown={event => {
      const navigatingResults = event.target === input.current || (event.target instanceof Element && !!event.target.closest('.diagram-search-results'));
      if (navigatingResults && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const next = Math.max(0, Math.min(state.results.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
        setSelected(next); list.current?.querySelectorAll('button')[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && event.target === input.current && state.results[current]) {
        event.preventDefault(); void reveal(state.results[current]);
      }
    }}>
      <header><strong>Find in diagrams</strong><button aria-label="Close diagram search" onClick={close}>×</button></header>
      <div className="diagram-search-options">
        <label>Scope<select aria-label="Diagram search scope" value={global ? 'global' : 'canvas'} onChange={event => setGlobal(event.target.value === 'global')}>
          <option value="canvas">This canvas</option><option value="global">Entire project</option>
        </select></label>
        <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />Match case</label>
      </div>
      <input ref={input} type="search" aria-label="Search diagram text" placeholder="Search diagram text…" value={query} onChange={event => setQuery(event.target.value)} />
      <small>{global ? 'Current project diagrams · includes unsaved edits' : activeName ?? 'No active canvas'}</small>
      <p role="status">{state.error || navigationError || (!query ? 'Enter text to search.' : state.searching ? `Searching… ${state.results.length} lines` : `${state.results.length}${state.truncated ? '+' : ''} matching ${state.results.length === 1 ? 'line' : 'lines'}`)}
        {state.truncated && ' · Refine your search to see more.'}</p>
      <div ref={list} className="diagram-search-results" aria-label="Diagram search results">
        {state.results.map((result, i) => {
          const previous = state.results[i - 1];
          let cursor = 0;
          const pieces = result.matches.flatMap((match, j) => {
            const before = result.text.slice(cursor, match.startColumn - 1); cursor = match.endColumn;
            return [before, <mark key={j}>{result.text.slice(match.startColumn - 1, match.endColumn)}</mark>];
          });
          return <Fragment key={`${result.canvasDocumentId}:${result.displayNodeId}:${result.line}`}>
            {(previous?.canvasDocumentId !== result.canvasDocumentId || previous.displayNodeId !== result.displayNodeId) &&
              <h3>{result.canvasName}<span>{result.diagramName || result.diagramId}</span></h3>}
            <button className={i === current ? 'is-current' : ''} data-search-result-line={result.line}
              data-search-result-canvas={result.canvasDocumentId} data-search-result-node={result.displayNodeId}
              title={`${result.canvasName} · ${result.diagramName} · line ${result.line}`}
              onClick={() => { setSelected(i); void reveal(result); }}>
              <span className="diagram-search-line-number">{result.line}</span><code>{pieces}{result.text.slice(cursor)}</code>
            </button>
          </Fragment>;
        })}
      </div>
    </section>}
  </>;
}
