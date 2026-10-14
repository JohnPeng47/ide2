import { useTreemapRegionSelection } from './useTreemapRegionSelection';
import { createContext, useContext, useMemo } from 'react';
import { projectDiagramContent } from '../../../../domain/mapping/workspace/diagramViewState';
import { treemapCanvasTiles, treemapCanvasRegions } from '../changes/treemapCanvasTiles';
import { diagramColorStyle, type TreemapDiagramColor } from '../changes/treemapDiagramColors';
import type { GridModel } from '../tldraw/CanvasRuntimeContext';

export const CanvasTreemapColors = createContext<readonly TreemapDiagramColor[] | undefined>(undefined);
export function DiagramTreemapTint({ model }: { model: GridModel }) {
  const colors = useContext(CanvasTreemapColors);
  const tintRef = useTreemapRegionSelection(colors);
  const tiles = useMemo(() => {
    if (!model.diagram || !colors?.length) return [];
    const projection = projectDiagramContent(model.diagram.content, model.view);
    // Each native shape already sits at its scene origin; these tiles stay local.
    const adapted = { rows: projection.sourceLines, rowForLine: new Map(projection.sourceLines.map((line, row) => [line, row])),
      prefixRowForNode: new Map<string, number>(), columnForLine: (_line: number, column: number) => column };
    const active = colors.filter(color => color.displayNodeId === model.id && (!model.frame.collapsed || !color.contentNodeId));
    return [
      ...treemapCanvasTiles(model.diagram.content, adapted, model.frame.bounds, active).map(tile => ({ ...tile, outline: false })),
      ...treemapCanvasRegions(model.diagram.content, adapted, model.frame.bounds, active.filter(color => color.hovered)).map(tile => ({ ...tile, outline: true })),
    ];
  }, [model, colors]);
  return <>{tiles.map(({ identity, column, row, columns, rows, outline }, index) => <div ref={index === 0 ? tintRef : undefined} data-treemap-region={outline ? undefined : identity.nodeId} key={`${outline}:${identity.position}:${column}:${row}`}
    className={outline ? "treemap-canvas-hover" : "canvas-treemap-tint"} aria-hidden="true" data-treemap-color={identity.color} data-content-node-id={identity.contentNodeId}
    data-treemap-diagram={identity.displayNodeId} data-diagram-position={identity.position}
    style={{ ...diagramColorStyle(identity.color), left: column * model.cell.width, top: row * model.cell.height,
      width: columns * model.cell.width, height: rows * model.cell.height }} />)}</>;
}
