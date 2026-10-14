import { DiagramTreemapTint } from '../treemap/CanvasTreemapColors';
import { memo, useContext, useMemo } from 'react';
import { useValue } from 'tldraw';
import { CanvasRuntimeContext, type GridModel } from './CanvasRuntimeContext';
import { projectDiagramContent } from '../../../../domain/mapping/workspace/diagramViewState';
import { diagramTextRanges, textRow } from '../../../../domain/core/diagrams/diagramText';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { DiagramSubtreeControls } from '../canvas/DiagramSubtreeControls';
import { useLocalAnchors } from './useLocalAnchors';

const Text = memo(function Text({ model }: { model: Pick<GridModel, 'id' | 'diagram' | 'view' | 'jumps' | 'selectedContent' | 'layoutKey'> }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const jump = useValue('diagram jump availability', () => runtime.interaction.get().jumps, [runtime]);
  const register = useLocalAnchors(runtime, model.id, model.layoutKey);
  const rows = useMemo(() => {
    const diagram = model.diagram!;
    const projection = projectDiagramContent(diagram.content, model.view);
    const ranges = diagramTextRanges({ ascii: diagram.content.ascii, content: diagram.content, displayNodeId: model.id,
      mappings: diagram.sourceContext.mappings, sourceContext: diagram.sourceContext, jumps: [...(diagram.jumps ?? []), ...model.jumps] });
    return projection.ascii.split('\n').map((line, index) => textRow(line, ranges.get(projection.sourceLines[index]) ?? [], projection.sourceLines[index]));
  }, [model.diagram, model.view, model.jumps, model.id]);
  return <DiagramText className="mapping-poc-ascii" rows={rows} data-graph="A" data-line-count={rows.length}
    data-revision={model.diagram!.revision} registerEndpoint={register}
    nodeProps={owner => model.selectedContent.includes(owner.contentNodeId!) ? { className: 'is-selected' } : undefined}
    onJump={jump ? target => runtime.actions?.jump(target) : undefined} />;
}, (a, b) => a.model.id === b.model.id && a.model.diagram === b.model.diagram && a.model.view === b.model.view
  && a.model.jumps === b.model.jumps && a.model.selectedContent === b.model.selectedContent && a.model.layoutKey === b.model.layoutKey);

export function DiagramShapeContent({ nodeId }: { nodeId: string }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const model = useValue(`diagram ${nodeId}`, () => runtime.grids.get(nodeId).get(), [runtime, nodeId]);
  const interaction = useValue('diagram controls', () => runtime.interaction.get(), [runtime]);
  const zoom = useValue('move handle screen size', () => runtime.editor?.getZoomLevel() ?? 1, [runtime]);
  if (!model) return null;
  const { frame, cell } = model;
  return <>
    {model.diagram && <><DiagramTreemapTint model={model} /><Text model={model} /></>}
    <DiagramSubtreeControls nodes={[model.node]} visibleBoxIds={new Set([frame.boxId])} cell={cell}
      disabled={interaction.subtreeDisabled} onCollapse={(id, contentId, collapsed) => runtime.actions?.collapse(id, collapsed, contentId)} />
    <div className={`mapping-grid-box${frame.kind === 'container' ? ' is-container' : ''}`}
      data-grid-box={frame.boxId} data-diagram-selected={frame.selected} data-grid-column={frame.bounds.column} data-grid-row={frame.bounds.row}
      data-grid-columns={frame.bounds.columns} data-grid-rows={frame.bounds.rows} data-collapsed={frame.collapsed}
      style={{ left: 0, top: 0, width: frame.bounds.columns * cell.width, height: frame.bounds.rows * cell.height }}>
      {frame.kind === 'diagram' && frame.selected && <button type="button" className="mapping-diagram-move-handle"
        data-diagram-move-handle={nodeId} aria-label="Move selected diagram" disabled={interaction.disabled}
        style={{ transform: `scale(${1 / zoom}) translate(calc(-100% - 6px), calc(-100% - 6px))` }}
        onClick={event => { if (event.detail === 0) runtime.actions?.move(frame.boxId); }}>↔</button>}
      {!frame.root && <div className="mapping-grid-box-tools" data-mapping-static-ui data-diagram-canvas-static-ui>
        <button type="button" disabled={interaction.disabled} aria-label={`${frame.collapsed ? 'Expand' : 'Collapse'} ${frame.boxId}`}
          onClick={() => runtime.actions?.collapse(nodeId, !frame.collapsed)}>{frame.collapsed ? 'Expand' : 'Collapse'}</button>
        <button type="button" disabled={interaction.disabled} onClick={() => runtime.actions?.move(frame.boxId)}>Move</button>
        <button type="button" disabled={interaction.disabled} onClick={() => runtime.actions?.group(frame.boxId)}>Group</button>
      </div>}
    </div>
  </>;
}
