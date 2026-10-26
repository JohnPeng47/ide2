import { DiagramAlternativeControls } from './DiagramAlternativeControls';
import { analyzeDiagramSyntax } from '../../../../domain/core/diagrams/diagramSyntaxAnalysis';
import { activeDiagramHighlights, highlightColor, highlightNodeIds } from '../../../../domain/core/diagrams/diagramHighlight';
import { DiagramTreemapTint } from '../treemap/CanvasTreemapColors';
import { memo, useCallback, useContext, useMemo } from 'react';
import { useValue } from 'tldraw';
import { CanvasRuntimeContext, type GridModel } from './CanvasRuntimeContext';
import { projectDiagramContent } from '../../../../domain/mapping/workspace/diagramViewState';
import { diagramTextRanges, textRow, type DiagramTextOwner } from '../../../../domain/core/presentation/diagramText';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { DiagramSubtreeControls } from '../canvas/DiagramSubtreeControls';
import { useLocalAnchors } from './useLocalAnchors';
import { mappingShapeId } from './shapeProjection';

const Text = memo(function Text({ model }: { model: Pick<GridModel, 'id' | 'diagram' | 'view' | 'jumps' | 'selectedContent' | 'layoutKey' | 'node'> }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const jump = useValue('diagram jump availability', () => runtime.interaction.get().jumps, [runtime]);
  const register = useLocalAnchors(runtime, model.id, model.layoutKey);
  const registerDisplayed = useCallback((owner: DiagramTextOwner, element: Element | null) => {
    if (owner.nodeRef && model.node.layout === 'grid') {
      const id = Object.entries(model.node.nodeRefs ?? {}).find(([, ref]) => ref === owner.nodeRef)?.[0];
      if (id) register({ displayNodeId: owner.displayNodeId, contentNodeId: id, revisionId: model.diagram!.content.revisionId }, element);
    } else register(owner, element);
  }, [register, model.node, model.diagram]);
  const rows = useMemo(() => {
    if (model.node.textRows) return model.node.textRows;
    const diagram = model.diagram!;
    const projection = projectDiagramContent(diagram.content, model.view);
    const settings = model.node.presentationSettings;
    const ranges = diagramTextRanges({ revisionId: diagram.revisionId, syntax: analyzeDiagramSyntax(diagram, settings?.markerRules), presentation: settings, highlights: model.node.presentation?.view.highlights, ascii: diagram.content.ascii, content: diagram.content, displayNodeId: model.id,
      mappings: diagram.sourceContext.mappings, sourceContext: diagram.sourceContext, jumps: [...(diagram.jumps ?? []), ...model.jumps] });
    return projection.ascii.split('\n').map((line, index) => textRow(line, ranges.get(projection.sourceLines[index]) ?? [], projection.sourceLines[index]));
  }, [model.diagram, model.view, model.jumps, model.id, model.node]);
  const source = model.node.layout === 'grid' ? model.node.diagram ?? model.diagram! : model.diagram!;
  const highlights = activeDiagramHighlights(source.content, source.highlights, source.revisionId);
  const whole = highlights.find(item => !item.textRange && !highlightNodeIds(item).length);
  const byNode = new Map<string, (typeof highlights)[number]>();
  for (const highlight of highlights) for (const id of highlightNodeIds(highlight))
    if (!byNode.has(id)) byNode.set(id, highlight);
  return <DiagramText style={whole ? { backgroundColor: `${highlightColor(whole.color)}33`, outline: `2px solid ${highlightColor(whole.color)}` } : undefined}
    data-highlight-id={whole?.id} className="mapping-poc-ascii" rows={rows} data-graph="A" data-line-count={rows.length}
    data-revision={model.diagram!.revision} registerEndpoint={registerDisplayed}
    nodeProps={owner => {
      const highlight = byNode.get(owner.contentNodeId!);
      return { className: model.selectedContent.includes(owner.contentNodeId!) ? 'is-selected' : undefined,
        ...(highlight ? { 'data-highlight-id': highlight.id, style: { backgroundColor: `${highlightColor(highlight.color)}55`,
          boxShadow: `inset 0 -2px ${highlightColor(highlight.color)}` } } : {}) };
    }}
    onJump={jump ? target => runtime.actions?.jump(target) : undefined} />;
}, (a, b) => a.model.id === b.model.id && a.model.diagram === b.model.diagram && a.model.view === b.model.view
  && a.model.jumps === b.model.jumps && a.model.selectedContent === b.model.selectedContent && a.model.layoutKey === b.model.layoutKey && a.model.node === b.model.node);

export function DiagramShapeContent({ nodeId }: { nodeId: string }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const model = useValue(`diagram ${nodeId}`, () => runtime.grids.get(nodeId).get(), [runtime, nodeId]);
  const interaction = useValue('diagram controls', () => runtime.interaction.get(), [runtime]);
  const zoom = useValue('move handle screen size', () => runtime.editor?.getZoomLevel() ?? 1, [runtime]);
  const dragSelected = useValue(`diagram drag selection ${nodeId}`, () => runtime.editor?.getSelectedShapeIds().includes(mappingShapeId(nodeId)) ?? false, [runtime, nodeId]);
  if (!model) return null;
  const { frame, cell } = model;
  return <>
    {model.diagram && <><DiagramTreemapTint model={model} /><Text model={model} /></>}
    {model.diagram && (frame.selected || dragSelected) && <DiagramAlternativeControls model={model} disabled={interaction.disabled} />}
    <DiagramSubtreeControls nodes={[model.node]} visibleBoxIds={new Set([frame.boxId])} cell={cell}
      disabled={interaction.subtreeDisabled} onCollapse={(id, contentId, collapsed) => runtime.actions?.collapse(id, collapsed, contentId)} />
    <div className={`mapping-grid-box${frame.kind === 'container' ? ' is-container' : ''}`}
      data-grid-box={frame.boxId} data-diagram-selected={frame.selected} data-diagram-drag-selected={dragSelected} data-grid-column={frame.bounds.column} data-grid-row={frame.bounds.row}
      data-grid-columns={frame.bounds.columns} data-grid-rows={frame.bounds.rows} data-collapsed={frame.collapsed}
      style={{ left: 0, top: 0, width: frame.bounds.columns * cell.width, height: frame.bounds.rows * cell.height }}>
      {frame.kind === 'diagram' && (frame.selected || dragSelected) && <button type="button" className="mapping-diagram-move-handle"
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
