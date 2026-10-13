import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DiagramSearchService } from './diagramSearchService';
import type { DiagramLineSearchResult } from '../../../../domain/mapping/search/diagramSearch';
import { SearchQueryHistory } from './searchQueryHistory';
import './diagramSearch.css';

const preferenceKey = 'diagram-search-auto-select';
export function DiagramSearchPanel({ service, activeDocumentId, activeName, onReveal, onClear, onMatches, hideOpenButton, openRequest, embedded, visible, onOpen, onClose }: {
  embedded?: boolean; visible?: boolean; onOpen?: () => void; onClose?: () => void;
  service: DiagramSearchService; activeDocumentId?: string; activeName?: string;
  hideOpenButton?: boolean; openRequest?: number;
  onReveal: (result: DiagramLineSearchResult) => Promise<void>;
  onClear: () => void;
  onMatches: (results: readonly DiagramLineSearchResult[]) => void;
}) {
  const [localOpened, setOpened] = useState(false), [global, setGlobal] = useState(false);
  const opened = embedded ? !!visible : localOpened;
  const [query, setQuery] = useState(''), [caseSensitive, setCaseSensitive] = useState(false);
  const [queryHistory] = useState(() => {
    try { return new SearchQueryHistory(localStorage); } catch { return new SearchQueryHistory(); }
  });
  const [autoSelect, setAutoSelect] = useState(() => {
    try { return localStorage.getItem(preferenceKey) !== 'false'; } catch { return true; }
  });
  const [selected, setSelected] = useState(0), [navigationError, setNavigationError] = useState('');
  const [focusSerial, setFocusSerial] = useState(0);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const lastRevealed = useRef(-1);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const open = (all: boolean) => {
    if (!opened) previousFocus.current = document.activeElement as HTMLElement;
    setGlobal(all); setOpened(true); onOpen?.(); setFocusSerial(value => value + 1);
  };
  const close = () => { setOpened(false); onClose?.(); if (!embedded) previousFocus.current?.focus(); };
  useEffect(() => { if (openRequest) open(false); }, [openRequest]);
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
  const scopeDocumentId = global ? undefined : activeDocumentId;
  useEffect(() => {
    service.cancel(); onClear(); setSelected(0); lastRevealed.current = -1; setNavigationError('');
    if (!query || (!global && !scopeDocumentId)) return;
    const timer = searchTimer.current = setTimeout(() => service.search({ text: query, caseSensitive,
      scope: global ? { kind: 'global' } : { kind: 'canvas', documentId: scopeDocumentId! } }), 120);
    return () => clearTimeout(timer);
  }, [service, global, scopeDocumentId, query, caseSensitive, onClear]);
  useEffect(() => {
    if (!autoSelect || !query || state.searching || state.error) { onMatches([]); return; }
    // Wait for a completed result set and a short typing pause before selecting.
    const timer = setTimeout(() => onMatches(state.results), 250);
    return () => clearTimeout(timer);
  }, [autoSelect, query, state.results, state.searching, state.error, onMatches]);
  const reveal = async (result: DiagramLineSearchResult, index: number) => {
    lastRevealed.current = index;
    setNavigationError('');
    try { await onReveal(result); }
    catch (error) { setNavigationError(error instanceof Error ? error.message : String(error)); }
  };
  const current = Math.min(selected, Math.max(0, state.results.length - 1));
  const changeQuery = (value: string) => { service.cancel(); onClear(); setQuery(value); };
  const runSearch = () => {
    if (!query.trim()) return;
    queryHistory.submit(query);
    clearTimeout(searchTimer.current);
    if (!global && !scopeDocumentId) return;
    setSelected(0); lastRevealed.current = -1; setNavigationError('');
    service.search({ text: query, caseSensitive, scope: global ? { kind: 'global' } : { kind: 'canvas', documentId: scopeDocumentId! } });
    input.current?.focus();
  };
  return <>
    {!embedded && !opened && !hideOpenButton && <button className="diagram-search-open" aria-label="Search diagrams" title="Find in canvas (Ctrl+F); find in project (Ctrl+Shift+F)" onClick={() => open(global)}>Search</button>}
    {(embedded || opened) && <section className="diagram-search-panel" role="search" aria-label="Diagram search" onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      const inInput = event.target === input.current;
      const navigatingResults = event.target instanceof Element && !!event.target.closest('.diagram-search-results');
      if (inInput && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const next = event.key === 'ArrowUp' ? queryHistory.previous(query) : queryHistory.next(query);
        if (next !== query) changeQuery(next);
      } else if (navigatingResults && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const next = Math.max(0, Math.min(state.results.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
        setSelected(next); lastRevealed.current = -1; list.current?.querySelectorAll('button')[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && inInput) {
        event.preventDefault();
        queryHistory.submit(query);
        if (!state.results[current] || state.searching) return;
        const next = lastRevealed.current === current ? (current + (event.shiftKey ? -1 : 1) + state.results.length) % state.results.length : current;
        setSelected(next); list.current?.querySelectorAll('button')[next]?.scrollIntoView({ block: 'nearest' });
        void reveal(state.results[next], next);
      }
    }}>
      <header><strong>Find in diagrams</strong><button aria-label="Close diagram search" onClick={close}>×</button></header>
      <div className="diagram-search-options">
        <label>Scope<select aria-label="Diagram search scope" value={global ? 'global' : 'canvas'} onChange={event => setGlobal(event.target.value === 'global')}>
          <option value="canvas">This canvas</option><option value="global">Entire project</option>
        </select></label>
        <label><input type="checkbox" checked={caseSensitive} onChange={event => setCaseSensitive(event.target.checked)} />Match case</label>
        <label><input type="checkbox" checked={autoSelect} onChange={event => {
          setAutoSelect(event.target.checked);
          try { localStorage.setItem(preferenceKey, String(event.target.checked)); } catch { /* Optional browser preference. */ }
        }} />Auto-select matches</label>
      </div>
      <div className="diagram-search-query">
        <input ref={input} type="search" aria-label="Search diagram text" aria-describedby="diagram-search-history-help" placeholder="Search diagram text…" value={query}
          onChange={event => { queryHistory.edited(); changeQuery(event.target.value); }} />
        <button type="button" aria-label="Run diagram search" disabled={!query.trim()} onClick={runSearch}>Search</button>
      </div>
      <small id="diagram-search-history-help">↑/↓ query history · Enter next result · Shift+Enter previous</small>
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
              aria-current={i === current ? 'true' : undefined}
              onClick={() => { setSelected(i); void reveal(result, i); }}>
              <span className="diagram-search-line-number">{result.line}</span><code>{pieces}{result.text.slice(cursor)}</code>
            </button>
          </Fragment>;
        })}
      </div>
    </section>}
  </>;
}
