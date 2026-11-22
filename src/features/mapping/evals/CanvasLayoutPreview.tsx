import { useEvalHistory } from './evalHistory';
import { useId, useState } from 'react';
import type { CanvasLayout } from '../../../../domain/mapping/evals/canvasLayout';
import { ExperimentOutputPanel } from './ExperimentOutputPanel';
import './canvasLayoutPreview.css';

type Endpoint = CanvasLayout['edges'][number]['source'];
type LayoutDiagram = CanvasLayout['canvases'][number]['diagrams'][number];
const COLUMN = 9, LINE = 20, MARGIN = 24;

function anchor(diagram: LayoutDiagram, line: number, right: boolean) {
  return { x: (diagram.position.column + (right ? diagram.size.columns : 0)) * COLUMN,
    y: (diagram.position.row + line - 0.5) * LINE };
}

export function CanvasLayoutPreview({ layout }: { layout: CanvasLayout }) {
  const uid = useId();
  const { visit, navigation } = useEvalHistory();
  const canvasId = visit.view.layout?.canvas ?? layout.canvases[0].id;
  const [actualSize, setActualSize] = useState(false);
  const selected = visit.view.layout?.edge;
  const canvas = layout.canvases.find(c => c.id === canvasId)!;
  const index = new Map(layout.canvases.map(c => [c.id, { title: c.title, diagrams: new Map(c.diagrams.map(d => [d.id, d])) }]));
  function resolve(p: Endpoint) {
    const c = index.get(p.canvas)!, d = c.diagrams.get(p.diagram)!;
    return { canvasTitle: c.title, diagram: d, node: d.nodes.find(n => n.id === p.node)! };
  }
  const edges = layout.edges.map((e, i) => ({ ...e, i })).filter(e => e.source.canvas === canvasId || e.target.canvas === canvasId);
  const width = Math.max(...canvas.diagrams.map(d => d.position.column + d.size.columns)) * COLUMN + MARGIN * 2;
  const height = Math.max(...canvas.diagrams.map(d => d.position.row + d.size.lines)) * LINE + MARGIN * 2;
  function endpointButton(p: Endpoint, i: number) {
    const { canvasTitle, diagram, node } = resolve(p);
    return <button type="button" className="layout-endpoint" onClick={() => { navigation.update({ layout: { canvas: p.canvas, node: p.node, edge: i } }); }}>
      {p.canvas !== canvasId && canvasTitle + ' / '}{diagram.title} · {node.label} (L{node.line})
    </button>;
  }
  return <ExperimentOutputPanel title="Canvas layout">
    <div className="layout-output-controls">
      <label>Canvas <select value={canvasId} onChange={e => { navigation.update({ layout: { canvas: e.target.value } }); }}>
        {layout.canvases.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select></label>
      <span>{canvas.diagrams.length} diagrams · {edges.length} connections</span>
      <button type="button" aria-pressed={actualSize} onClick={() => setActualSize(!actualSize)}>{actualSize ? 'Fit to width' : 'Actual size'}</button>
    </div>
    <div className="layout-output-drawing" tabIndex={0}>
      <svg role="img" aria-label={canvas.title + ' diagram footprints and connections'} width={actualSize ? width : '100%'}
        viewBox={`${-MARGIN} ${-MARGIN} ${width} ${height}`} style={actualSize ? undefined : { maxWidth: width }}>
        <defs><marker id={uid + '-arrow'} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" /></marker></defs>
        {edges.filter(e => e.source.canvas === e.target.canvas).map(e => {
          const s = resolve(e.source), t = resolve(e.target);
          const sLeft = s.diagram.position.column, tLeft = t.diagram.position.column;
          const right = sLeft + s.diagram.size.columns <= tLeft;
          const left = tLeft + t.diagram.size.columns <= sLeft;
          const a = anchor(s.diagram, s.node.line, !left), b = anchor(t.diagram, t.node.line, !right);
          const mid = right || left ? (a.x + b.x) / 2 : Math.max(a.x, b.x) + MARGIN * 0.75;
          return <path key={e.i} className="layout-output-edge" data-selected={selected === e.i}
            d={`M${a.x},${a.y} H${mid} V${b.y} H${b.x}`} markerEnd={`url(#${uid}-arrow)`}><title>{e.label}</title></path>;
        })}
        {canvas.diagrams.map(d => {
          const w = d.size.columns * COLUMN, h = d.size.lines * LINE;
          const clip = uid + '-' + d.id;
          return <g key={d.id} transform={`translate(${d.position.column * COLUMN} ${d.position.row * LINE})`}>
            <title>{d.title} · {d.size.columns} columns × {d.size.lines} lines · column {d.position.column}, row {d.position.row}</title>
            <defs><clipPath id={clip}><rect width={w} height={h}/></clipPath></defs>
            <rect className="layout-output-box" width={w} height={h}/>
            <g clipPath={`url(#${clip})`}><rect className="layout-output-header" width={w} height={LINE}/>
              <text x="5" y="15" fontWeight="bold">{d.title}</text>
              {d.nodes.map(n => {
                const active = selected === undefined ? [] : [layout.edges[selected].source, layout.edges[selected].target];
                return <text key={n.id} x="5" y={(n.line - 1) * LINE + 15} data-selected={active.some(p => p.canvas === canvasId && p.diagram === d.id && p.node === n.id)}>
                  <title>{n.label} · line {n.line}</title>{n.label}</text>;
              })}
            </g>
          </g>;
        })}
      </svg>
    </div>
    <details className="layout-output-dimensions"><summary>Diagram dimensions and positions</summary>
      <ul>{canvas.diagrams.map(d => <li key={d.id}><strong>{d.title}</strong> · {d.size.lines} lines × {d.size.columns} columns · row {d.position.row}, column {d.position.column}</li>)}</ul>
    </details>
    {edges.length > 0 && <table className="layout-output-connections"><caption>Connections</caption>
      <thead><tr><th>Source node</th><th>Relation</th><th>Target node</th></tr></thead>
      <tbody>{edges.map(e => <tr key={e.i} data-selected={selected === e.i}>
        <td>{endpointButton(e.source, e.i)}</td><td>{e.label}</td><td>{endpointButton(e.target, e.i)}</td>
      </tr>)}</tbody>
    </table>}
  </ExperimentOutputPanel>;
}
