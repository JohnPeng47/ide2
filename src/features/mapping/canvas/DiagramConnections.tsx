import { endpointKey } from '../../../../domain/mapping/workspace/endpointGeometry';
import type { CanvasDisplayNode } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { connectionContentNodes, defaultArrowAppearance, getArrowLabel, type DiagramAnchor, type DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';
import { drawEdge, type FloatingBoxArrow } from '../../../../domain/mapping/workspace/connectionLayout';
import type { MappingDocumentController, ControllerSnapshot } from '../../../../domain/mapping/workspace/mappingDocumentController';
import './diagramConnections.css';

type Choice = { key: string; label: string; anchor: DiagramAnchor; rect?: { left: number; top: number; width: number; height: number } };
const keyFor = (anchor: DiagramAnchor) => JSON.stringify([anchor.displayNodeId, anchor.kind === 'box' ? null : anchor.contentNodeId]);
const sides = ['auto', 'left', 'right', 'top', 'bottom'] as const;

export function DiagramConnections({ controller, state, cell, displayNodes, svgRef, open, onOpen, onClose, disabled }: {
  displayNodes: CanvasDisplayNode[]; svgRef: RefObject<SVGSVGElement | null>;
  controller: MappingDocumentController; state: ControllerSnapshot; cell: { width: number; height: number };
  open: boolean; onOpen: () => void; onClose: () => void; disabled: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<Partial<DiagramConnection>>({ appearance: { ...defaultArrowAppearance } });
  const [picking, setPicking] = useState<'source' | 'target'>();
  const [hover, setHover] = useState<DiagramAnchor>();
  const [error, setError] = useState('');
  const { document: doc, canvas } = state;
  const selected = doc.edges.find(edge => edge.id === selectedId);
  const choices = useMemo(() => {
    const measuredRect = (anchor: DiagramAnchor) => {
      const rect = state.endpointBounds?.[endpointKey(anchor)];
      return rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : undefined;
    };
    const result: Choice[] = [];
    const visit = (box: typeof doc.scene.root) => {
      const displayNodeId = `grid:${box.id}`;
      if (box.id !== doc.scene.root.id) {
        const anchor: DiagramAnchor = { kind: 'box', displayNodeId, side: 'auto' };
        result.push({ key: keyFor(anchor), label: `${box.id} · whole box`, anchor,
          rect: measuredRect(anchor) });
      }
      if (box.kind === 'container') { box.children.forEach(visit); return; }
      const content = doc.scene.contents[box.contentId].content;
      for (const node of connectionContentNodes(content)) {
        const anchor: DiagramAnchor = { kind: 'content-node', displayNodeId, contentNodeId: node.id, revisionId: content.revisionId, side: 'auto' };
        result.push({ key: keyFor(anchor), label: `${box.id} · ${node.label} (line ${node.line})`, anchor,
          rect: measuredRect(anchor) });
      }
    };
    visit(doc.scene.root);
    return result;
  }, [doc.scene, state.endpointBounds]);
  useEffect(() => { if (!open || disabled) { setPicking(undefined); setHover(undefined); } }, [open, disabled]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation(); setPicking(undefined); setHover(undefined); onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open, onClose]);

  const edit = (edge: DiagramConnection) => { setSelectedId(edge.id); setDraft(structuredClone(edge)); setPicking(undefined); setError(''); onOpen(); };
  const create = () => { setSelectedId(undefined); setDraft({ appearance: { ...defaultArrowAppearance } }); setError(''); setPicking('source'); };
  const save = () => {
    try {
      if (!draft.source || !draft.target || !draft.appearance) throw new Error('Choose both endpoints');
      controller.transact(controller.getSnapshot().version, [{ method: selected ? 'edge-update' : 'edge-create',
        edge: { id: selected?.id ?? crypto.randomUUID(), source: draft.source, target: draft.target, appearance: draft.appearance } }]);
      setPicking(undefined); setSelectedId(undefined); setDraft({ appearance: { ...defaultArrowAppearance } }); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const preview = draft.source && (hover ?? draft.target) && draft.appearance ? {
    id: 'preview', source: draft.source, target: hover ?? draft.target!, appearance: draft.appearance
  } : undefined;
  const arrowById = new Map(displayNodes.flatMap(node => node.layout === 'floating' && node.kind === 'arrow'
    && node.value.kind === 'arrow' ? [[node.value.edgeId, node.value] as const] : []));
  const arrows = doc.edges.flatMap(edge => {
    const arrow = arrowById.get(edge.id);
    return arrow ? [{ edge, arrow }] : [];
  });
  const previewArrow = preview && drawEdge(preview, doc.scene, canvas.diagramViews, cell, state.endpointBounds ?? {});
  const renderArrow = (edge: DiagramConnection, arrow: FloatingBoxArrow, preview = false) => {
    if (!arrow.path || !arrow.source || !arrow.target) return null;
    const label = getArrowLabel(edge.appearance).text || 'Connection';
    return <g key={preview ? 'preview' : edge.id} data-connection-id={preview ? undefined : edge.id} data-connection-status={arrow.status} data-geometry-source={arrow.geometrySource}
      style={{ color: edge.appearance.color, opacity: preview ? .55 : 1 }}>
      <PanelConnector path={arrow.path} target={arrow.target} selected={selectedId === edge.id}
        dashed={edge.appearance.lineStyle === 'dashed' || arrow.status === 'proxy'} />
      {arrow.status === 'proxy' && <circle cx={arrow.source.proxy ? arrow.source.x : arrow.target.x} cy={arrow.source.proxy ? arrow.source.y : arrow.target.y} r={4} fill="currentColor" />}
      {arrow.label?.text && <text x={arrow.label.position.x} y={arrow.label.position.y}
        textAnchor="middle" fill="currentColor">{arrow.label.text}</text>}
      {!preview && <path className="diagram-connection-hit" d={arrow.path} fill="none" stroke="transparent" strokeWidth={14}
        role="button" tabIndex={disabled ? -1 : 0} aria-label={`Edit connection: ${label}`} data-mapping-static-ui data-diagram-canvas-static-ui
        onClick={() => !disabled && edit(edge)} onKeyDown={event => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.stopPropagation(); edit(edge); }
        }}><title>{label}{arrow.status === 'proxy' ? ' · attached through collapsed content' : ''}</title></path>}
    </g>;
  };
  return <>
    <svg ref={svgRef} className="diagram-connections" aria-label="Diagram connections">
      {arrows.map(({ edge, arrow }) => renderArrow(edge, arrow))}
      {open && preview && previewArrow && renderArrow(preview, previewArrow, true)}
    </svg>
    {open && picking && !disabled && choices.filter(choice => choice.rect && (picking === 'target' || choice.anchor.kind === 'content-node')).map(choice => (
      <button key={choice.key} type="button" className={`diagram-anchor-target is-${choice.anchor.kind}`} style={choice.rect}
        data-mapping-static-ui data-diagram-canvas-static-ui data-connection-anchor={choice.key}
        aria-label={`Connect ${picking}: ${choice.label}`} title={choice.label}
        onPointerEnter={() => picking === 'target' && setHover(choice.anchor)} onPointerLeave={() => setHover(undefined)}
        onClick={() => {
          setDraft(current => ({ ...current, [picking]: choice.anchor }));
          setHover(undefined); setPicking(picking === 'source' ? 'target' : undefined);
        }} />
    ))}
    {open && createPortal(<aside className="diagram-connections-panel" role="dialog" aria-label="Connections"
      data-mapping-static-ui data-diagram-canvas-static-ui>
      <header><strong>Connections</strong><button type="button" aria-label="Close connections" onClick={onClose}>×</button></header>
      <button type="button" disabled={disabled} onClick={create}>New connection</button>
      <ul>{arrows.map(({ edge, arrow }) => <li key={edge.id}><button type="button" disabled={disabled} onClick={() => edit(edge)}>
        {getArrowLabel(edge.appearance).text || `${edge.source.displayNodeId.slice(5)} → ${edge.target.displayNodeId.slice(5)}`}
        {arrow.status === 'stale' ? ' · needs reattachment' : arrow.status === 'proxy' ? ' · folded endpoint' : arrow.status === 'pending' ? ' · waiting for layout' : arrow.status === 'blocked' ? ' · endpoint boxes block the route' : ''}
      </button></li>)}</ul>
      <form onSubmit={event => { event.preventDefault(); save(); }}>
        {(['source', 'target'] as const).map(end => {
          const anchor = draft[end];
          const options = choices.filter(choice => end === 'target' || choice.anchor.kind === 'content-node');
          const selectedKey = anchor && keyFor(anchor);
          return <fieldset key={end} disabled={disabled}><legend>{end === 'source' ? 'From node' : 'To node or box'}</legend>
            <select aria-label={`Connection ${end}`} value={selectedKey ?? ''} onChange={event => {
              const next = choices.find(choice => choice.key === event.target.value)?.anchor;
              setDraft(current => ({ ...current, [end]: next })); setPicking(undefined);
            }}>
              <option value="">Choose…</option>
              {selectedKey && !options.some(option => option.key === selectedKey) && <option value={selectedKey}>Stale endpoint — choose again</option>}
              {options.map(choice => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
            </select>
            <button type="button" onClick={() => setPicking(end)}>Pick {end} on canvas</button>
            <label>Side <select aria-label={`${end} side`} value={anchor?.side ?? 'auto'} disabled={!anchor} onChange={event => setDraft(current => ({
              ...current, [end]: { ...current[end]!, side: event.target.value }
            }))}>{sides.map(side => <option key={side}>{side}</option>)}</select></label>
            <label>Position along side <input type="number" min={0} max={1} step={0.05}
              aria-label={`${end} side offset`} value={anchor?.offset ?? 0.5} disabled={!anchor}
              onChange={event => {
                const offset = event.target.valueAsNumber;
                if (Number.isFinite(offset) && offset >= 0 && offset <= 1) setDraft(current => ({ ...current, [end]: { ...current[end]!, offset } }));
              }} /></label>
          </fieldset>;
        })}
        <label>Label <input aria-label="Connection label" maxLength={120} value={draft.appearance ? getArrowLabel(draft.appearance).text : ''} disabled={disabled}
          onChange={event => setDraft(current => ({ ...current, appearance: { ...current.appearance!,
            label: { ...getArrowLabel(current.appearance!), text: event.target.value } } }))} /></label>
        <label>Color <input type="color" aria-label="Connection color" value={draft.appearance?.color ?? defaultArrowAppearance.color} disabled={disabled}
          onChange={event => setDraft(current => ({ ...current, appearance: { ...current.appearance!, color: event.target.value } }))} /></label>
        <label>Line <select aria-label="Connection line style" value={draft.appearance?.lineStyle ?? 'solid'} disabled={disabled}
          onChange={event => setDraft(current => ({ ...current, appearance: { ...current.appearance!, lineStyle: event.target.value as 'solid' | 'dashed' } }))}>
          <option value="solid">Solid</option><option value="dashed">Dashed</option>
        </select></label>
        <p role="status">{picking ? `Click a ${picking === 'source' ? 'source node' : 'destination node or box'}.` : 'Endpoints follow diagram movement and folding.'}</p>
        {error && <p role="alert">{error}</p>}
        <footer><button type="submit" disabled={disabled || !draft.source || !draft.target}>{selected ? 'Update connection' : 'Create connection'}</button>
          {selected && <button type="button" disabled={disabled} onClick={() => {
            try { controller.transact(controller.getSnapshot().version, [{ method: 'edge-remove', edgeId: selected.id }]); create(); setPicking(undefined); }
            catch (error) { setError(String(error)); }
          }}>Delete connection</button>}
        </footer>
      </form>
    </aside>, document.body)}
  </>;
}
