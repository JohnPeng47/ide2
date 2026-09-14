import { SourceCodePane } from "../source-pane/SourceCodePane";
import { openSourceCodePane, updateSourceCodePane, type SourceCodePaneView } from "../source-pane/sourceCodePane";
import { useCallback, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { projectCompactions } from '../../../../domain/core/representations/compactionProjection';
import { addDisplayNode, displayGeometry, measureDisplayNode, updateDisplayGeometry, setExpansion, type DisplayState, type ProjectedPane, type SelectionRegion } from '../../../../domain/mapping/workspace/displayModel';
import { layoutProjectedPanes } from '../../../../domain/mapping/workspace/projectedPaneLayout';
import type { ResolvedGridBox, LineGridScene, GridBox } from '../../../../domain/core/diagrams/lineGrid';
import type { ProjectRepresentationCatalogRecord } from '../../../../domain/core/representations/projectCatalog';
import { DisplayPane } from './DisplayPane';

export function SelectionEffectsLayer(props: {
  state: DisplayState; setState: Dispatch<SetStateAction<DisplayState>>;
  boxes: ResolvedGridBox[]; scene: LineGridScene; cell: { width: number; height: number };
  catalog?: ProjectRepresentationCatalogRecord; dirtyRepresentationIds?: string[];
  onRemove: (id: string) => void;
  busySelectionIds: string[];
  onActivate: (root: SelectionRegion) => void;
}) {
  const [draft, setDraft] = useState<{ paneId: string; start: number; end: number; dragging: boolean } | null>(null);
  const measure = useCallback((id: string, width: number, height: number) =>
    props.setState(current => measureDisplayNode(current, id, width, height)), [props.setState]);
  // Keep source content independent of the workspace renders caused by pan and selection gestures.
  const changeSource = useCallback((id: string, patch: Partial<SourceCodePaneView>) =>
    props.setState(state => updateSourceCodePane(state, id, patch)), [props.setState]);
  useLayoutEffect(() => {
    if (!props.cell.width || !props.cell.height) return;
    props.setState(current => {
      let next = current;
      for (const id of current.rootIds) {
        const root = next.nodes[id]; if (root?.kind !== 'selection') continue;
        const box = props.boxes.find(box => box.box.id === root.sourceBoxId);
        if (box && !box.box.collapsed && props.scene.contents[root.sourceContentId]?.ascii === root.sourceAscii) {
          next = updateDisplayGeometry(next, id, {
            ...(root.geometryPolicy.placement === 'automatic' ? { position: {
              x: (box.bounds.column + root.rect.startColumn - 1) * props.cell.width,
              y: (box.bounds.row + root.rect.startLine - 1) * props.cell.height } } : {}),
            ...(root.geometryPolicy.sizing === 'content' ? { bounds: {
              width: (root.rect.endColumn - root.rect.startColumn + 1) * props.cell.width,
              height: (root.rect.endLine - root.rect.startLine + 1) * props.cell.height } } : {})
          });
        }
        next = layoutProjectedPanes(next, next.nodes[id] as SelectionRegion).state;
      }
      return next;
    });
  }, [props.state, props.setState, props.boxes, props.scene, props.cell]);
  const toggle = (id: string) => props.setState(state => setExpansion(state, id, state.nodes[id].expansion === 'expanded' ? 'collapsed' : 'expanded'));
  const openCompaction = (pane: ProjectedPane, selectedIds?: string[]) => {
    if (pane.content.kind !== 'call-tree') return;
    const projection = props.catalog?.projections?.[pane.projectionId ?? ''];
    if (!projection?.compactionProjection) return;
    const files = projectCompactions(projection.compactionProjection, selectedIds ?? pane.content.result.projectedNodeIds);
    if (!files.length) return;
    const child: ProjectedPane = { ...displayGeometry(), id: crypto.randomUUID(), kind: 'projection', childIds: [], expansion: 'expanded',
      title: 'COMPACTED SOURCE', projectionId: pane.projectionId, sourceRevisionId: pane.sourceRevisionId,
      targetRevisionId: pane.targetRevisionId, content: { kind: 'compaction', files } };
    props.setState(state => addDisplayNode(state, child, pane.id)); setDraft(null);
  };
  return <div className="selection-effects-layer" onKeyDown={event => {
    if (event.key === 'Escape' && draft) { event.stopPropagation(); setDraft(null); }
  }}>
    {Object.values(props.state.nodes).filter(node => node.kind === 'detail').map(node => node.kind === 'detail' &&
      <DisplayPane key={node.id} node={node} onMeasure={measure}
        onToggle={() => toggle(node.id)} onRemove={() => props.onRemove(node.id)}><pre>{node.ascii}</pre></DisplayPane>)}
    {props.state.rootIds.map(id => props.state.nodes[id]).filter((node): node is SelectionRegion => node?.kind === 'selection').map(root => {
      const box = props.boxes.find(box => box.box.id === root.sourceBoxId);
      const inScene = (node: GridBox): boolean => node.id === root.sourceBoxId || node.kind === 'container' && node.children.some(inScene);
      // Scene containment controls visibility; missing sources retain a recoverable snapshot.
      if (box?.box.collapsed || !box && inScene(props.scene.root)) return null;
      const missing = !box;
      const stale = props.scene.contents[root.sourceContentId]?.ascii !== root.sourceAscii;
      const rect = { ...root.position, ...root.bounds };
      const layout = layoutProjectedPanes(props.state, root);
      // Retain snapshots if their source changes, but never pretend the rectangle is still exact.
      return <div key={root.id} data-selection-root={root.id} data-source-stale={stale || missing}>
        {!missing && !stale && <div className="mapping-poc-selection-rect retained-selection" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />}
        <div className="retained-selection-controls" data-mapping-static-ui data-diagram-canvas-static-ui
          style={{ left: rect.x, top: rect.y - 27 }}>
          {(stale || missing) && <span>Source changed · saved selection</span>}
          <button type="button" disabled={stale || missing} onClick={() => props.onActivate(root)}>Actions</button>
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
            <path d={`M${x1} ${y1} H${(x1 + x2) / 2} V${y2} H${x2} m-5 -3 l5 3 -5 3`} /></svg>;
        })}
        {Object.keys(layout.placements).map(id => {
          const pane = props.state.nodes[id] as ProjectedPane;
          const parent = Object.values(props.state.nodes).find(node => node.childIds.includes(id));
          const projection = props.catalog?.projections?.[pane.projectionId ?? ''];
          const invalid = stale || missing || (pane.projectionId && (!projection
            || props.catalog?.representations[projection.sourceRepresentationId]?.currentRevisionId !== pane.sourceRevisionId
            || props.catalog?.representations[projection.targetRepresentationId]?.currentRevisionId !== pane.targetRevisionId
            || props.dirtyRepresentationIds?.includes(projection.targetRepresentationId)));
          const content = pane.content;
          const canCompact = !invalid && content.kind === 'call-tree' && !!projection?.compactionProjection
            && projectCompactions(projection.compactionProjection, content.result.projectedNodeIds).length > 0;
          const selectedIds = draft?.paneId === id && content.kind === 'call-tree'
            ? content.result.rows.slice(Math.min(draft.start, draft.end), Math.max(draft.start, draft.end) + 1).map(row => row.nodeId)
              .filter(key => content.result.projectedNodeIds.includes(key)) : undefined;
          return <DisplayPane key={id} node={pane} onToggle={() => toggle(id)} onRemove={() => props.onRemove(id)} onMeasure={measure}
            metadata={invalid ? 'Saved snapshot · source unavailable or changed' : content.kind === 'call-tree' ? content.coverage : content.kind === 'source-code' ? 'SOURCE CODE' : `${content.files.length} files`}
            actions={<>
              {parent?.kind === 'projection' && root.displayMode === 'stacked' && <button type="button" aria-label={parent.content.kind === 'compaction' ? 'Back to compactions' : 'Back to call tree'} onClick={() => props.setState(state => ({ ...state, nodes: { ...state.nodes, [parent.id]: { ...parent, activeChildId: undefined } } }))}>Back</button>}
              {content.kind === 'call-tree' && <button type="button" aria-label="Open compaction" disabled={!canCompact} onClick={() => openCompaction(pane)}>Open compaction</button>}
              {pane.childIds.length > 0 && !pane.activeChildId && root.displayMode === 'stacked' && <button type="button" aria-label="Forward to child pane" onClick={() => props.setState(state => ({ ...state, nodes: { ...state.nodes, [id]: { ...pane, activeChildId: pane.childIds.at(-1) } } }))}>Forward</button>}
            </>}>
            {content.kind === 'call-tree' ? <>
              <pre data-projected-tree tabIndex={0} onPointerDown={event => {
                if (!event.ctrlKey || event.button !== 0) return;
                event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
                const b = event.currentTarget.getBoundingClientRect();
                const row = Math.max(0, Math.min(content.result.rows.length - 1, Math.floor((event.clientY - b.top) / (b.height / content.result.rows.length))));
                setDraft({ paneId: id, start: row, end: row, dragging: true });
              }} onPointerMove={event => {
                if (!draft?.dragging || draft.paneId !== id) return;
                const b = event.currentTarget.getBoundingClientRect();
                const row = Math.max(0, Math.min(content.result.rows.length - 1, Math.floor((event.clientY - b.top) / (b.height / content.result.rows.length))));
                setDraft({ ...draft, end: row });
              }} onPointerUp={event => {
                if (draft?.paneId === id) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setDraft({ ...draft, dragging: false }); }
              }} onPointerCancel={() => setDraft(null)}>{content.result.ascii.split('\n').map((line, index) => <span key={index} className={draft?.paneId === id && index >= Math.min(draft.start, draft.end) && index <= Math.max(draft.start, draft.end) ? 'projected-row is-selected' : 'projected-row'}>{line}{index < content.result.ascii.split('\n').length - 1 ? '\n' : ''}</span>)}</pre>
              {draft?.paneId === id && !draft.dragging && <div className="projected-selection-actions"><button type="button" disabled={!canCompact || !selectedIds?.length} onClick={() => openCompaction(pane, selectedIds)}>Project selected rows</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></div>}
            </> : content.kind === 'source-code' ? <SourceCodePane id={id} content={content}
              onChange={changeSource} /> : <div data-projected-compactions>{content.files.map(file => <section key={file.sourceFile} data-compaction-file={file.sourceFile} data-compaction-rows={file.rows.filter(row => row.selected).map(row => row.treeLine).join(' ')}>
              <header className="mapping-compaction-file"><span>{file.sourceFile}</span>
                <button type="button" aria-label={`Open source ${file.sourceFile}`} disabled={!props.catalog?.projectId}
                  onClick={() => props.setState(state => openSourceCodePane(state, id, props.catalog!.projectId, file.sourceFile))}>Open source</button><small>{file.selectedLineCount} mapped rows · source snapshot {file.sourceSha256.slice(0, 8)}</small></header><pre>{file.ascii}</pre>
            </section>)}</div>}
          </DisplayPane>;
        })}
      </div>;
    })}
  </div>;
}
