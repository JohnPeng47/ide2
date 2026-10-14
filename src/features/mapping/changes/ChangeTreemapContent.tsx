import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeTreemapNode } from '../../../../domain/mapping/changes/changeTreemap';
import { readChangeTreemaps, type ChangeTreemapRead, type DisplayModeChange } from './changeSessionApi';
import { treemapLayout } from './treemapLayout';
import './changeTreemap.css';

const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const description = (node: ChangeTreemapNode) => {
  const allocation = node.allocation;
  const shared = allocation?.sharedLoc ? ` · ${format(allocation.sharedLoc)} shared LOC; each shared hunk split across ${allocation.minDestinations === allocation.maxDestinations ? allocation.minDestinations : `${allocation.minDestinations}–${allocation.maxDestinations}`} mapped nodes` : '';
  return `${node.label}: ${format(node.value)} ${allocation ? 'allocated' : 'changed'} LOC (+${format(node.added)} / −${format(node.deleted)})${shared}${node.previous ? ' · previous revision' : ''}`;
};
type View = 'files' | 'diagrams';
function indexTree(root: ChangeTreemapNode) {
  const nodes = new Map<string, ChangeTreemapNode>(), parents = new Map<string, string>();
  const visit = (node: ChangeTreemapNode) => { nodes.set(node.id, node); node.children.forEach(child => { parents.set(child.id, node.id); visit(child); }); };
  visit(root); return { nodes, parents };
}

export function ChangeTreemapContent({ mode, onNavigate }: {
  mode: DisplayModeChange; onNavigate: (mode: DisplayModeChange) => void;
}) {
  const [data, setData] = useState<ChangeTreemapRead>(), [error, setError] = useState('');
  const [view, setView] = useState<View>('files');
  const [locations, setLocations] = useState<Record<View, { focus?: string; selected?: string }>>({ files: {}, diagrams: {} });
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>, version: number | undefined;
    const refresh = async () => {
      let terminal = false;
      try {
        const next = await readChangeTreemaps(mode.sessionId, version, abort.signal);
        if (abort.signal.aborted) return;
        if (next) { version = next.version; setData(next); terminal = ['accepted', 'archived'].includes(next.status); }
        setError('');
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (!abort.signal.aborted && !terminal) timer = setTimeout(refresh, 2000); }
    };
    void refresh(); return () => { abort.abort(); clearTimeout(timer); };
  }, [mode.sessionId]);
  const tree = data?.[view];
  const index = useMemo(() => tree ? indexTree(tree) : undefined, [tree]);
  const focus = index?.nodes.get(locations[view].focus ?? '') ?? tree;
  const selected = index?.nodes.get(locations[view].selected ?? '') ?? focus;
  const breadcrumbs: ChangeTreemapNode[] = [];
  let cursor = focus;
  while (cursor && index) { breadcrumbs.unshift(cursor); cursor = index.nodes.get(index.parents.get(cursor.id) ?? ''); }
  const pick = (node: ChangeTreemapNode, zoom = false) => {
    setLocations(previous => ({ ...previous, [view]: { ...previous[view], selected: node.id, ...(zoom ? { focus: node.id } : {}) } }));
  };
  const navigate = (node: ChangeTreemapNode) => {
    if (!node.target || node.previous) return;
    onNavigate({ kind: 'change-session', sessionId: mode.sessionId, documentId: node.target.representationId,
      displayNodeId: node.target.displayNodeId, contentNodeId: node.target.contentNodeId, serial: Date.now() });
  };
  const map = <div className="change-treemap-map">
    <div className="diff-pane-toolbar change-treemap-switch" role="group" aria-label="Treemap grouping">
      {(['files', 'diagrams'] as const).map(option => <button key={option} aria-pressed={view === option} onClick={() => setView(option)}>{option === 'files' ? 'Files' : 'Diagrams'}</button>)}
      <span>{view === 'diagrams' ? 'Area = allocated changed LOC' : 'Area = added + deleted LOC'}</span>
    </div>
    {data && <div className="change-treemap-summary" aria-label="Change LOC totals">
      <span><strong>{format(data.actual)}</strong> actual LOC</span>
      <span><strong>{format(data.mapped)}</strong> allocated to diagrams</span>
      <span><strong>{format(data.unmapped)}</strong> unmapped LOC</span>
      <span title="Extra attribution removed by dividing each hunk equally across its mapped nodes."><strong>{format(data.extra)}</strong> duplicate LOC discounted</span>
    </div>}
    <nav className="change-treemap-breadcrumbs" aria-label="Treemap path">{breadcrumbs.map((node, i) => <span key={node.id}>{i > 0 && <span aria-hidden="true"> / </span>}<button aria-current={node.id === focus?.id ? 'location' : undefined} onClick={() => pick(node, true)}>{node.label}</button></span>)}</nav>
    <div className="change-treemap-legend"><span data-tone="added">More additions</span><span data-tone="mixed">Mixed</span><span data-tone="deleted">More deletions</span></div>
    {!data ? <p className="window-panel-message">Loading captured changes…</p> : focus?.value ? <>
      <Treemap node={focus} selected={selected?.id} onPick={(node, zoom) => {
        if (node.target && !node.previous) { pick(node); navigate(node); }
        else pick(node, zoom);
      }} />
      <label className="change-treemap-region-picker">Inspect region <select aria-label="Inspect treemap region" value={selected?.id ?? focus.id} onChange={event => { const node = index?.nodes.get(event.target.value); if (node) pick(node); }}>
        <option value={focus.id}>{focus.label} · {format(focus.value)} LOC</option>
        {focus.children.map(node => <option key={node.id} value={node.id}>{node.label} · {format(node.value)} LOC</option>)}
        {selected && selected.id !== focus.id && !focus.children.some(n => n.id === selected.id) && <option value={selected.id}>{selected.label} · {format(selected.value)} LOC</option>}
      </select></label>
    </> : <p className="window-panel-message">{view === 'diagrams' && data.actual ? 'No captured hunks are mapped to diagram nodes. The file map still shows all changes.' : 'No added or deleted text lines in this selection.'}</p>}
    {data && <footer className="change-treemap-footnote">
      {view === 'diagrams' && <p>Each hunk’s added + deleted LOC is divided equally across its mapped nodes, across all diagrams. Unmapped changes keep their full area.</p>}
      {data.unresolvedTargets > 0 && <p>{data.unresolvedTargets} diagram destinations could not be resolved in the captured snapshots.</p>}
      {data.nonTextHunks > 0 && <p>{data.nonTextHunks} binary / metadata changes · no LOC area</p>}
    </footer>}
  </div>;
  return <div className="change-treemap-panel">
    {error && <p role="alert" className="window-panel-message">{error}</p>}
    {map}
    {selected && <div className="diff-pane-toolbar change-treemap-selection" aria-label="Selected treemap region">
      <span>{description(selected)}</span>
      {!!selected.children.length && <button onClick={() => pick(selected, true)}>Zoom into region</button>}
      {selected.target && !selected.previous && <button onClick={() => navigate(selected)}>Open in canvas ↗</button>}
    </div>}
  </div>;
}

function Treemap({ node, selected, onPick }: { node: ChangeTreemapNode; selected?: string; onPick: (node: ChangeTreemapNode, zoom?: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="change-treemap-plot" aria-label="Changed LOC treemap">
    <Cells nodes={node.children.length ? node.children : [node]} {...size} selected={selected} onPick={onPick} depth={0} />
  </div>;
}
function Cells({ nodes, width, height, depth, selected, onPick }: { nodes: ChangeTreemapNode[]; width: number; height: number; depth: number; selected?: string; onPick: (node: ChangeTreemapNode, zoom?: boolean) => void }) {
  return treemapLayout(nodes, width, height).map(({ node, rect }) => {
    const nested = depth < 2 && node.children.length > 0 && rect.width > 140 && rect.height > 100;
    const tone = node.added > node.deleted * 2 ? 'added' : node.deleted > node.added * 2 ? 'deleted' : 'mixed';
    return <div key={node.id} className="change-treemap-cell" data-tone={tone} data-selected={selected === node.id} data-treemap-kind={node.kind} data-loc={node.value}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
      <button className={nested ? 'change-treemap-heading' : 'change-treemap-leaf'} title={`${description(node)}${node.target && !node.previous ? ' · Click to open in canvas' : ''}`} aria-label={description(node)}
        onClick={() => onPick(node, node.children.length > 0)}>
        <span>{node.previous ? '◌ ' : ''}{node.label}</span><small>{format(node.value)} LOC{node.target && !node.previous ? ' ↗' : node.children.length > 0 ? ' ↳' : ''}</small>
      </button>
      {nested && <div className="change-treemap-nested"><Cells nodes={node.children} width={Math.max(0, rect.width - 8)} height={Math.max(0, rect.height - 34)} depth={depth + 1} selected={selected} onPick={onPick} /></div>}
    </div>;
  });
}
