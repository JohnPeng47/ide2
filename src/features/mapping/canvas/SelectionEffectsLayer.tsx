import { CanvasRuntimeContext } from '../tldraw/CanvasRuntimeContext';
import type { SelectionState } from '../../../../domain/mapping/selection/selectionState';
import { SessionCodePanel } from '../code-panel/SessionCodePanel';
import type { CanvasSession } from '../workspace/canvasSession';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';
import { diagramProjection, type DiagramViews } from '../../../../domain/mapping/workspace/diagramViewState';
import { layoutFloatingSelections } from '../../../../domain/mapping/workspace/floatingBoxLayout';
import { SourceCodePane } from "../source-pane/SourceCodePane";
import { updateSourceCodePane, type SourceCodePaneView } from "../source-pane/sourceCodePane";
import { useContext, useCallback, useLayoutEffect, type Dispatch, type SetStateAction } from 'react';
import { measureDisplayNode, updateDisplayGeometry, setExpansion, type DisplayState, type ProjectedPane, type SelectionRegion } from '../../../../domain/mapping/workspace/displayModel';
import { layoutProjectedPanes } from '../../../../domain/mapping/workspace/projectedPaneLayout';
import type { ResolvedGridBox, LineGridScene, GridBox } from '../../../../domain/core/diagrams/lineGrid';
import type { ProjectRepresentationCatalogRecord } from '../../../../domain/core/representations/projectCatalog';
import { DisplayPane } from './DisplayPane';

export function SelectionEffectsLayer(props: {
  session: CanvasSession; selection: SelectionState;
  state: DisplayState; setLayoutState: Dispatch<SetStateAction<DisplayState>>; setState: Dispatch<SetStateAction<DisplayState>>;
  diagramViews?: DiagramViews; boxes: ResolvedGridBox[]; scene: LineGridScene; cell: { width: number; height: number };
  catalog?: ProjectRepresentationCatalogRecord; dirtyRepresentationIds?: string[];
  onRemove: (id: string) => void;
  busySelectionIds: string[];
  onActivate: (root: SelectionRegion) => void;
}) {
  const native = useContext(CanvasRuntimeContext);
  const measure = useCallback((id: string, width: number, height: number) =>
    props.setLayoutState(current => measureDisplayNode(current, id, width, height)), [props.setLayoutState]);
  // Keep source content independent of the workspace renders caused by pan and selection gestures.
  const changeSource = useCallback((id: string, patch: Partial<SourceCodePaneView>) =>
    props.setState(state => updateSourceCodePane(state, id, patch)), [props.setState]);
  useLayoutEffect(() => {
    if (!props.cell.width || !props.cell.height) return;
    props.setLayoutState(current => layoutFloatingSelections(current, props.boxes, props.scene, props.cell, props.diagramViews));
  }, [props.state, props.setLayoutState, props.boxes, props.scene, props.cell, props.diagramViews]);
  const toggle = (id: string) => props.setState(state => setExpansion(state, id, state.nodes[id].expansion === 'expanded' ? 'collapsed' : 'expanded'));
  return <div className="selection-effects-layer">
    {!native && Object.values(props.state.nodes).filter(node => node.kind === 'detail').map(node => node.kind === 'detail' &&
      <DisplayPane key={node.id} node={node} onMeasure={measure}
        onToggle={() => toggle(node.id)} onRemove={() => props.onRemove(node.id)}><pre>{node.ascii}</pre></DisplayPane>)}
    {props.state.rootIds.map(id => props.state.nodes[id]).filter((node): node is SelectionRegion => node?.kind === 'selection').map(root => {
      const box = props.boxes.find(box => box.box.id === root.sourceBoxId);
      const inScene = (node: GridBox): boolean => node.id === root.sourceBoxId || node.kind === 'container' && node.children.some(inScene);
      // Scene containment controls visibility; missing sources retain a recoverable snapshot.
      if (box?.box.collapsed || !box && inScene(props.scene.root)) return null;
      const selected = props.selection.items.some(item => item.id === root.id);
      if (!selected && root.childIds.length === 0) return null;
      const missing = !box;
      const stale = props.scene.contents[root.sourceContentId]?.content.ascii !== root.sourceAscii;
      if (!missing && !stale && !diagramProjection(props.scene, root.sourceBoxId, root.sourceContentId, props.diagramViews).rect(root.rect)) return null;
      const rect = { ...root.position, ...root.bounds };
      const layout = layoutProjectedPanes(props.state, root);
      // Retain snapshots if their source changes, but never pretend the rectangle is still exact.
      return <div key={root.id} data-selection-root={root.id} data-source-stale={stale || missing} data-selection-active={selected}>

        {!native && !missing && !stale && selected && <div className="mapping-poc-selection-rect retained-selection" style={{ left: native ? 0 : rect.x, top: native ? 0 : rect.y, width: rect.width, height: rect.height }} />}

        <div className="retained-selection-controls" data-mapping-static-ui data-diagram-canvas-static-ui
          style={{ left: rect.x, top: rect.y - 27 }}>
          {(stale || missing) && <span>Source changed · saved selection</span>}
          <button type="button" disabled={stale || missing} aria-keyshortcuts="A" onClick={() => props.onActivate(root)}>Actions (A)</button>
          <select aria-label="Projection display mode" value={root.displayMode} onChange={event => {
            const displayMode = event.target.value as SelectionRegion['displayMode'];
            props.setState(state => ({ ...state, nodes: { ...state.nodes, [root.id]: { ...root, displayMode } } }));
          }}><option value="stacked">Stacked</option><option value="chained">Chained</option></select>
          <button type="button" disabled={props.busySelectionIds.includes(root.id)} onClick={() => props.onRemove(root.id)} aria-label="Remove selection">×</button>
        </div>
        <button className="projection-join selection-root-join" data-mapping-static-ui data-diagram-canvas-static-ui type="button"
          style={{ left: rect.x + rect.width - 8, top: layout.axisY - 8 }}
          aria-label={root.expansion === 'expanded' ? 'Collapse selection effects' : 'Expand selection effects'}
          aria-expanded={root.expansion === 'expanded'} onClick={() => toggle(root.id)}>{root.expansion === 'expanded' ? '−' : '+'}</button>
        {layout.links.slice(1).map(link => <button key={`join-${link.id}`} className="projection-join" type="button" data-mapping-static-ui data-diagram-canvas-static-ui
          style={{ left: link.x1 - 8, top: link.y - 8 }} aria-label={props.state.nodes[link.id].expansion === 'expanded' ? 'Collapse child pane' : 'Expand child pane'}
          aria-expanded={props.state.nodes[link.id].expansion === 'expanded'} onClick={() => toggle(link.id)}>{props.state.nodes[link.id].expansion === 'expanded' ? '−' : '+'}</button>)}
        {layout.links.map(link => {
          const left = Math.min(link.x1, link.x2), top = Math.min(link.y, link.y2) - 4;
          const x1 = link.x1 - left, x2 = link.x2 - left, y1 = link.y - top, y2 = link.y2 - top;
          return <svg key={link.id} className="projection-connector" style={{ left, top, width: Math.max(1, Math.abs(x2 - x1)), height: Math.abs(y2 - y1) + 8 }} aria-hidden="true">
            <PanelConnector path={`M${x1} ${y1} H${(x1 + x2) / 2} V${y2} H${x2}`} target={{ x: x2, y: y2, side: 'left' }} /></svg>;
        })}
        {!native && Object.keys(layout.placements).map(id => {
          const pane = props.state.nodes[id] as ProjectedPane;
          const parent = Object.values(props.state.nodes).find(node => node.childIds.includes(id));
          const projection = props.catalog?.projections?.[pane.projectionId ?? ''];
          const invalid = stale || missing || (pane.content.kind === 'code-panel' && pane.content.panel.revisionId !== props.scene.contents[root.sourceContentId]?.content.revisionId) || (pane.projectionId && (!projection
            || props.catalog?.representations[projection.sourceRepresentationId]?.currentRevisionId !== pane.sourceRevisionId
            || props.catalog?.representations[projection.targetRepresentationId]?.currentRevisionId !== pane.targetRevisionId
            || props.dirtyRepresentationIds?.includes(projection.targetRepresentationId)));
          const content = pane.content;
          return <DisplayPane key={id} node={pane} onToggle={() => toggle(id)} onRemove={() => props.onRemove(id)} onMeasure={measure}
            metadata={invalid ? 'Saved snapshot · source unavailable or changed' : content.kind === 'call-tree' ? content.coverage : content.kind === 'code-panel' ? 'MAPPED RESOURCES' : content.kind === 'source-code' ? 'SOURCE CODE' : `${content.files.length} files`}
            actions={<>
              {parent?.kind === 'projection' && root.displayMode === 'stacked' && <button type="button" aria-label={parent.content.kind === 'compaction' ? 'Back to compactions' : 'Back to call tree'} onClick={() => props.setState(state => ({ ...state, nodes: { ...state.nodes, [parent.id]: { ...parent, activeChildId: undefined } } }))}>Back</button>}
              {pane.childIds.length > 0 && !pane.activeChildId && root.displayMode === 'stacked' && <button type="button" aria-label="Forward to child pane" onClick={() => props.setState(state => ({ ...state, nodes: { ...state.nodes, [id]: { ...pane, activeChildId: pane.childIds.at(-1) } } }))}>Forward</button>}
            </>}>
            {content.kind === 'code-panel' ? <SessionCodePanel id={id} session={props.session} /> : content.kind === 'call-tree' ? <pre data-projected-tree>{content.result.ascii}</pre> : content.kind === 'source-code' ? <SourceCodePane key={`${id}:${pane.content.kind === "source-code" ? pane.content.sourceId : ""}`} id={id} content={content}
              onChange={changeSource} /> : <div data-projected-compactions>{content.files.map(file => <section key={file.sourceFile} data-compaction-file={file.sourceFile} data-compaction-rows={file.rows.filter(row => row.selected).map(row => row.treeLine).join(' ')}>
              <header className="mapping-compaction-file"><span>{file.sourceFile}</span>
                <small>{file.selectedLineCount} mapped rows · source snapshot {file.sourceSha256.slice(0, 8)}</small></header><pre>{file.ascii}</pre>
            </section>)}</div>}
          </DisplayPane>;
        })}
      </div>;
    })}
  </div>;
}
