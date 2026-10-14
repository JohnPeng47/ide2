import { diagramColorStyle, treemapDiagramColors, type TreemapCanvasColors, type TreemapDiagramColor } from './treemapDiagramColors';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeTreemapNode } from '../../../../domain/mapping/changes/changeTreemap';
import { readChangeTreemaps, type ChangeTreemapRead, type DisplayModeChange } from './changeSessionApi';
import { treemapLayout, type TreemapRect } from './treemapLayout';
import './changeTreemap.css';

const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const description = (node: ChangeTreemapNode) => {
  const allocation = node.allocation;
  const shared = allocation?.sharedLoc ? ` · ${format(allocation.sharedLoc)} shared LOC; each shared hunk split across ${allocation.minDestinations === allocation.maxDestinations ? allocation.minDestinations : `${allocation.minDestinations}–${allocation.maxDestinations}`} mapped nodes` : '';
  return `${node.label}: ${format(node.value)} ${allocation ? 'allocated' : 'changed'} LOC (+${format(node.added)} / −${format(node.deleted)})${shared}${node.previous ? ' · previous revision' : ''}`;
};
type View = 'files' | 'diagrams';
const groupingKey = 'change-treemap-grouping';
function indexTree(root: ChangeTreemapNode) {
  const nodes = new Map<string, ChangeTreemapNode>(), parents = new Map<string, string>();
  const diagrams = new Map<string, string>();
  const visit = (node: ChangeTreemapNode, diagram?: string) => {
    nodes.set(node.id, node);
    if (node.kind === 'diagram') diagram = node.label;
    if (diagram) diagrams.set(node.id, diagram);
    node.children.forEach(child => { parents.set(child.id, node.id); visit(child, diagram); });
  };
  visit(root); return { nodes, parents, diagrams };
}

export function ChangeTreemapContent({ mode, onNavigate, onCanvasColors }: {
  mode: DisplayModeChange; onCanvasColors?: (colors: TreemapCanvasColors | undefined) => void; onNavigate: (mode: DisplayModeChange) => void;
}) {
  const [data, setData] = useState<ChangeTreemapRead>(), [error, setError] = useState('');
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(groupingKey) === 'files' ? 'files' : 'diagrams'; }
    catch { return 'diagrams'; }
  });
  useEffect(() => {
    try { localStorage.setItem(groupingKey, view); } catch { /* Storage can be unavailable. */ }
  }, [view]);
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
  const colors = useMemo(() => treemapDiagramColors(data?.diagrams), [data?.diagrams]);
  const publishColors = useCallback((visible: ChangeTreemapNode[]) => {
    const active = new Set(colors.diagrams.filter(color => !color.contentNodeId));
    for (const node of visible) {
      const identity = colors.nodes.get(node.id);
      if (identity && !node.previous) active.add(identity);
    }
    // Retain preorder so deeper regions override their ancestors in the canvas tiling.
    onCanvasColors?.(view === 'diagrams' ? { sessionId: mode.sessionId,
      diagrams: colors.diagrams.filter(color => active.has(color)) } : undefined);
  }, [view, colors, mode.sessionId, onCanvasColors]);
  useEffect(() => () => onCanvasColors?.(undefined), [onCanvasColors]);
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
    <div className="change-treemap-switch" role="group" aria-label="Treemap grouping">
      <span className="change-treemap-caption">Group by</span>
      <div className="change-treemap-group-buttons">
      {(['files', 'diagrams'] as const).map(option => <button key={option} aria-pressed={view === option} onClick={() => setView(option)}>{option === 'files' ? 'Files' : 'Diagrams'}</button>)}
      </div><span className="change-treemap-area-note">{view === 'diagrams' ? 'Area ∝ allocated LOC' : 'Area ∝ added + deleted'}</span>
    </div>
    {data && <div className="change-treemap-summary" aria-label="Change LOC totals">
      <span><small>Actual LOC</small><strong>{format(data.actual)}</strong></span>
      <span data-tone="added"><small>Allocated LOC</small><strong>{format(data.mapped)}</strong></span>
      <span><small>Unmapped LOC</small><strong>{format(data.unmapped)}</strong></span>
      <span title="Extra attribution removed by dividing each hunk equally across its mapped nodes."><small>Dup. discounted</small><strong>{format(data.extra)}</strong></span>
    </div>}
    <div className="change-treemap-guide"><nav className="change-treemap-breadcrumbs" aria-label="Treemap path">{breadcrumbs.map((node, i) => <span key={node.id}>{i > 0 && <span aria-hidden="true"> / </span>}<button aria-current={node.id === focus?.id ? 'location' : undefined} onClick={() => pick(node, true)}>{node.label}</button></span>)}</nav>
    </div>
    {!data ? <p className="window-panel-message">Loading captured changes…</p> : focus?.value ? <>
      <Treemap node={focus} totalLoc={data.actual} diagramNames={index?.diagrams} onVisibleNodes={publishColors} colors={view === 'diagrams' ? colors.nodes : undefined} selected={selected?.id} onPick={(node, zoom) => {
        if (node.target && !node.previous) { pick(node); navigate(node); }
        else pick(node, zoom);
      }} />
      <label className="change-treemap-region-picker"><span>Inspect region</span> <select aria-label="Inspect treemap region" value={selected?.id ?? focus.id} onChange={event => { const node = index?.nodes.get(event.target.value); if (node) pick(node); }}>
        <option value={focus.id}>{focus.label} · {format(focus.value)} LOC</option>
        {focus.children.map(node => <option key={node.id} value={node.id}>{node.label} · {format(node.value)} LOC</option>)}
        {selected && selected.id !== focus.id && !focus.children.some(n => n.id === selected.id) && <option value={selected.id}>{selected.label} · {format(selected.value)} LOC</option>}
      </select></label>
    </> : <p className="window-panel-message">{view === 'diagrams' && data.actual ? 'No captured hunks are mapped to diagram nodes. The file map still shows all changes.' : 'No added or deleted text lines in this selection.'}</p>}

  </div>;
  return <div className="change-treemap-panel">
    {error && <p role="alert" className="window-panel-message">{error}</p>}
    {focus && tree && focus.id !== tree.id && <nav className="change-treemap-zoom-controls" aria-label="Treemap zoom controls">
      <button onClick={() => pick(index?.nodes.get(index.parents.get(focus.id) ?? '') ?? tree, true)}>← Zoom out</button>
      <button onClick={() => pick(tree, true)}>Reset zoom</button>
      <span title={focus.label}>{focus.label}</span>
    </nav>}
    {map}
    {selected && <section className="change-treemap-selection" aria-label="Selected treemap region" title={description(selected)}
      data-treemap-color={view === 'diagrams' ? colors.nodes.get(selected.id)?.color : undefined}
      style={diagramColorStyle(view === 'diagrams' ? colors.nodes.get(selected.id)?.color : undefined)}>
      <div className="change-treemap-selection-title"><small>Region</small><strong>{selected.label}</strong></div>
      <dl className="change-treemap-selection-stats">
        <div><dt>Kind</dt><dd>{selected.kind}</dd></div>
        <div><dt>{selected.allocation ? 'Allocated LOC' : 'Changed LOC'}</dt><dd>{format(selected.value)}</dd></div>
        <div data-tone="added"><dt>Added</dt><dd>+{format(selected.added)}</dd></div>
        <div data-tone="deleted"><dt>Deleted</dt><dd>−{format(selected.deleted)}</dd></div>
      </dl>
      {(!!selected.children.length || (selected.target && !selected.previous)) && <div className="change-treemap-selection-actions">
        {!!selected.children.length && <button onClick={() => pick(selected, true)}>Zoom into region</button>}
        {selected.target && !selected.previous && <button className="change-treemap-open" onClick={() => navigate(selected)}>Open in canvas ↗</button>}
      </div>}
    </section>}
    {data && <footer className="change-treemap-footnote">
      <p>Area = changed LOC · Dashed frame = group</p>
      {view === 'diagrams' && <p>Node background colors match their canvas subtrees. Each hunk’s changed LOC is divided equally across its mapped nodes. Unmapped changes keep their full area.</p>}
      {data.unresolvedTargets > 0 && <p>{data.unresolvedTargets} diagram destinations could not be resolved in the captured snapshots.</p>}
      {data.nonTextHunks > 0 && <p>{data.nonTextHunks} binary / metadata changes · no LOC area</p>}
    </footer>}
  </div>;
}

function Treemap({ node, totalLoc, diagramNames, selected, onPick, colors, onVisibleNodes }: { totalLoc: number; diagramNames?: ReadonlyMap<string, string>; onVisibleNodes: (nodes: ChangeTreemapNode[]) => void; colors?: ReadonlyMap<string, TreemapDiagramColor>; node: ChangeTreemapNode; selected?: string; onPick: (node: ChangeTreemapNode, zoom?: boolean) => void }) {
  const tooltipId = useId();
  const [hover, setHover] = useState<{ node: ChangeTreemapNode; x: number; y: number }>();
  useEffect(() => {
    const clear = () => setHover(undefined);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);
    return () => { window.removeEventListener('scroll', clear, true); window.removeEventListener('resize', clear); };
  }, []);
  useEffect(() => setHover(undefined), [node]);
  const ref = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const cells = useMemo(() => presentationCells(node.children.length ? node.children : [node], size.width, size.height), [node, size]);
  useEffect(() => { onVisibleNodes([node, ...cells.map(cell => cell.node)]); }, [node, cells, onVisibleNodes]);
  return <div ref={ref} className="change-treemap-plot" aria-label="Changed LOC treemap">
    {cells.map(({ node, rect, nested, depth, parentId }) => {
      const identity = colors?.get(node.id);
      const canOpen = node.target && !node.previous;
      return <div key={node.id} className="change-treemap-cell" data-selected={selected === node.id}
        data-treemap-color={identity?.color} data-diagram-position={identity?.position} data-treemap-kind={node.kind} data-loc={node.value} data-depth={depth} data-node-id={node.id} data-parent-id={parentId} data-nested={nested}
        style={{ ...diagramColorStyle(identity?.color), left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
        <button className={nested ? 'change-treemap-heading' : 'change-treemap-leaf'}
          aria-label={description(node)} aria-describedby={hover?.node.id === node.id ? tooltipId : undefined}
          onMouseEnter={event => setHover({ node, x: event.clientX, y: event.clientY })}
          onMouseLeave={() => setHover(undefined)}
          onFocus={event => { const rect = event.currentTarget.getBoundingClientRect(); setHover({ node, x: rect.left, y: rect.bottom }); }}
          onBlur={() => setHover(undefined)} onKeyDown={event => { if (event.key === 'Escape') setHover(undefined); }}
          onClick={() => { setHover(undefined); onPick(node, node.children.length > 0); }}>
          {(nested || (rect.width > 40 && rect.height > 18)) && <span className="change-treemap-label">{node.previous ? '◌ ' : ''}{node.label}</span>}
          {(nested || (rect.width > 54 && rect.height > 36)) && <small>{format(node.value)} LOC{canOpen ? ' ↗' : node.children.length > 0 ? ' ↳' : ''}</small>}
        </button>
      </div>;
    })}
    {hover && <TreemapTooltip id={tooltipId} node={hover.node} diagramName={diagramNames?.get(hover.node.id)} totalLoc={totalLoc} x={hover.x} y={hover.y} />}
  </div>;
}

function TreemapTooltip({ id, node, diagramName, totalLoc, x, y }: {
  id: string; node: ChangeTreemapNode; diagramName?: string; totalLoc: number; x: number; y: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x + 12, top: y + 16 });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x + 12, window.innerWidth - rect.width - 8)),
      top: Math.max(8, y + 16 + rect.height <= window.innerHeight - 8 ? y + 16 : y - rect.height - 12) });
  }, [node, diagramName, x, y]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="change-treemap-tooltip" style={position}>
    <strong>{diagramName ?? node.label}</strong>
    {diagramName && diagramName !== node.label && <span>{node.label}</span>}
    <span><b>{format(totalLoc > 0 ? 100 * node.value / totalLoc : 0)}%</b> of total changed LOC · {format(node.value)} LOC</span>
    <span className="change-treemap-tooltip-diff">
      <span data-change="added">+{format(node.added)} added</span>
      <span data-change="deleted">−{format(node.deleted)} deleted</span>
    </span>
  </div>, document.body);
}

interface PresentationCell { node: ChangeTreemapNode; rect: TreemapRect; nested: boolean; depth: number; parentId?: string }
/** Render in one coordinate space. Children share their parent's side/bottom edges;
 * only a 22px heading is reserved. Snap shared edges, never widths independently. */
function presentationCells(nodes: ChangeTreemapNode[], width: number, height: number): PresentationCell[] {
  const cells: PresentationCell[] = [];
  const visit = (nodes: ChangeTreemapNode[], width: number, height: number, x: number, y: number, depth: number, parentId?: string) => {
    for (const { node, rect } of treemapLayout(nodes, width, height)) {
      const left = Math.round(x + rect.x), top = Math.round(y + rect.y);
      const right = Math.round(x + rect.x + rect.width), bottom = Math.round(y + rect.y + rect.height);
      const snapped = { x: left, y: top, width: right - left, height: bottom - top };
      if (snapped.width <= 0 || snapped.height <= 0) continue;
      const nested = depth < 2 && node.children.length > 0 && rect.width > 140 && rect.height > 100;
      cells.push({ node, rect: snapped, nested, depth, parentId });
      if (nested) visit(node.children, snapped.width, snapped.height - 22, left, top + 22, depth + 1, node.id);
    }
  };
  visit(nodes, Math.round(width), Math.round(height), 0, 0, 0);
  return cells;
}
