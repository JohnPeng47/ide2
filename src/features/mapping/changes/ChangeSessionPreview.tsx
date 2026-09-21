import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import { diagramSceneText } from '../../../../domain/mapping/workspace/diagramSceneText';
import type { ChangeSessionDocument } from '../../../../domain/mapping/changes/diagramChangeSession';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
import { DraggableDiagramCanvas } from '../../../shared/diagrams/DraggableDiagramCanvas';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';
import { DiagramSubtreeControls } from '../canvas/DiagramSubtreeControls';
import { useEndpointGeometry } from '../canvas/useEndpointGeometry';
import { readChangeSession, type DisplayModeChange } from './changeSessionApi';
import '../canvas/diagramConnections.css';
import './changeSessions.css';

export function ChangeSessionPreview(props: { mode: DisplayModeChange; onClose: () => void; onSelect: (mode: DisplayModeChange) => void }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof readChangeSession>>>();
  const [comparison, setComparison] = useState<'original'|'proposed'>('proposed');
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setSession(undefined); setError(''); setComparison('proposed');
    const refresh = async () => {
      try { const next = await readChangeSession(props.mode.sessionId, abort.signal);
        if (!abort.signal.aborted) { setSession(old => old?.id === next.id && old.version === next.version ? old : next); setError(''); } }
      catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(refresh, 2000); }
    };
    void refresh(); return () => { abort.abort(); clearTimeout(timer); };
  }, [props.mode.sessionId]);
  const doc = session?.documents.find(d => d.id === props.mode.documentId);
  const change = session?.changes.find(c => c.id === props.mode.changeId);
  const diff = useMemo(() => doc ? diffChangeDocument(doc) : undefined, [doc]);
  const modifiedDiagramIds = useMemo(() => new Set(session?.changes.flatMap(change =>
    change.documentId === doc?.id && change.type === 1 && change.nodeId ? [change.nodeId] : [])), [session, doc?.id]);
  return <div className="change-session-preview" data-change-session={props.mode.sessionId}>
    <div className="change-preview-toolbar" data-diagram-canvas-static-ui>
      <button aria-pressed={comparison === 'original'} onClick={() => setComparison('original')}>Original</button>
      <button aria-pressed={comparison === 'proposed'} onClick={() => setComparison('proposed')}>Proposed</button>
      <button onClick={props.onClose}>Return to diagrams</button>
    </div>
    {error && <p className="change-preview-message" role="alert">{error}</p>}
    {doc && (comparison !== 'original' || doc.baseline)
      ? <PreviewCanvas key={`${session!.id}:${doc.id}:${doc.version}:${comparison}`} doc={doc} comparison={comparison}
          diff={diff!} modifiedDiagramIds={modifiedDiagramIds}
          focusId={change?.nodeId} serial={props.mode.serial} onJump={target => {
            const destination = session!.documents.find(d => d.representationId === target.representationId || d.id === target.representationId);
            if (!destination) { setError('Linked canvas is outside this change session'); return; }
            props.onSelect({ ...props.mode, documentId: destination.id, changeId: session!.changes.find(c => c.documentId === destination.id && c.nodeId === target.displayNodeId)?.id, serial: props.mode.serial + 1 });
          }} />
      : <p className="change-preview-message">{doc ? 'This is a new canvas; there is no original version.' : session ? 'Select a canvas in Changes.' : 'Loading preview…'}</p>}
  </div>;
}
function PreviewCanvas({ doc, comparison, focusId, serial, onJump, diff, modifiedDiagramIds }: { doc: ChangeSessionDocument; comparison: 'original'|'proposed'; focusId?: string; serial: number;
  diff: ReturnType<typeof diffChangeDocument>; modifiedDiagramIds: ReadonlySet<string>;
  onJump: NonNullable<Parameters<typeof DiagramText>[0]['onJump']> }) {
  const controller = useMemo(() => {
    const state = structuredClone(comparison === 'original' ? doc.baseline! : doc.proposed);
    // Preview folds are local to this viewer; opening a change starts with visible content.
    const expand = (box: typeof state.document.scene.root): typeof box => box.kind === 'container'
      ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
    state.document.scene.root = expand(state.document.scene.root); state.canvas.diagramViews = {};
    return new MappingDocumentController(state.document, state.canvas, doc.version, undefined, {});
  }, [doc.id, doc.version, comparison]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const geometry = useEndpointGeometry(controller, true);
  const [cell, setCell] = useState({ width: 8, height: 18.2 });
  const pre = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      if (!pre.current) return;
      const style = getComputedStyle(pre.current), context = document.createElement('canvas').getContext('2d')!;
      context.font = style.font;
      const width = context.measureText('0000000000').width / 10, height = parseFloat(style.lineHeight);
      if (width > 0 && height > 0) setCell(old => old.width === width && old.height === height ? old : { width, height });
    };
    measure(); document.fonts.addEventListener('loadingdone', measure);
    return () => document.fonts.removeEventListener('loadingdone', measure);
  }, []);
  const scene = state.document.scene, resolved = resolveScene(scene), boxes = flattenGrid(resolved);
  const text = useMemo(() => diagramSceneText(scene, state.canvas.diagramViews), [scene, state.canvas.diagramViews]);
  const nodes = controller.nodes();
  const focusBox = useMemo(() => focusId?.startsWith('grid:') ? { id: focusId.slice(5), serial } : undefined, [focusId, serial]);
  return <DraggableDiagramCanvas enabled resetKey={`${doc.id}:${comparison}`} className="mapping-poc-canvas" leftInset={340}
    focusBox={focusBox}>
    <div className="change-preview-stage" style={{ position: 'relative', width: resolved.bounds.columns * cell.width, height: resolved.bounds.rows * cell.height }}>
      <DiagramText ref={pre} className="mapping-poc-ascii" rows={text.rows} registerEndpoint={geometry.registerEndpoint} onJump={onJump}
        nodeProps={owner => {
          if (!modifiedDiagramIds.has(owner.displayNodeId)) return;
          const side = diff.diagrams.get(owner.displayNodeId)?.[comparison];
          const change = owner.contentNodeId ? side?.nodes.get(owner.contentNodeId) : undefined;
          const status = owner.contentNodeId ? change?.status : side?.lines.get(owner.sourceLine);
          if (!status && !change?.moved && !change?.containsChanges) return;
          return { className: [status && `change-diff-${status}`, change?.moved && 'change-diff-moved',
            change?.containsChanges && !status && !change.moved && 'change-diff-descendants'].filter(Boolean).join(' '),
            'data-diff-status': status, 'data-diff-moved': change?.moved || undefined, 'data-diff-descendants': change?.containsChanges || undefined,
            title: [status && `${status[0].toUpperCase()}${status.slice(1)}`, change?.moved && 'Moved or reparented',
              change?.containsChanges && 'Changes inside subtree'].filter(Boolean).join(' · ') };
        }} />
      {boxes.map(({ box, bounds }) => <div key={box.id} data-grid-box={box.id}
        ref={element => geometry.registerEndpoint({ displayNodeId: `grid:${box.id}` }, element)}
        className={`change-preview-box${focusId === `grid:${box.id}` ? ' is-change-target' : ''}`}
        style={{ left: bounds.column * cell.width, top: bounds.row * cell.height, width: bounds.columns * cell.width, height: bounds.rows * cell.height }} />)}
      <DiagramSubtreeControls nodes={nodes} visibleBoxIds={new Set(boxes.map(b => b.box.id))} cell={cell} disabled={false}
        onCollapse={(nodeId, contentNodeId, collapsed) => controller.transact(controller.getSnapshot().version, [{ method: 'collapse', nodeId, contentNodeId, collapsed }])} />
      <svg className="diagram-connections" ref={geometry.svgRef} aria-label="Preview connections">
        {nodes.flatMap(node => {
          if (node.layout !== 'floating' || node.value.kind !== 'arrow') return [];
          const arrow = node.value, edge = state.document.edges.find(e => e.id === arrow.edgeId)!;
          if (!arrow.path || !arrow.target || !arrow.source) return [];
          return <g key={node.id} style={{ color: edge.appearance.color }} data-preview-edge={edge.id}>
            <PanelConnector path={arrow.path} target={arrow.target} dashed={edge.appearance.lineStyle === 'dashed' || arrow.status === 'proxy'} />
            <text fill={edge.appearance.color ?? '#88c0d0'} x={(arrow.source.x + arrow.target.x)/2} y={(arrow.source.y + arrow.target.y)/2 - 8}>{edge.appearance.label}</text>
          </g>;
        })}
      </svg>
    </div>
  </DraggableDiagramCanvas>;
}
