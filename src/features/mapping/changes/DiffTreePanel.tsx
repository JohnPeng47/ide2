import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WindowPanel } from '../window-panel/WindowPanel';
import { usePanelScroll, useSaveWindowPanelState, useWindowPanelState } from '../window-panel/windowPanelState';
import { DiffTreeView } from './DiffTreeView';
import { DiffHunkView } from './DiffHunkView';
import type { DisplayModeChange } from './changeSessionApi';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import type { GitDiffHunk } from '../../../../domain/core/diffs/gitDiffHunk';
import { useDiffTreeData } from './diffTreeData';
import { diffTreeCoverage } from './diffTreeCoverage';

/** Workspace overlay: its lifetime follows the review, not the canvas underneath. */
export function DiffTreePanel({ mode, canvas, onClose, onNavigate }: { mode: DisplayModeChange; canvas: ReactNode; onClose: () => void;
  onNavigate: (mode: DisplayModeChange) => void }) {
  const storageKey = `diff-tree:${mode.sessionId}`;
  const [state, setState] = useWindowPanelState(storageKey);
  useSaveWindowPanelState(storageKey, state);
  const { data, error } = useDiffTreeData(mode.sessionId);
  const coverage = useMemo(() => data ? diffTreeCoverage(data) : undefined, [data]);
  const [trackedNode, setTrackedNode] = useState<string>();
  const [navigationError, setNavigationError] = useState('');
  useEffect(() => {
    if (!data?.diffTree) return;
    const ids = new Set(data.diffTree.nodes.map(node => node.id));
    setState(previous => ({ ...previous, selectedNode: ids.has(previous.selectedNode) ? previous.selectedNode : '*', collapsed: previous.collapsed.filter(id => ids.has(id)) }));
    setTrackedNode(undefined);
  }, [data?.diffTree?.revisionId, setState]);
  const select = (id: string, activate = true) => {
    setTrackedNode(undefined);
    setState(previous => ({ ...previous, selectedNode: id, pane: activate && previous.mode !== 'full-split' ? 'hunks' : previous.pane }));
  };
  const jump = (target: DiagramJumpTarget) => {
    const document = data?.documents?.find(doc => doc.id === target.representationId || doc.representationId === target.representationId);
    if (!document) { setNavigationError('The linked canvas is not in this change session.'); return; }
    setNavigationError('');
    onNavigate({ kind: 'change-session', sessionId: mode.sessionId, documentId: document.id,
      displayNodeId: target.displayNodeId, contentNodeId: target.contentNodeId,
      changeId: data?.changes?.find(change => change.documentId === document.id && change.nodeId === target.displayNodeId)?.id, serial: Date.now() });
    setState(previous => ({ ...previous, minimized: true }));
  };
  const tracked = useCallback((hunkId: string) => {
    const ids = coverage?.nodesForHunk(hunkId) ?? [];
    setTrackedNode(ids.find(id => id === state.selectedNode) ?? ids[0]);
  }, [coverage, state.selectedNode]);
  const openHunk = (hunkId: string) => {
    tracked(hunkId);
    const targets = (coverage?.nodesForHunk(hunkId) ?? []).flatMap(id => coverage?.targetsFor(id) ?? []);
    if (targets.length) jump(targets[0]);
    else setNavigationError('This hunk has no mapped diagram destination.');
  };
  const hunks = useMemo(() => {
    const ids = coverage?.hunksFor(state.selectedNode);
    return data?.hunks.filter(hunk => ids?.has(hunk.id)) ?? [];
  }, [data, coverage, state.selectedNode]);
  return <WindowPanel<'tree' | 'hunks'> title={data ? `${data.title} · DiffTree` : 'DiffTree'}
    subtitle={data ? `${data.status} · HEAD ${data.head?.slice(0, 12) ?? 'unknown'} · ${data.commits?.length ?? 0} commits` : undefined}
    notice={(error || navigationError) && <p role="alert" className="window-panel-message">{error || navigationError}</p>}
    canvasId={mode.documentId} state={state} onChange={patch => setState(previous => ({ ...previous, ...patch }))} onClose={onClose} canvas={canvas}
    panes={[{ id: 'tree', title: 'Change tree', content: !data ? <p className="window-panel-message">Loading change tree…</p>
      : data.diffTree && coverage ? <DiffTreeView tree={data.diffTree} selected={state.selectedNode} tracked={trackedNode} coverage={coverage}
          collapsed={state.collapsed} onSelect={select} onJump={jump} onCollapse={collapsed => setState(previous => ({ ...previous, collapsed }))} storageKey={storageKey} />
        : <p className="window-panel-message">This session has no DiffTree.</p> }, { id: 'hunks', title: 'Hunks', content: data ? <Hunks
      key={`${data.diffTree?.revisionId}:${state.selectedNode}`} hunks={hunks} selected={state.selectedNode} storageKey={storageKey} wrap={state.wrap}
      onWrap={() => setState(previous => ({ ...previous, wrap: !previous.wrap }))} onTrack={tracked} onOpen={openHunk} />
      : <p className="window-panel-message">Loading hunks…</p> }]} />;
}

function Hunks({ hunks, selected, storageKey, wrap, onWrap, onTrack, onOpen }: {
  hunks: GitDiffHunk[]; selected: string; storageKey: string; wrap: boolean; onWrap: () => void; onTrack: (id: string) => void; onOpen: (id: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null), frame = useRef(0);
  usePanelScroll(scroll, `${storageKey}:hunks:${selected}`, true);
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
    <div className="diff-pane-toolbar"><span aria-live="polite">{hunks.length} hunks · prefetched</span><button aria-pressed={wrap} onClick={onWrap}>Wrap lines</button></div>
    <div ref={scroll} className="diff-hunks-scroll" onScroll={track} tabIndex={0} aria-label="Captured hunks">
      {hunks.map(hunk => <DiffHunkView key={hunk.id} hunk={hunk} wrap={wrap} onOpen={() => onOpen(hunk.id)} />)}
      {!hunks.length && <p className="window-panel-message">{selected === '*' ? 'No captured hunks in this session.' : 'No hunks mapped to this node, its descendants or its ancestors.'}</p>}
    </div>
  </>;
}
