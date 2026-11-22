import { useNavigationDraft } from './evalHistory';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { AddExperimentComment, EvalExperiment, ExperimentComment, ExperimentCommentAnchor } from '../../../../domain/mapping/evals/experiment';
import { exportExperimentComments } from '../../../../domain/mapping/evals/experimentNodeComments';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import { selectCanvasMarquee, updateSelection } from '../../../../domain/mapping/selection/canvasSelection';
import { regionSelectionItem, diagramSelectionItem, selectionContentNodes, withSelectionNodes, type SelectionState } from '../../../../domain/mapping/selection/selectionState';
import type { SelectionHit } from '../../../../domain/mapping/selection/selectionGesture';
import { toggleNodeSelection } from '../../../../domain/mapping/selection/subtreeSelection';
import { CanvasSelectionLayer } from '../canvas/CanvasSelectionLayer';
import type { CanvasRuntime } from '../tldraw/CanvasRuntimeContext';
import { DEFAULT_CELL } from '../tldraw/shapeProjection';
import { addExperimentComment } from './evalsApi';
import { ExperimentCommentActions } from './ExperimentComments';
import { errorMessage } from './evalsFormat';
import { OutputSidebar } from './OutputSidebar';

export const OutputCommentContext = createContext<{
  experiment: EvalExperiment; runId: string; cellKey: string; activeComment?: ExperimentComment;
  onSaved: (experiment: EvalExperiment, commentId?: string) => void;
  onLeaveComment: () => void;
} | null>(null);

export function CopyExperimentComments({ experiment }: { experiment: EvalExperiment }) {
  const [status, setStatus] = useState('');
  return <><button type="button" disabled={!experiment.comments?.length} onClick={async () => {
    try { await navigator.clipboard.writeText(exportExperimentComments(experiment)); setStatus('Copied comments and selected nodes'); }
    catch { setStatus('Could not copy. Try again.'); }
  }}>Copy comments</button><span role="status" className="evals-muted">{status}</span></>;
}

export function OutputCommentsPanel() {
  const context = useContext(OutputCommentContext);
  if (!context) return null;
  const { experiment, activeComment: comment, onSaved } = context;
  return <OutputSidebar><section className="output-comments-panel" aria-label="Output comments">
    <p className="evals-muted">Ctrl + drag over diagram nodes to comment. Esc cancels.</p>
    <CopyExperimentComments experiment={experiment} />
    {comment && <article className="output-active-comment">
      <button type="button" className="evals-link" onClick={context.onLeaveComment}>Back to output</button>
      <strong>Comment</strong><p>{comment.text}</p>
      <ExperimentCommentActions key={comment.id} experimentId={experiment.id} commentId={comment.id} text={comment.text} tags={comment.tags ?? []}
        availableTags={experiment.commentTags ?? []} onSaved={onSaved} onChanged={async () => {}} />
      <details><summary>Selected nodes</summary>{comment.excerpts?.map((excerpt, i) => <section key={i}><strong>{excerpt.title}</strong><pre>{excerpt.ascii}</pre></section>)}</details>
    </article>}
  </section></OutputSidebar>;
}

/** The same gesture recognizer and node selection reducer used by the editable Mapping canvas. */
export function CanvasCommentSelection({ runtime, stageRef, canvasId, checkpointId }: {
  runtime: CanvasRuntime; stageRef: RefObject<HTMLDivElement | null>; canvasId: string; checkpointId?: string;
}) {
  const context = useContext(OutputCommentContext)!;
  const controller = runtime.controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { scene } = snapshot.document, boxes = flattenGrid(resolveScene(scene));
  const [draft, setDraft] = useState<ExperimentCommentAnchor>();
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useNavigationDraft(!!draft && !!text.trim() && !busy);
  const pending = useRef<AddExperimentComment | undefined>(undefined);
  const nodeClick = useRef<{ hit: SelectionHit; before: SelectionState; after: SelectionState } | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clear = () => { setDraft(undefined); setText(''); setError(''); pending.current = undefined; nodeClick.current = undefined;
    controller.select({ type: 'clear' }); runtime.clearDragSelection(); };
  const active = context.activeComment;
  useEffect(() => {
    controller.select({ type: 'clear' });
    runtime.clearDragSelection();
    if (active?.anchor?.canvasId !== canvasId) return;
    const items = active.anchor.selections.flatMap(selection => {
      const model = runtime.grids.get(selection.diagramId).get();
      if (!model?.diagram || model.diagram.content.revisionId !== selection.revisionId) return [];
      return [withSelectionNodes(diagramSelectionItem(selection.diagramId), model.diagram, selection.nodeIds)];
    });
    controller.select({ type: 'replace', items });
  }, [controller, active, canvasId, runtime]);
  useEffect(() => {
    if (!draft) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault(); event.stopImmediatePropagation(); clear(); stageRef.current?.focus();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [draft, busy]);
  const capture = () => {
    const selections = new Map<string, ExperimentCommentAnchor['selections'][number]>();
    for (const item of controller.getSnapshot().canvas.selection.items) {
      const model = runtime.grids.get(item.displayNodeId).get(), diagram = model?.diagram;
      if (!diagram) continue;
      const ids = selectionContentNodes(diagram, item.region).map(node => node.id);
      if (!ids.length) continue;
      const old = selections.get(item.displayNodeId);
      selections.set(item.displayNodeId, { diagramId: item.displayNodeId, revisionId: diagram.content.revisionId, nodeIds: [...new Set([...(old?.nodeIds ?? []), ...ids])] });
    }
    if (!selections.size) { clear(); return; }
    setDraft({ runId: context.runId, cellKey: context.cellKey, canvasId, ...(checkpointId ? { checkpointId } : {}), selections: [...selections.values()] });
  };
  const save = async () => {
    if (!draft || !text.trim() || busy) return;
    const input = { text: text.trim(), anchor: draft };
    if (!pending.current || pending.current.text !== input.text || pending.current.anchor !== draft)
      pending.current = { requestId: crypto.randomUUID(), ...input };
    setBusy(true); setError('');
    try {
      const saved = await addExperimentComment(context.experiment.id, pending.current);
      if (mounted.current) { const id = pending.current.requestId; clear(); context.onSaved(saved, id); }
    } catch (error) { if (mounted.current) setError(errorMessage(error)); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <>
    <CanvasSelectionLayer stageRef={stageRef} active={!busy} runtime={runtime}
      diagramIds={boxes.filter(box => box.box.kind === 'diagram').map(box => `grid:${box.box.id}`)}
      selected={snapshot.canvas.selection.items.map(item => item.displayNodeId)} onClear={clear}
      resolve={(bounds, promoted) => {
        const editor = runtime.editor, cell = controller.getSnapshot().cell ?? DEFAULT_CELL;
        if (!editor) return { diagramIds: [], regions: [] };
        const a = editor.screenToPage({ x: bounds.left, y: bounds.top }), b = editor.screenToPage({ x: bounds.right, y: bounds.bottom });
        return selectCanvasMarquee(scene, snapshot.canvas.diagramViews, { left: a.x / cell.width, top: a.y / cell.height, right: b.x / cell.width, bottom: b.y / cell.height }, promoted, boxes);
      }}
      onComplete={(selection, policy) => {
        const items = [...selection.diagramIds.map(diagramSelectionItem), ...selection.regions.flatMap(({ boxId, rect }) => {
          const model = runtime.grids.get(`grid:${boxId}`).get();
          return model?.diagram ? [regionSelectionItem(model.diagram, boxId, rect)] : [];
        })];
        controller.select({ type: policy, items }); capture();
      }}
      onSelectNode={(hit, subtree) => {
        const model = runtime.grids.get(hit.diagramId).get();
        if (!model?.diagram || !hit.nodeId || model.diagram.content.revisionId !== hit.revision) return;
        controller.updateCanvas(current => {
          const previous = nodeClick.current;
          const before = subtree && previous?.after === current.selection && previous.hit.diagramId === hit.diagramId
            && previous.hit.nodeId === hit.nodeId && previous.hit.revision === hit.revision ? previous.before : current.selection;
          const after = toggleNodeSelection(before, model.diagram!, hit.diagramId.slice(5), hit.nodeId!, subtree);
          nodeClick.current = subtree ? undefined : { hit, before, after };
          return updateSelection(current, { type: 'replace', items: after.items });
        }, true);
        if (nodeClick.current) nodeClick.current.after = controller.getSnapshot().canvas.selection;
        capture();
      }}
      onSelectDiagram={id => { controller.select({ type: 'add', items: [diagramSelectionItem(id)] }); capture(); }}
      onTap={hit => { if (!hit.nodeId) return; const model = runtime.grids.get(hit.diagramId).get(); if (!model?.diagram) return;
        controller.select({ type: 'replace', items: toggleNodeSelection(controller.getSnapshot().canvas.selection, model.diagram, hit.diagramId.slice(5), hit.nodeId).items }); capture(); }} />
    {draft && <form className="output-node-comment-editor" role="dialog" aria-label="Comment on selected nodes" onSubmit={event => { event.preventDefault(); void save(); }}
      onPointerDown={event => event.stopPropagation()}>
      <label>Comment on {draft.selections.reduce((sum, selection) => sum + selection.nodeIds.length, 0)} selected nodes
        <textarea autoFocus aria-label="Node comment" value={text} maxLength={10000} rows={4} disabled={busy} onChange={event => setText(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div><button type="submit" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save comment'}</button>
        <button type="button" disabled={busy} onClick={clear}>Cancel (Esc)</button></div>
    </form>}
  </>;
}
