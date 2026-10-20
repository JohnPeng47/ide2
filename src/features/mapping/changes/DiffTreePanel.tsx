import type { TreemapCanvasColors } from './treemapDiagramColors';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WindowPanel } from '../window-panel/WindowPanel';
import { usePanelScroll, useSaveWindowPanelState, useWindowPanelState } from '../window-panel/windowPanelState';
import { ChangeTreemapContent } from './ChangeTreemapContent';
import { DiffTreeView } from './DiffTreeView';
import { DiffHunkView } from './DiffHunkView';
import type { DisplayModeChange } from './changeSessionApi';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import type { GitDiffHunk } from '../../../../domain/core/diffs/gitDiffHunk';
import { useDiffTreeData } from './diffTreeData';
import { diffTreeCoverage } from './diffTreeCoverage';

/** Workspace overlay: its lifetime follows the review, not the canvas underneath. */
export function DiffTreePanel({ mode, canvas, revealCanvasSerial, revealNode, onSearch, onClose, onNavigate, onCanvasColors }: { onCanvasColors?: (colors: TreemapCanvasColors | undefined) => void; mode: DisplayModeChange; canvas: ReactNode; revealCanvasSerial?: number; revealNode?: { nodeId: string; serial: number }; onSearch: () => void; onClose: () => void;
  onNavigate: (mode: DisplayModeChange) => void }) {
  const storageKey = `diff-tree:${mode.sessionId}`;
  const [state, setState] = useWindowPanelState(storageKey);
  useSaveWindowPanelState(storageKey, state);
  useEffect(() => {
    if (mode.view === 'treemaps') setState(previous => ({ ...previous, pane: 'treemaps', focusedPane: 'treemaps' }));
  }, [mode.view, mode.serial, setState]);
  useEffect(() => {
    if (revealCanvasSerial !== undefined) setState(previous => previous.minimized ? previous : { ...previous, minimized: true });
  }, [revealCanvasSerial, setState]);
  const { data, error } = useDiffTreeData(mode.sessionId);
  const coverage = useMemo(() => data ? diffTreeCoverage(data) : undefined, [data]);
  const hunkFilter = state.minimized ? data?.diffTree?.nodes.find(node => node.id === state.hunkFilterNode) : undefined;
  const visibleHunks = useMemo(() => {
    const hunks = data?.hunks ?? [];
    if (!hunkFilter || !coverage) return hunks;
    const ids = coverage.hunksFor(hunkFilter.id);
    return hunks.filter(hunk => ids.has(hunk.id));
  }, [data?.hunks, coverage, hunkFilter]);
  const hunkStorageKey = hunkFilter ? `${storageKey}:node:${hunkFilter.id}` : storageKey;
  const [navigationError, setNavigationError] = useState('');
  const [scrollTarget, setScrollTarget] = useState<string>();
  const [treeReveal, setTreeReveal] = useState<{ nodeId: string; serial: number }>();
  const handledReveal = useRef<number | undefined>(undefined);
  const didScroll = useCallback(() => setScrollTarget(undefined), []);
  useEffect(() => {
    if (!revealNode || handledReveal.current === revealNode.serial || !data?.diffTree || !coverage) return;
    const node = data.diffTree.nodes.find(node => node.id === revealNode.nodeId);
    if (!node) return;
    handledReveal.current = revealNode.serial;
    const ancestors = new Set<string>();
    let parent = node.parentId;
    while (parent) { ancestors.add(parent); parent = data.diffTree.nodes.find(node => node.id === parent)?.parentId; }
    const activePane = state.minimized || state.mode === 'full-split' ? state.focusedPane : state.pane;
    const pane = activePane === 'treemaps' ? 'tree' : activePane;
    setState(previous => ({ ...previous, minimized: true, focusedPane: pane, selectedNode: node.id, trackedNode: undefined,
      hunkFilterNode: pane === 'hunks' ? node.id : previous.hunkFilterNode,
      collapsed: previous.collapsed.filter(id => !ancestors.has(id)) }));
    setTreeReveal(pane === 'tree' ? revealNode : undefined);
    setScrollTarget(pane === 'hunks' ? data.hunks.find(hunk => coverage.hunksFor(node.id).has(hunk.id))?.id : undefined);
    setNavigationError('');
  }, [revealNode, data, coverage, state.minimized, state.mode, state.focusedPane, state.pane, setState]);
  useEffect(() => {
    if (!data?.diffTree) return;
    const ids = new Set(data.diffTree.nodes.map(node => node.id));
    setState(previous => ({ ...previous, selectedNode: ids.has(previous.selectedNode) ? previous.selectedNode : '*',
      trackedNode: previous.trackedNode && ids.has(previous.trackedNode) ? previous.trackedNode : undefined,
      hunkFilterNode: previous.hunkFilterNode && ids.has(previous.hunkFilterNode) ? previous.hunkFilterNode : undefined,
      collapsed: previous.collapsed.filter(id => ids.has(id)) }));
  }, [data?.diffTree?.revisionId, setState]);
  const select = (id: string, activate = true) => {
    setTreeReveal(undefined);
    if (activate) {
      const ids = coverage?.hunksFor(id);
      setScrollTarget(data?.hunks.find(hunk => ids?.has(hunk.id))?.id);
    }
    setState(previous => ({ ...previous, selectedNode: id, trackedNode: undefined, pane: activate && previous.mode !== 'full-split' ? 'hunks' : previous.pane,
      hunkFilterNode: activate ? previous.minimized && id !== '*' ? id : undefined : previous.hunkFilterNode,
      focusedPane: activate && previous.minimized ? 'hunks' : previous.focusedPane }));
  };
  const jump = (target: DiagramJumpTarget, nodeId: string) => {
    const document = data?.documents?.find(doc => doc.id === target.representationId || doc.representationId === target.representationId);
    if (!document) { setNavigationError('The linked canvas is not in this change session.'); return; }
    setNavigationError('');
    onNavigate({ kind: 'change-session', sessionId: mode.sessionId, documentId: document.id,
      displayNodeId: target.displayNodeId, contentNodeId: target.contentNodeId,
      changeId: data?.changes?.find(change => change.documentId === document.id && change.nodeId === target.displayNodeId)?.id, serial: Date.now() });
    setState(previous => ({ ...previous, minimized: true, selectedNode: nodeId,
      hunkFilterNode: previous.minimized ? previous.hunkFilterNode : undefined }));
  };
  const tracked = useCallback((hunkId: string) => {
    const ids = coverage?.nodesForHunk(hunkId) ?? [];
    const trackedNode = ids.find(id => id === state.selectedNode) ?? ids[0];
    setState(previous => previous.trackedNode === trackedNode ? previous : { ...previous, trackedNode });
  }, [coverage, state.selectedNode, setState]);
  const openHunk = (hunkId: string) => {
    tracked(hunkId);
    const destinations = (coverage?.nodesForHunk(hunkId) ?? []).flatMap(id => (coverage?.targetsFor(id) ?? []).map(target => ({ nodeId: id, target })));
    if (destinations.length) jump(destinations[0].target, destinations[0].nodeId);
    else setNavigationError('This hunk has no mapped diagram destination.');
  };
  return <WindowPanel<'tree' | 'hunks' | 'treemaps'> title={data ? `${data.title} · DiffTree` : 'DiffTree'} sizeStorageKey={storageKey}
    actions={<button type="button" aria-label="Search diagrams" title="Find in proposal canvas (Ctrl+B, F)" onClick={onSearch}>Search</button>}
    subtitle={data ? `${data.status} · HEAD ${data.head?.slice(0, 12) ?? 'unknown'} · ${data.commits?.length ?? 0} commits` : undefined}
    notice={(error || navigationError) && <p role="alert" className="window-panel-message">{error || navigationError}</p>}
    canvasId={mode.documentId} state={state} onChange={patch => setState(previous => ({ ...previous, ...patch }))} onClose={onClose} canvas={canvas}
    panes={[{ id: 'tree', title: 'Change tree', content: !data ? <p className="window-panel-message">Loading change tree…</p>
      : data.diffTree && coverage ? <DiffTreeView tree={data.diffTree} selected={state.selectedNode} tracked={state.minimized ? undefined : state.trackedNode} coverage={coverage}
          revealNode={treeReveal}
          collapsed={state.collapsed} onSelect={select} onJump={jump} onCollapse={collapsed => setState(previous => ({ ...previous, collapsed }))} storageKey={storageKey} />
        : <p className="window-panel-message">This session has no DiffTree.</p> }, { id: 'hunks', title: 'Hunks', content: data ? <Hunks
      key={`${data.diffTree?.revisionId}:${hunkFilter?.id ?? '*'}`} hunks={visibleHunks} filterLabel={hunkFilter?.label} onShowAll={() => select('*')}
      scrollTarget={scrollTarget} onDidScroll={didScroll} storageKey={hunkStorageKey} wrap={state.wrap}
      onWrap={() => setState(previous => ({ ...previous, wrap: !previous.wrap }))} onTrack={tracked} onOpen={openHunk} />
      : <p className="window-panel-message">Loading hunks…</p> }, { id: 'treemaps', title: 'Treemaps', content: <ChangeTreemapContent mode={mode} onCanvasColors={onCanvasColors}
        onNavigate={onNavigate} /> }]} />;
}

function Hunks({ hunks, filterLabel, onShowAll, scrollTarget, onDidScroll, storageKey, wrap, onWrap, onTrack, onOpen }: {
  filterLabel?: string; onShowAll: () => void;
  hunks: GitDiffHunk[]; scrollTarget?: string; onDidScroll: () => void; storageKey: string; wrap: boolean; onWrap: () => void; onTrack: (id: string) => void; onOpen: (id: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null), frame = useRef(0);
  usePanelScroll(scroll, `${storageKey}:hunks`, true);
  useLayoutEffect(() => {
    const container = scroll.current; if (!container) return;
    const key = `${storageKey}:hunk-anchor`;
    // Pixel offsets alone drift when offscreen hunks regain their estimated heights.
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      const target = saved && [...container.querySelectorAll<HTMLElement>('[data-hunk-id]')].find(node => node.dataset.hunkId === saved.id);
      if (target) {
        container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - saved.offset;
      }
    } catch { /* Optional view state. */ }
    const save = () => {
      const bounds = container.getBoundingClientRect();
      if (!bounds.height) return;
      const node = document.elementFromPoint(bounds.left + Math.min(200, bounds.width / 2), bounds.top + 1)?.closest<HTMLElement>('[data-hunk-id]');
      if (node && container.contains(node)) try {
        sessionStorage.setItem(key, JSON.stringify({ id: node.dataset.hunkId, offset: node.getBoundingClientRect().top - bounds.top }));
      } catch { /* Optional view state. */ }
    };
    container.addEventListener('scroll', save); window.addEventListener('pagehide', save);
    return () => { save(); container.removeEventListener('scroll', save); window.removeEventListener('pagehide', save); };
  }, [storageKey]);
  useEffect(() => {
    if (!scrollTarget) return;
    const container = scroll.current;
    const target = container?.querySelector<HTMLElement>(`[data-hunk-id="${scrollTarget}"]`);
    if (!container || !target) return;
    container.dataset.programmaticScroll = 'true';
    let frame = 0, stable = 0;
    const finish = () => { cancelAnimationFrame(frame); clearTimeout(timer); delete container.dataset.programmaticScroll; onDidScroll(); };
    const timer = setTimeout(finish, 1000);
    const align = () => {
      // content-visibility replaces estimated heights as the destination renders.
      // Keep its header aligned until those layout changes have settled.
      const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
      stable = Math.abs(delta) < 1 ? stable + 1 : 0;
      container.scrollTop += delta;
      if (stable >= 3) finish(); else frame = requestAnimationFrame(align);
    };
    frame = requestAnimationFrame(align);
    for (const event of ['wheel', 'pointerdown', 'keydown']) container.addEventListener(event, finish);
    return () => {
      clearTimeout(timer); cancelAnimationFrame(frame); delete container.dataset.programmaticScroll;
      for (const event of ['wheel', 'pointerdown', 'keydown']) container.removeEventListener(event, finish);
    };
  }, [scrollTarget, onDidScroll]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const track = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const element = scroll.current; if (!element) return;
      const rect = element.getBoundingClientRect();
      const current = document.elementFromPoint(rect.left + Math.min(200, rect.width / 2), rect.top + Math.min(65, rect.height / 3))?.closest<HTMLElement>('[data-hunk-id]');
      if (current?.dataset.hunkId && element.contains(current)) onTrack(current.dataset.hunkId);
    });
  }, [onTrack]);
  useEffect(() => {
    const observer = new IntersectionObserver(track, { root: scroll.current, threshold: [0, .01, 1] });
    scroll.current?.querySelectorAll('[data-hunk-id]').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [hunks, track]);
  return <>
    <div className="diff-pane-toolbar"><span aria-live="polite" title={filterLabel}>{hunks.length} {filterLabel ? 'mapped hunks' : 'hunks · prefetched'}</span>
      {filterLabel && <button onClick={onShowAll}>All changes</button>}<button aria-pressed={wrap} onClick={onWrap}>Wrap lines</button></div>
    <div ref={scroll} className="diff-hunks-scroll" onScroll={track} tabIndex={0} aria-label="Captured hunks">
      {hunks.map(hunk => <DiffHunkView key={hunk.id} hunk={hunk} wrap={wrap} onOpen={() => onOpen(hunk.id)} />)}
      {!hunks.length && <p className="window-panel-message">{filterLabel ? 'No hunks mapped to this node.' : 'No captured hunks in this session.'}</p>}
    </div>
  </>;
}
