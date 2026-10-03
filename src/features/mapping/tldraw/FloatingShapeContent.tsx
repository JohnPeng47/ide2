import { useCallback, useContext } from 'react';
import { useValue } from 'tldraw';
import { CanvasRuntimeContext } from './CanvasRuntimeContext';
import { DisplayPane } from '../canvas/DisplayPane';
import { CodePanel } from '../code-panel/CodePanel';
import { SourceCodePane } from '../source-pane/SourceCodePane';
import { updateSourceCodePane, type SourceCodePaneView } from '../source-pane/sourceCodePane';
import { LocalChatConvo } from '../chat/LocalChatConvo';
import { measureDisplayNode, setExpansion } from '../../../../domain/mapping/workspace/displayModel';

export function FloatingShapeContent({ nodeId }: { nodeId: string }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const id = nodeId.slice('floating:'.length);
  const model = useValue(`pane ${id}`, () => runtime.floats.get(id).get(), [runtime, id]);
  const catalog = useValue(`pane validity ${id}`, () => {
    const model = runtime.floats.get(id).get(), { catalog, dirtyIds } = runtime.catalog.get();
    if (model?.node.kind !== 'projection') return false;
    const pane = model.node, projection = catalog?.projections?.[pane.projectionId ?? ''];
    return !!pane.projectionId && (!projection || catalog?.representations[projection.sourceRepresentationId]?.currentRevisionId !== pane.sourceRevisionId
      || catalog?.representations[projection.targetRepresentationId]?.currentRevisionId !== pane.targetRevisionId || !!dirtyIds?.includes(projection.targetRepresentationId));
  }, [runtime, id]);
  const measure = useCallback((id: string, width: number, height: number) => runtime.updateDisplay(state => measureDisplayNode(state, id, width, height), false), [runtime]);
  const changeSource = useCallback((id: string, patch: Partial<SourceCodePaneView>) => runtime.updateDisplay(state => updateSourceCodePane(state, id, patch)), [runtime]);
  if (!model?.visible) return null;
  const { node, parent, root } = model;
  const toggle = () => runtime.updateDisplay(state => setExpansion(state, id, state.nodes[id].expansion === 'expanded' ? 'collapsed' : 'expanded'));
  if (node.kind === 'selection') return !model.missing && !model.stale && model.selected
    ? <div className="mapping-poc-selection-rect retained-selection" style={{ left: 0, top: 0, width: node.bounds.width, height: node.bounds.height }} /> : null;
  if (node.kind === 'conversation') {
    const { thread } = node, expanded = node.expansion === 'expanded';
    return <div className={`local-chat-anchor${expanded ? ' is-active' : ''}`} data-mapping-static-ui data-diagram-canvas-static-ui style={{ left: 0, top: 0 }}>
      <button type="button" className={`local-chat-bubble${thread.pending ? ' is-pending' : ''}`} data-local-chat-bubble={id}
        aria-label={`${expanded ? 'Collapse' : 'Open'} local conversation`} aria-expanded={expanded}
        onClick={() => runtime.actions?.toggleConversation(id, !expanded)}>
        <span aria-hidden="true">?</span><small>{thread.messages.filter(message => message.role === 'assistant').length}</small>
      </button>
      {expanded && node.presentation !== 'docked' && <LocalChatConvo thread={thread} displayNodeId={id} onMeasure={measure}
        style={{ left: 0, top: 0, ...(node.geometryPolicy.sizing === 'fixed' ? { width: node.bounds.width, height: node.bounds.height, maxHeight: 'none' } : {}) }}
        draft={node.draft} onDraftChange={draft => runtime.updateDisplay(state => {
          const pane = state.nodes[id]; return pane?.kind === 'conversation' ? { ...state, nodes: { ...state.nodes, [id]: { ...pane, draft } } } : state;
        })} variant={node.presentation} onClose={() => runtime.actions?.toggleConversation(id, false)}
        onSubmit={message => runtime.actions?.submit(id, message)} onVerbosityChange={value => runtime.actions?.verbosity(id, value)} onRetry={() => runtime.actions?.retry(id)} />}
    </div>;
  }
  if (node.kind === 'detail') return <DisplayPane node={node} onMeasure={measure} onToggle={toggle} onRemove={() => runtime.actions?.remove(id)}><pre>{node.ascii}</pre></DisplayPane>;
  const content = node.content;
  const invalid = model.missing || model.stale || catalog || content.kind === 'code-panel' && content.panel.revisionId !== model.sourceRevisionId;
  return <DisplayPane node={node} onToggle={toggle} onRemove={() => runtime.actions?.remove(id)} onMeasure={measure}
    metadata={invalid ? 'Saved snapshot · source unavailable or changed' : content.kind === 'call-tree' ? content.coverage : content.kind === 'code-panel' ? 'MAPPED RESOURCES' : content.kind === 'source-code' ? 'SOURCE CODE' : `${content.files.length} files`}
    actions={<>
      {parent?.kind === 'projection' && root?.displayMode === 'stacked' && <button type="button" aria-label={parent.content.kind === 'compaction' ? 'Back to compactions' : 'Back to call tree'}
        onClick={() => runtime.updateDisplay(state => ({ ...state, nodes: { ...state.nodes, [parent.id]: { ...parent, activeChildId: undefined } } }))}>Back</button>}
      {node.childIds.length > 0 && !node.activeChildId && root?.displayMode === 'stacked' && <button type="button" aria-label="Forward to child pane"
        onClick={() => runtime.updateDisplay(state => ({ ...state, nodes: { ...state.nodes, [id]: { ...node, activeChildId: node.childIds.at(-1) } } }))}>Forward</button>}
    </>}>
    {content.kind === 'code-panel' ? <CodePanel id={id} content={content} /> : content.kind === 'call-tree' ? <pre data-projected-tree>{content.result.ascii}</pre>
      : content.kind === 'source-code' ? <SourceCodePane key={`${id}:${content.sourceId}`} id={id} content={content} onChange={changeSource} />
      : <div data-projected-compactions>{content.files.map(file => <section key={file.sourceFile} data-compaction-file={file.sourceFile} data-compaction-rows={file.rows.filter(row => row.selected).map(row => row.treeLine).join(' ')}>
        <header className="mapping-compaction-file"><span>{file.sourceFile}</span><small>{file.selectedLineCount} mapped rows · source snapshot {file.sourceSha256.slice(0, 8)}</small></header><pre>{file.ascii}</pre>
      </section>)}</div>}
  </DisplayPane>;
}
