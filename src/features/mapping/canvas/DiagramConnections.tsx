import type { RefObject } from 'react';
import type { DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';
import type { CanvasDisplayNode } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';
import './diagramConnections.css';

/** SVG measurement surface and connections for the legacy canvas renderer. */
export function DiagramConnections({ edges, displayNodes, svgRef }: {
  edges: readonly DiagramConnection[]; displayNodes: CanvasDisplayNode[]; svgRef: RefObject<SVGSVGElement | null>;
}) {
  return <svg ref={svgRef} className="diagram-connections" aria-label="Diagram connections">
    {displayNodes.flatMap(node => {
      if (node.layout !== 'floating' || node.kind !== 'arrow' || node.value.kind !== 'arrow') return [];
      const arrow = node.value, edge = edges.find(edge => edge.id === arrow.edgeId);
      if (!edge || !arrow.path || !arrow.target) return [];
      return [<g key={edge.id} data-connection-id={edge.id} data-connection-status={arrow.status} style={{ color: edge.appearance.color }}>
        <PanelConnector path={arrow.path} target={arrow.target} dashed={edge.appearance.lineStyle === 'dashed' || arrow.status === 'proxy'} />
        {arrow.label?.text && <text x={arrow.label.position.x} y={arrow.label.position.y} textAnchor="middle" fill="currentColor">{arrow.label.text}</text>}
      </g>];
    })}
  </svg>;
}
