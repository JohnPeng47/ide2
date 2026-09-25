import { useMappingServices } from '../services/MappingServices';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { ChangeSessionDocument } from '../../../../domain/mapping/changes/diagramChangeSession';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
import { DraggableDiagramCanvas } from '../../../shared/diagrams/DraggableDiagramCanvas';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';
import { DiagramSubtreeControls } from '../canvas/DiagramSubtreeControls';
import { useEndpointGeometry } from '../canvas/useEndpointGeometry';
import { readChangeSession, type DisplayModeChange } from './changeSessionApi';
import { changePreviewText, type PreviewTextRun } from './changePreviewText';
import type { SearchDocument } from '../search/diagramSearchService';
import { SearchHighlight, type DiagramFocus } from '../search/SearchHighlight';
import '../canvas/diagramConnections.css';
import './changeSessions.css';

export function ChangeSessionPreview(props: { mode: DisplayModeChange; onSelect: (mode: DisplayModeChange) => void;
  onSearchDocument?: (document: SearchDocument) => void; searchFocus?: DiagramFocus;
  }) {
  const [session, setSession] = useState<Awaited<ReturnType<typeof readChangeSession>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    setSession(undefined); setError('');
    const refresh = async () => {
      try { const next = await readChangeSession(props.mode.sessionId, abort.signal);
        if (!abort.signal.aborted) { setSession(old => old?.id === next.id && old.version === next.version ? old : next); setError(''); } }
      catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (!abort.signal.aborted) timer = setTimeout(refresh, 2000); }
    };
    void refresh(); return () => { abort.abort(); clearTimeout(timer); };
  }, [props.mode.sessionId]);
  const doc = session?.documents.find(d => d.id === props.mode.documentId);
  useEffect(() => {
    if (doc && session?.id === props.mode.sessionId) props.onSearchDocument?.({
      id: `proposal:${session.id}:${doc.id}`, name: `${doc.name} (proposal)`, scope: 'proposal', document: doc.proposed.document
    });
  }, [doc, session?.id, props.mode.sessionId, props.onSearchDocument]);
  const change = session?.changes.find(c => c.id === props.mode.changeId);
  const diff = useMemo(() => doc ? diffChangeDocument(doc) : undefined, [doc]);
  const modifiedDiagramIds = useMemo(() => new Set(session?.changes.flatMap(change =>
    change.documentId === doc?.id && change.type === 1 && change.nodeId ? [change.nodeId] : [])), [session, doc?.id]);
  return <div className="change-session-preview" data-change-session={props.mode.sessionId}>
    {error && <p className="change-preview-message" role="alert">{error}</p>}
    {doc
      ? <PreviewCanvas key={`${session!.id}:${doc.id}:${doc.version}`} doc={doc}
          searchFocus={props.searchFocus}
          diff={diff!} modifiedDiagramIds={modifiedDiagramIds}
          focusId={change?.nodeId} serial={props.mode.serial} onJump={target => {
            const destination = session!.documents.find(d => d.representationId === target.representationId || d.id === target.representationId);
            if (!destination) { setError('Linked canvas is outside this change session'); return; }
            props.onSelect({ ...props.mode, documentId: destination.id, changeId: session!.changes.find(c => c.documentId === destination.id && c.nodeId === target.displayNodeId)?.id, serial: props.mode.serial + 1 });
          }} />
      : <p className="change-preview-message">{session ? 'Select a canvas in Changes.' : 'Loading preview…'}</p>}
  </div>;
}
function PreviewCanvas({ doc, focusId, serial, onJump, diff, modifiedDiagramIds, searchFocus }: { doc: ChangeSessionDocument; focusId?: string; serial: number; searchFocus?: DiagramFocus;
  diff: ReturnType<typeof diffChangeDocument>; modifiedDiagramIds: ReadonlySet<string>;
  onJump: NonNullable<Parameters<typeof DiagramText>[0]['onJump']> }) {
  const { diagrams } = useMappingServices();
  const controller = useMemo(() => {
    const state = structuredClone(doc.proposed);
    // Preview folds are local to this viewer; opening a change starts with visible content.
    const expand = (box: typeof state.document.scene.root): typeof box => box.kind === 'container'
      ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
    state.document.scene.root = expand(state.document.scene.root); state.canvas.diagramViews = {};
    return new MappingDocumentController(state.document, state.canvas, doc.version, undefined, {}, undefined, diagrams);
  }, [doc.id, doc.version, diagrams]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    const result = searchFocus?.search;
    if (!result) return;
    controller.updateCanvas(current => {
      const view = current.diagramViews?.[result.displayNodeId];
      const content = controller.nodes().find(node => node.id === result.displayNodeId);
      if (!view || content?.layout !== 'grid' || content.content?.structure.kind !== 'tree'
        || content.content.revisionId !== result.revisionId || content.content.asciiSha256 !== result.asciiSha256) return current;
      const nodes = content.content.structure.nodes;
      return { ...current, diagramViews: { ...current.diagramViews, [result.displayNodeId]: { ...view,
        collapsedContentNodeIds: view.collapsedContentNodeIds.filter(id => !nodes[id]?.foldRanges.some(range => range.startLine <= result.line && range.endLine >= result.line)) } } };
    });
  }, [controller, searchFocus]);
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
  const scene = state.document.scene;
  const text = useMemo(() => changePreviewText(scene, state.canvas.diagramViews, diff.diagrams, modifiedDiagramIds),
    [scene, state.canvas.diagramViews, diff, modifiedDiagramIds]);
  const { resolved, boxes } = text;
  const nodes = controller.nodes();
  const controlNodes = nodes.map(node => {
    if (node.layout !== 'grid' || node.kind !== 'diagram') return node;
    const bounds = boxes.find(box => box.box.id === node.boxId)?.bounds, projection = text.projections.get(node.id);
    if (!bounds || !projection) return node;
    return { ...node, geometry: { ...node.geometry, bounds }, collapsible: { ...node.collapsible,
      subtrees: node.collapsible.subtrees.map(target => ({ ...target,
        visibleRow: projection.prefixRowForNode.get(target.contentNodeId) ?? projection.rowForLine.get(target.line),
        branchColumn: projection.columnForLine(target.line, target.branchColumn) })) } };
  });
  const focusBox = useMemo(() => searchFocus ?? (focusId?.startsWith('grid:') ? { id: focusId.slice(5), serial } : undefined), [focusId, serial, searchFocus]);
  return <DraggableDiagramCanvas enabled resetKey={doc.id} className="mapping-poc-canvas" leftInset={340}
    focusBox={focusBox}>
    <div className="change-preview-stage" style={{ position: 'relative', width: resolved.bounds.columns * cell.width, height: resolved.bounds.rows * cell.height }}>
      {searchFocus?.search && (() => {
        const result = searchFocus.search, projection = text.projections.get(result.displayNodeId);
        const box = boxes.find(box => box.box.id === searchFocus.id);
        const row = projection?.rowForLine.get(result.line);
        return <SearchHighlight focus={searchFocus} content={box?.box.kind === 'diagram' ? scene.contents[box.box.contentId].content : undefined}
          origin={box?.bounds} row={row} cell={cell} columnFor={column => {
            const run = row === undefined ? undefined : projection?.rows[row]?.runs.find(run => run.owner &&
              run.start - run.owner.columnOffset <= column && run.end - run.owner.columnOffset > column);
            return run?.owner ? column + run.owner.columnOffset : projection?.columnForLine(result.line, column) ?? column;
          }} />;
      })()}
      <DiagramText ref={pre} className="mapping-poc-ascii" rows={text.rows} registerEndpoint={geometry.registerEndpoint} onJump={onJump}
        renderRun={run => (run as PreviewTextRun).diffStatus === 'removed'
          ? <span className="change-diff-removed" data-diff-status="removed">{run.text}</span>
          : (run as PreviewTextRun).diffVersion
          ? <span className="change-diff-modified" data-diff-status="modified" data-diff-version={(run as PreviewTextRun).diffVersion}>{run.text}</span>
          : run.text}
        nodeProps={owner => {
          if (!modifiedDiagramIds.has(owner.displayNodeId)) return;
          const side = diff.diagrams.get(owner.displayNodeId)?.proposed;
          const change = owner.contentNodeId ? side?.nodes.get(owner.contentNodeId) : undefined;
          const status = owner.contentNodeId ? change?.status : side?.lines.get(owner.sourceLine);
          if (!status && !change?.moved && !change?.containsChanges) return;
          return { className: [status && `change-diff-${status}`, change?.moved && 'change-diff-moved',
            change?.containsChanges && !status && !change.moved && 'change-diff-descendants'].filter(Boolean).join(' '),
            'data-diff-status': status, 'data-diff-moved': change?.moved || undefined, 'data-diff-descendants': change?.containsChanges || undefined,
            'data-diff-version': status === 'modified' ? 'current' : undefined,
            title: [status && `${status[0].toUpperCase()}${status.slice(1)}`, change?.moved && 'Moved or reparented',
              change?.containsChanges && 'Changes inside subtree'].filter(Boolean).join(' · ') };
        }} />
      {boxes.map(({ box, bounds }) => <div key={box.id} data-grid-box={box.id}
        ref={element => geometry.registerEndpoint({ displayNodeId: `grid:${box.id}` }, element)}
        className={`change-preview-box${focusId === `grid:${box.id}` ? ' is-change-target' : ''}`}
        style={{ left: bounds.column * cell.width, top: bounds.row * cell.height, width: bounds.columns * cell.width, height: bounds.rows * cell.height }} />)}
      <DiagramSubtreeControls nodes={controlNodes} visibleBoxIds={new Set(boxes.map(b => b.box.id))} cell={cell} disabled={false}
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
