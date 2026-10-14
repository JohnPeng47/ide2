import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChangeTreemapNode } from '../../../../domain/mapping/changes/changeTreemap';
import { diagramColorStyle, treemapDiagramColors, treemapLocScale, type TreemapDiagramColor } from '../changes/treemapDiagramColors';
import { treemapTooltipPosition } from './treemapTooltipPosition';
import { treemapLayout, type TreemapRect } from '../changes/treemapLayout';
import '../changes/changeTreemap.css';
import { useColorOpacity } from '../../../shared/theme/colorOpacity';

const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const description = (node: ChangeTreemapNode, metric: 'diff' | 'source') => {
  const allocation = node.allocation;
  const shared = metric === 'diff' && allocation?.sharedLoc ? ` · ${format(allocation.sharedLoc)} shared LOC; each shared hunk split across ${allocation.minDestinations === allocation.maxDestinations ? allocation.minDestinations : `${allocation.minDestinations}–${allocation.maxDestinations}`} mapped nodes` : '';
  return `${node.label}: ${format(node.value)} ${allocation ? 'allocated' : metric === 'diff' ? 'changed' : 'source'} LOC${metric === 'diff' ? ` (+${format(node.added)} / −${format(node.deleted)})` : ''}${shared}${node.previous ? ' · previous revision' : ''}`;
};
type View = 'files' | 'diagrams';
export interface TreemapData {
  files: ChangeTreemapNode; diagrams: ChangeTreemapNode;
  actual: number; mapped: number; unmapped: number; extra: number;
}
function indexTree(root: ChangeTreemapNode) {
  const nodes = new Map<string, ChangeTreemapNode>(), parents = new Map<string, string>();
  const visit = (node: ChangeTreemapNode) => {
    nodes.set(node.id, node);
    node.children.forEach(child => { parents.set(child.id, node.id); visit(child); });
  };
  visit(root); return { nodes, parents };
}

export function TreemapContent({ data, metric, error, controls, notice, onNavigate, onCanvasColors }: {
  data?: TreemapData; metric: 'diff' | 'source'; error?: string; controls?: ReactNode; notice?: ReactNode;
  onNavigate: (node: ChangeTreemapNode) => void;
  onCanvasColors?: (colors: readonly TreemapDiagramColor[] | undefined) => void;
}) {
  const groupingKey = `${metric}-treemap-grouping`;
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(metric === 'diff' ? 'change-treemap-grouping' : groupingKey) === 'files' ? 'files' : 'diagrams'; }
    catch { return 'diagrams'; }
  });
  useEffect(() => {
    try { localStorage.setItem(metric === 'diff' ? 'change-treemap-grouping' : groupingKey, view); } catch { /* Storage can be unavailable. */ }
  }, [view, metric, groupingKey]);
  const [locations, setLocations] = useState<Record<View, { focus?: string; selected?: string }>>({ files: {}, diagrams: {} });
  const [reveal, setReveal] = useState<{ id: string; serial: number }>();
  const diagramIndex = useMemo(() => data ? indexTree(data.diagrams) : undefined, [data?.diagrams]);
  const [hoveredId, setHoveredId] = useState<string>();
  const hoverNode = useCallback((node?: ChangeTreemapNode) => setHoveredId(node?.id), []);
  const { scale: scaleMode } = useColorOpacity();
  const colors = useMemo(() => treemapDiagramColors(data?.diagrams, scaleMode), [data?.diagrams, scaleMode]);
  const publishColors = useCallback((visible: ChangeTreemapNode[]) => {
    const active = new Map(colors.diagrams.filter(color => !color.contentNodeId).map(color => [`${color.position}:aggregate`, color]));
    for (const node of visible) {
      const identity = colors.nodes.get(node.id);
      if (identity && !node.previous) active.set(`${identity.position}:${identity.direct ? 'direct' : 'aggregate'}`, identity);
    }
    const hovered = hoveredId ? colors.nodes.get(hoveredId) : undefined;
    onCanvasColors?.(view === 'diagrams' ? [...active.values()].map(identity => ({ ...identity,
      onSelect: identity.nodeId ? () => {
        const id = identity.nodeId!;
        setLocations(previous => ({ ...previous, diagrams: { selected: id,
          focus: visible.slice(1).some(node => node.id === id) ? previous.diagrams.focus : diagramIndex?.parents.get(id) } }));
        setReveal(previous => ({ id, serial: (previous?.serial ?? 0) + 1 }));
      } : undefined,
      hovered: !!hovered && identity.position === hovered.position && !!identity.direct === !!hovered.direct })).sort((a, b) => a.position - b.position || Number(!!a.direct) - Number(!!b.direct)) : undefined);
  }, [view, colors, hoveredId, diagramIndex, onCanvasColors]);
  useEffect(() => { if (!data?.[view].value || view === 'files') onCanvasColors?.(undefined); }, [data, view, onCanvasColors]);
  useEffect(() => () => onCanvasColors?.(undefined), [onCanvasColors]);
  const tree = data?.[view];
  const scale = useMemo(() => treemapLocScale(tree, scaleMode), [tree, scaleMode]);
  const index = useMemo(() => tree ? indexTree(tree) : undefined, [tree]);
  const focus = index?.nodes.get(locations[view].focus ?? '') ?? tree;
  const selected = index?.nodes.get(locations[view].selected ?? '') ?? focus;
  const breadcrumbs: ChangeTreemapNode[] = [];
  let cursor = focus;
  while (cursor && index) { breadcrumbs.unshift(cursor); cursor = index.nodes.get(index.parents.get(cursor.id) ?? ''); }
  const pick = (node: ChangeTreemapNode, zoom = false) => {
    setLocations(previous => ({ ...previous, [view]: { ...previous[view], selected: node.id, ...(zoom ? { focus: node.id } : {}) } }));
  };
  const zoomable = selected && selected.id !== focus?.id && selected.children.length > 0;
  return <div className="change-treemap-panel">
    {error && <p role="alert" className="window-panel-message">{error}</p>}
    {controls}
    <div className="change-treemap-switch" role="group" aria-label="Treemap grouping">
      <span className="change-treemap-caption">Group by</span>
      <div className="change-treemap-group-buttons">
        {(['files', 'diagrams'] as const).map(option => <button key={option} aria-pressed={view === option} onClick={() => setView(option)}>{option === 'files' ? 'Files' : 'Diagrams'}</button>)}
      </div><span className="change-treemap-area-note">Area ∝ {view === 'diagrams' ? 'allocated LOC' : metric === 'diff' ? 'added + deleted' : 'source LOC'}</span>
    </div>
    {data && <div className="change-treemap-summary" aria-label={metric === 'diff' ? 'Change LOC totals' : 'Source LOC totals'}>
      <span><small>{metric === 'diff' ? 'Actual LOC' : 'Scope LOC'}</small><strong>{format(data.actual)}</strong></span>
      <span data-tone="added"><small>Allocated LOC</small><strong>{format(data.mapped)}</strong></span>
      <span><small>Unmapped LOC</small><strong>{format(data.unmapped)}</strong></span>
      <span title="Extra attribution removed by sharing code equally across its mapped nodes."><small>Dup. discounted</small><strong>{format(data.extra)}</strong></span>
    </div>}
    {notice}
    {data && <div className="treemap-loc-legend" aria-label={`${scaleMode} blue shade scale: ${format(scale.min)} to ${format(scale.max)} LOC. Fixed while zooming.`}>
      <span>{scaleMode === 'ranked' ? 'Ranked' : 'Continuous'} · {format(scale.min)} LOC</span><i aria-hidden="true" /><span>{format(scale.max)} LOC</span>
    </div>}
    <div className="change-treemap-guide">
      <nav className="change-treemap-breadcrumbs" aria-label="Treemap path">{breadcrumbs.map((node, i) => <span key={node.id}>{i > 0 && <span aria-hidden="true"> / </span>}<button aria-current={node.id === focus?.id ? 'location' : undefined} onClick={() => pick(node, true)}>{node.label}</button></span>)}</nav>
      <nav className="change-treemap-zoom-controls" aria-label="Treemap zoom controls">
        <button disabled={!zoomable} title={zoomable ? `Zoom into ${selected.label}` : 'Select a region with children to zoom in'} onClick={() => selected && pick(selected, true)}>Zoom in</button>
        {focus && tree && focus.id !== tree.id && <>
          <button onClick={() => pick(index?.nodes.get(index.parents.get(focus.id) ?? '') ?? tree, true)}>← Zoom out</button>
          <button onClick={() => pick(tree, true)}>Reset zoom</button>
        </>}
      </nav>
    </div>
    {!data ? <p className="window-panel-message">Loading {metric === 'diff' ? 'captured changes' : 'source lines'}…</p> : focus?.value ?
      <Treemap reveal={view === 'diagrams' ? reveal : undefined} onHoverNode={hoverNode} colorForLoc={scale.color} totalLoc={data.actual} metric={metric} node={focus} onVisibleNodes={publishColors} colors={view === 'diagrams' ? colors.nodes : undefined} selected={selected?.id}
        onPick={node => { pick(node); if (node.target && !node.previous) onNavigate(node); }} />
      : <p className="window-panel-message">{metric === 'diff' ? 'No added or deleted text lines in this selection.' : 'No verified mapped source lines in this selection. Referenced files may still contain unmapped code.'}</p>}
  </div>;
}

function Treemap({ reveal, onHoverNode, colorForLoc, totalLoc, metric, node, selected, onPick, colors, onVisibleNodes }: { reveal?: { id: string; serial: number }; onHoverNode: (node?: ChangeTreemapNode) => void; colorForLoc: (loc: number) => string; totalLoc: number; metric: 'diff' | 'source'; onVisibleNodes: (nodes: ChangeTreemapNode[]) => void; colors?: ReadonlyMap<string, TreemapDiagramColor>; node: ChangeTreemapNode; selected?: string; onPick: (node: ChangeTreemapNode, zoom?: boolean) => void }) {
  const tooltipId = useId();
  const [hover, setHover] = useState<{ node: ChangeTreemapNode; anchor: DOMRect }>();
  useEffect(() => { onHoverNode(hover?.node); return () => onHoverNode(undefined); }, [hover?.node, onHoverNode]);
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
  useEffect(() => {
    if (!reveal) return;
    const tile = [...ref.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? []].find(element => element.dataset.nodeId === reveal.id);
    const target = cells.find(cell => cell.node.id === reveal.id)?.node;
    const button = tile?.querySelector('button');
    if (!button || !target) return;
    button.focus({ preventScroll: true });
    setHover({ node: target, anchor: tile!.getBoundingClientRect() });
  }, [reveal, cells]);
  return <div ref={ref} className="change-treemap-plot" aria-label={metric === 'diff' ? 'Changed LOC treemap' : 'Source LOC treemap'}>
    {cells.map(({ node, rect, nested, depth, parentId }) => {
      const identity = colors?.get(node.id);
      const color = node.kind === 'unmapped' ? undefined : identity?.color ?? colorForLoc(node.value);
      const canOpen = node.target && !node.previous;
      return <div key={node.id} className="change-treemap-cell" data-selected={selected === node.id}
        data-loc-color={color} data-treemap-color={identity?.color} data-diagram-position={identity?.position} data-treemap-kind={node.kind} data-loc={node.value} data-depth={depth} data-node-id={node.id} data-parent-id={parentId} data-nested={nested}
        style={{ ...diagramColorStyle(color), left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
        <button className={nested ? 'change-treemap-heading' : 'change-treemap-leaf'}
          aria-label={description(node, metric)} aria-describedby={hover?.node.id === node.id ? tooltipId : undefined}
          onMouseEnter={event => setHover({ node, anchor: event.currentTarget.parentElement!.getBoundingClientRect() })}
          onMouseLeave={() => setHover(undefined)}
          onFocus={event => setHover({ node, anchor: event.currentTarget.parentElement!.getBoundingClientRect() })}
          onBlur={() => setHover(undefined)} onKeyDown={event => { if (event.key === 'Escape') setHover(undefined); }}
          onClick={() => { setHover(undefined); onPick(node, node.children.length > 0); }}>
          {(nested || (rect.width > 40 && rect.height > 18)) && <span className="change-treemap-label">{node.previous ? '◌ ' : ''}{node.label}</span>}
          {(nested || (rect.width > 54 && rect.height > 36)) && <small>{format(node.value)} LOC{canOpen ? ' ↗' : node.children.length > 0 ? ' ↳' : ''}</small>}
        </button>
      </div>;
    })}
    {hover && <TreemapTooltip totalLoc={totalLoc} metric={metric} id={tooltipId} node={hover.node} anchor={hover.anchor} />}
  </div>;
}

function TreemapTooltip({ metric, id, node, anchor, totalLoc }: {
  metric: 'diff' | 'source'; id: string; node: ChangeTreemapNode; anchor: DOMRect; totalLoc: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPosition(treemapTooltipPosition(anchor, rect, { width: window.innerWidth, height: window.innerHeight }));
  }, [node, anchor, totalLoc]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="change-treemap-tooltip"
    style={position ?? { left: 0, top: 0, visibility: 'hidden' }}>
    <span>{format(node.value)} LOC · {format(totalLoc > 0 ? 100 * node.value / totalLoc : 0)}%</span>
    {metric === 'diff' && <span className="change-treemap-tooltip-diff">
      <span data-change="added" aria-label={`${format(node.added)} added`}>+{format(node.added)}</span>
      <span data-change="deleted" aria-label={`${format(node.deleted)} deleted`}>−{format(node.deleted)}</span>
    </span>}
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
