import { createContext, useContext, useMemo, type MouseEvent } from 'react';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import tree from '../../../../artifacts/experiment-map-2026-11-20/tree.txt?raw';
import canvasExpansion from '../../../../artifacts/experiment-map-2026-11-20/3plus1-canvas-expansion.txt?raw';
import diagramStyles from '../../../../artifacts/experiment-map-2026-11-20/diagram-styles.txt?raw';
import map from '../../../../artifacts/experiment-map-2026-11-20/links.json';
import './experimentHome.css';
import { experimentPhaseUrl } from './experimentPhaseLink';
import { useTreeExpansion } from './useTreeExpansion';

const LiveExperiments = createContext<ReadonlyMap<string, EvalExperiment>>(new Map());

type Alias = keyof typeof map.experiments;
type NodeId = number | string;
type MapNode = { id: NodeId; text: string; continuation: string[]; children: MapNode[]; commentTags?: string[] };
// Preserve the saved map's aliases and findings independently of sidebar order.
function parseMapTree(tree: string): MapNode[] {
  const nodes: MapNode[] = [];
  const stack: { node: MapNode; depth: number }[] = [];
  for (const [id, line] of tree.slice(tree.indexOf('+-- ')).trimEnd().split('\n').entries()) {
    const branch = /^([| ]*)[+`]-- (.*)$/.exec(line);
    if (branch) {
      const depth = branch[1].length / 4;
      const node: MapNode = { id, text: branch[2], continuation: [], children: [] };
      while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
      (stack.at(-1)?.node.children ?? nodes).push(node);
      stack.push({ node, depth });
    } else if (/[^| ]/.test(line) && stack.length) {
      const { node, depth } = stack.at(-1)!;
      node.continuation.push(line.slice((depth + 1) * 4));
    }
  }
  return nodes;
}

const views = {
  relationships: { label: 'Relationships', description: 'Nested experiments build on their parent. References point across branches. Select an experiment ID to open it.' },
  date: { label: 'By date', description: 'Ordered by creation date (UTC), oldest first and latest at the bottom. Select an experiment ID to open it.' },
  '3plus1-canvas-expansion': { label: '3+1 canvas expansion', description: 'Ghostty · Compare expansion from a single core tree with expansion from four view-specific trees.' },
  'diagram-styles': { label: 'Diagram Styles', description: 'Compare how explicit controls, written instructions, and few-shot examples shape diagrams. Dates are UTC.' },
};
export type HomeView = keyof typeof views;
export function readHomeView(value: string): HomeView {
  return Object.prototype.hasOwnProperty.call(views, value) ? value as HomeView : 'relationships';
}

const nodes = parseMapTree(tree);
const slices = {
  '3plus1-canvas-expansion': parseMapTree(canvasExpansion),
  'diagram-styles': parseMapTree(diagramStyles),
};
const tokenPattern = /(\[[^\]\n]+\]\(E\d{2}\/[^)]+\)|\[E\d{2}\])/g;
const experimentAlias = (node: MapNode) => /^\[(E\d{2})\]/.exec(node.text)?.[1] as Alias | undefined;

// Flatten only experiment nesting; keep each experiment's detail tree intact.
// Intermediate groups (notably the shared history setup) travel with their experiments.
function chronologicalNodes(source: MapNode[]): MapNode[] {
  const entries: { alias: Alias; node: MapNode }[] = [];
  const containsExperiment = (node: MapNode): boolean => !!experimentAlias(node) || node.children.some(containsExperiment);
  const details = (node: MapNode) => node.children.filter(child => !containsExperiment(child));
  const copyContext = (node: MapNode, alias: Alias): MapNode => ({
    ...node, id: `context:${alias}:${node.id}`, children: details(node).map(child => copyContext(child, alias)),
  });
  const visit = (node: MapNode, topic: string, context: MapNode[] = []) => {
    const alias = experimentAlias(node);
    if (alias) {
      const relationships = map.relationships.filter(relation => relation.from === alias && relation.placement === 'child');
      const children: MapNode[] = [
        { id: `topic:${alias}`, text: `Topic: ${topic}`, continuation: [], children: [] },
        ...relationships.map((relation, index) => ({
          id: `relationship:${alias}:${index}`,
          text: `${relation.type === 'reused-outputs-and-derived-prompt' ? 'Reuses outputs and derives prompt from' : relation.type === 'reused-outputs' ? 'Reuses outputs from' : 'Prompt derived from'} -> [${relation.to}]${relation.scope ? ` (${relation.scope})` : ''}`,
          continuation: [], children: [],
        })),
        ...context.map(group => copyContext(group, alias)),
        ...details(node),
      ];
      const date = map.experiments[alias].createdAt.slice(0, 10);
      // Keep a multi-day activity range even though ordering uses creation time.
      const title = node.text.replace(/\s{2,}(Nov \d+(?:-\d+)?)$/, (_, range: string) => range.includes('-') ? ` (${range})` : '');
      entries.push({ alias, node: { ...node, text: `${date} · ${title}`, children } });
    }
    for (const child of node.children.filter(containsExperiment)) {
      visit(child, topic, alias ? [] : [...context, node]);
    }
  };
  for (const topic of source) for (const child of topic.children.filter(containsExperiment)) visit(child, topic.text);
  return entries.sort((a, b) => map.experiments[a.alias].createdAt.localeCompare(map.experiments[b.alias].createdAt))
    .map(entry => entry.node);
}

function MapText({ text, onOpen }: { text: string; onOpen: (id: string, focusPhase?: string) => void }) {
  const live = useContext(LiveExperiments);
  const heading = /^(\d{4}-\d{2}-\d{2} · )?\[(E\d{2})\]/.exec(text);
  // Only the leading alias is markup in a heading. Render the editable name literally.
  const parts = heading ? [heading[1] ?? '', `[${heading[2]}]`, text.slice(heading[0].length)] : text.split(tokenPattern);
  const open = (event: MouseEvent<HTMLAnchorElement>, id: string, focusPhase?: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(id, focusPhase);
  };
  return <>{parts.map((part, index) => {
    if (heading && index !== 1) return part;
    const phase = /^\[([^\]]+)\]\((E\d{2})\/([^)]+)\)$/.exec(part);
    if (phase) {
      const experiment = map.experiments[phase[2] as Alias];
      if (experiment) return <a key={index} className="experiment-phase-link"
        href={experimentPhaseUrl(experiment.experimentId, phase[3])}
        title={`Open ${phase[1]} in ${live.get(experiment.experimentId)?.name ?? experiment.name}`} onClick={event => open(event, experiment.experimentId, phase[3])}>{phase[1]}</a>;
    }
    const alias = /^\[(E\d{2})\]$/.exec(part)?.[1] as Alias | undefined;
    const experiment = alias && map.experiments[alias];
    if (experiment) return <a key={index}
      className={alias === heading?.[2] ? 'experiment-home-id' : 'experiment-home-reference'}
      href={`?experiment=${encodeURIComponent(experiment.experimentId)}`}
      title={live.get(experiment.experimentId)?.name ?? experiment.name} aria-label={`${alias}: ${live.get(experiment.experimentId)?.name ?? experiment.name}`}
      onClick={event => open(event, experiment.experimentId)}>{part}</a>;
    return part;
  })}</>;
}

function MapBranch({ node, prefix = '', last, collapsed, onToggle, onOpen }: {
  node: MapNode; prefix?: string; last: boolean; collapsed: Set<NodeId>;
  onToggle: (id: NodeId) => void; onOpen: (id: string, focusPhase?: string) => void;
}) {
  const expandable = node.children.length > 0 || node.continuation.length > 0;
  const open = !collapsed.has(node.id);
  const childPrefix = prefix + (last ? '    ' : '|   ');
  const label = node.commentTags
    ? <># {node.commentTags.map(tag => <span className="experiment-home-comment-tag" key={tag}>[{tag}] </span>)}{node.text}</>
    : <MapText text={node.text} onOpen={onOpen} />;
  return <li data-map-node={node.id}>
    <div className="experiment-ascii-row">
      <span className="experiment-ascii-guide" aria-hidden="true">{prefix}{last ? '`-- ' : '+-- '}</span>
      <span className={`experiment-home-label${node.commentTags ? ' experiment-home-comment' : ''}`}>
        {expandable && <button type="button" className="experiment-ascii-toggle"
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.text.trim()}`} aria-expanded={open}
          onClick={() => onToggle(node.id)}>{open ? '[-]' : '[+]'}</button>}
        {node.children.length > 0 ? <strong className="experiment-home-heading">{label}</strong> : label}
      </span>
    </div>
    {open && <>
      {node.continuation.map((line, index) => <div key={index} className="experiment-ascii-row">
        <span className="experiment-ascii-guide" aria-hidden="true">{childPrefix}</span>
        <span className="experiment-home-label"><MapText text={line} onOpen={onOpen} /></span>
      </div>)}
      {!!node.children.length && <ul>{node.children.map((child, index) => <MapBranch key={child.id}
        node={child} prefix={childPrefix} last={index === node.children.length - 1}
        collapsed={collapsed} onToggle={onToggle} onOpen={onOpen} />)}</ul>}
    </>}
  </li>;
}

export function ExperimentHome({ experiments, view, onView, onOpen }: {
  experiments?: EvalExperiment[];
  view: HomeView;
  onView: (view: HomeView) => void;
  onOpen: (id: string, focusPhase?: string) => void;
}) {
  const slice = view === 'relationships' || view === 'date' ? undefined : slices[view];
  const expansion = useTreeExpansion(`home:${map.inspectedAt}:${view}`);
  const { treeNodes, nodeIds, byId } = useMemo(() => {
    const byId = new Map(experiments?.map(experiment => [experiment.id, experiment]));
    const project = (node: MapNode): MapNode => {
      const children = node.children.map(project);
      const alias = /^\[(E\d{2})\]/.exec(node.text)?.[1] as Alias | undefined;
      const experimentId = alias && map.experiments[alias]?.experimentId;
      const comments: MapNode[] = (experimentId ? byId.get(experimentId)?.comments ?? [] : [])
        .map(comment => ({ ...comment, tags: [...new Set((comment.tags ?? []).map(tag => tag.trim().toLowerCase()))].filter(tag => tag === 'todo' || tag === 'insight') }))
        .filter(comment => comment.tags.length > 0)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(comment => ({ id: `comment:${experimentId}:${comment.id}`, text: comment.text, commentTags: comment.tags, continuation: [], children: [] }));
      if (comments.length) {
        const id = `comments:${experimentId}`;
        children.unshift({ id, text: 'Comments', continuation: [], children: comments });
      }
      const name = experimentId && byId.get(experimentId)?.name;
      const text = alias && name && name !== map.experiments[alias].name
        ? `[${alias}] ${name}${node.text.match(/\s{2,}Nov \d+(?:-\d+)?$/)?.[0] ?? ''}`
        : node.text;
      return { ...node, text, children };
    };
    const treeNodes = slice ?? (view === 'date' ? chronologicalNodes(nodes.map(project)) : nodes.map(project));
    const collectIds = (node: MapNode): NodeId[] => [...(node.children.length || node.continuation.length ? [node.id] : []), ...node.children.flatMap(collectIds)];
    return { treeNodes, nodeIds: treeNodes.flatMap(collectIds), byId };
  }, [experiments, view, slice]);
  const collapsed = new Set(nodeIds.filter(id => !expansion.isOpen(String(id))));
  const toggle = (id: NodeId) => expansion.setOpen(String(id), collapsed.has(id));
  return <section className="experiment-home" aria-labelledby="experiment-home-title">
    <header>
      <h2 id="experiment-home-title">Experiment map</h2>
      <p className="evals-muted">{!slice && `${Object.keys(map.experiments).length} experiments · `}Map snapshot from {new Date(map.inspectedAt).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}{!slice && ' · Current todo / insight comments'}</p>
      <p className="evals-muted">{views[view].description}</p>
      <p className="evals-muted"><span className="experiment-phase-legend">Phase links</span> open and highlight a phase in its experiment.</p>
      <div className="evals-actions experiment-home-controls">
        <div className="experiment-home-views" role="group" aria-label="Experiment map view">
          {(Object.keys(views) as HomeView[]).map(key => <button key={key} type="button"
            aria-pressed={view === key} onClick={() => { if (view !== key) onView(key); }}>{views[key].label}</button>)}
        </div>
        <button type="button" className="evals-link" onClick={() => expansion.setMany(nodeIds.map(id => [String(id), true]))}>Expand all</button>
        <button type="button" className="evals-link" onClick={() => expansion.setMany(nodeIds.map(id => [String(id), false]))}>Collapse all</button>
      </div>
    </header>
    <div className="experiment-home-tree" tabIndex={0} role="region" aria-label={slice ? views[view].label : view === 'date' ? 'Experiments by creation date' : 'Experiment setups, results, and relationships'}>
      <div className="experiment-ascii-root"><strong>{slice ? views[view].label : 'Experiments'}</strong></div>
      <LiveExperiments.Provider value={byId}><ul className="experiment-ascii-tree">{treeNodes.map((node, index) => <MapBranch key={node.id}
        node={node} last={index === treeNodes.length - 1} collapsed={collapsed} onToggle={toggle} onOpen={onOpen} />)}</ul></LiveExperiments.Provider>
    </div>
    <p className="evals-muted">Finished means a saved result, not a quality score. Open an experiment for its current status.</p>
  </section>;
}
