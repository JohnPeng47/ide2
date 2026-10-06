import { changeMigrationPreview, migrationMarkKey, type MigrationPreview } from './changeMigrationPreview';
import { useDiffTreeData } from './diffTreeData';
import { diffTreeCoverage, diagramCoverage, coverageLabel, coverageTitle, type DiffCoverage } from './diffTreeCoverage';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { ChangePreviewState } from './changePreviewState';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ChangePreviewDocument, ChangeSessionPreview as Preview, DiagramChangeSession } from '../../../../domain/mapping/changes/diagramChangeSession';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
import { DraggableDiagramCanvas } from '../../../shared/diagrams/DraggableDiagramCanvas';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { PanelConnector } from '../../../shared/diagrams/PanelConnector';
import { DiagramSubtreeControls } from '../canvas/DiagramSubtreeControls';
import { useEndpointGeometry } from '../canvas/useEndpointGeometry';
import { acceptChangeSession, readChangeSession, type DisplayModeChange } from './changeSessionApi';
import { changePreviewText, type PreviewTextRun } from './changePreviewText';
import type { SearchDocument } from '../search/diagramSearchService';
import { SearchHighlight, type DiagramFocus } from '../search/SearchHighlight';
import type { DiagramLineSearchResult } from '../../../../domain/mapping/search/diagramSearch';
import { revealSearchMatches } from '../search/revealSearchMatches';
import '../canvas/diagramConnections.css';
import './changeSessions.css';

export function ChangeSessionPreview(props: { compact?: boolean; mode: DisplayModeChange; onSelect: (mode: DisplayModeChange) => void;
  onSearchDocument?: (document: SearchDocument) => void; searchFocus?: DiagramFocus;
  searchMatches?: readonly DiagramLineSearchResult[];
  onOpenAccepted: (session: Omit<DiagramChangeSession, 'receipts'>, documentId: string) => Promise<void> }) {
  const [loaded, setLoaded] = useState<{ session: Preview; diff: ReturnType<typeof diffChangeDocument> }>();
  const session = loaded?.session;
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState(false);
  const pendingAcceptance = useRef<{ sessionId: string; version: number; requestId: string } | undefined>(undefined);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, version: number | undefined;
    setLoaded(undefined); setError('');
    const worker = new Worker(new URL('./changePreview.worker.ts', import.meta.url), { type: 'module' });
    const refresh = () => {
      const endpoint = new URL(`/api/mapping/agent/change-sessions/${encodeURIComponent(props.mode.sessionId)}/preview`, location.href);
      endpoint.searchParams.set('documentId', props.mode.documentId);
      if (version !== undefined) endpoint.searchParams.set('version', String(version));
      worker.postMessage({ endpoint: endpoint.href });
    };
    worker.onmessage = ({ data }: MessageEvent<{ session?: Preview | null; diff?: ReturnType<typeof diffChangeDocument>; error?: string }>) => {
      if (data.error) setError(data.error);
      else if (data.session && data.diff) { version = data.session.version; setLoaded({ session: data.session, diff: data.diff }); setError(''); }
      if (data.session?.status !== 'accepted' && data.session?.status !== 'archived') timer = setTimeout(refresh, 2000);
    };
    worker.onerror = () => setError('Preview worker stopped. Reopen the proposal to retry.');
    refresh(); return () => { clearTimeout(timer); worker.terminate(); };
  }, [props.mode.sessionId, props.mode.documentId]);
  const doc = session?.document;
  const { data: treeData } = useDiffTreeData(session?.diffTree ? props.mode.sessionId : undefined);
  const coverage = useMemo(() => treeData ? diffTreeCoverage(treeData) : undefined, [treeData]);
  const migrations = useMemo(() => doc ? changeMigrationPreview(doc, session?.migrations ?? []) : undefined, [doc, session?.migrations]);
  const selectedEndpoint = migrations?.endpoints.find(e => e.migration.id === props.mode.migrationId && e.role === props.mode.migrationRole);
  useEffect(() => {
    if (doc && session?.id === props.mode.sessionId) props.onSearchDocument?.({
      id: `proposal:${session.id}:${doc.id}`, name: `${doc.name} (proposal)`, scope: 'proposal', document: doc.proposed.document
    });
  }, [doc, session?.id, props.mode.sessionId, props.onSearchDocument]);
  const change = session?.changes.find(c => c.id === props.mode.changeId);
  const diff = loaded?.diff;
  const modifiedDiagramIds = useMemo(() => new Set(session?.changes.flatMap(change =>
    change.documentId === doc?.id && change.type === 1 && change.nodeId ? [change.nodeId] : [])), [session, doc?.id]);
  const accept = async () => {
    if (!session || accepting) return;
    if (pendingAcceptance.current?.sessionId !== session.id || pendingAcceptance.current.version !== session.version)
      pendingAcceptance.current = { sessionId: session.id, version: session.version, requestId: crypto.randomUUID() };
    const request = pendingAcceptance.current;
    setAccepting(true); setError('');
    try {
      await acceptChangeSession(request.sessionId, request.version, request.requestId);
      const accepted = await readChangeSession(request.sessionId);
      await props.onOpenAccepted(accepted, props.mode.documentId);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAccepting(false); }
  };
  return <div className="change-session-preview" data-change-session={props.mode.sessionId}>
    {session && <div className="change-session-actions">
      <span>{session.status === 'accepted' ? 'Accepted — original review diff retained' : session.title}</span>
      {session.head && <small title={`Selected commits: ${(session.commits ?? []).join(', ') || 'none'}`}>HEAD {session.head.slice(0, 12)} · {session.commits?.length ?? 0} commits</small>}
      {session.diffTree && !props.compact && <button onClick={() => props.onSelect({ ...props.mode, view: 'diff-tree' })}>Diff tree</button>}
      {session.status === 'ready' && <button disabled={accepting} onClick={() => void accept()}>{accepting ? 'Accepting…' : 'Accept all changes'}</button>}
      {session.status === 'draft' && <span>Mark this proposal ready before accepting.</span>}
      {session.status === 'accepted' && <button onClick={() => void readChangeSession(session.id).then(full => props.onOpenAccepted(full, props.mode.documentId))
        .catch(e => setError(e instanceof Error ? e.message : String(e)))}>Open canvas</button>}
    </div>}
    {error && <p className="change-preview-message" role="alert">{error}</p>}
    {doc
      ? <PreviewCanvas key={`${session!.id}:${doc.id}:${doc.version}:${props.mode.migrationId ? props.mode.serial : ''}`} doc={doc}
          compact={props.compact} coverage={coverage} searchFocus={props.searchFocus}
          searchMatches={props.searchMatches}
          diff={diff!} modifiedDiagramIds={modifiedDiagramIds} migrations={migrations!} focusContentNodeId={props.mode.contentNodeId ?? selectedEndpoint?.focusContentNodeId}
          focusId={props.mode.displayNodeId ?? (selectedEndpoint?.focusContentNodeId ? selectedEndpoint.endpoint.displayNodeId : change?.nodeId)} serial={props.mode.serial} onJump={target => {
            const destination = session!.documents.find(d => d.representationId === target.representationId || d.id === target.representationId);
            if (!destination) { setError('Linked canvas is outside this change session'); return; }
            props.onSelect({ ...props.mode, documentId: destination.id, displayNodeId: target.displayNodeId, contentNodeId: target.contentNodeId, migrationId: undefined, migrationRole: undefined, changeId: session!.changes.find(c => c.documentId === destination.id && c.nodeId === target.displayNodeId)?.id, serial: props.mode.serial + 1 });
          }} />
      : <p className="change-preview-message">{session ? 'Select a canvas in Changes.' : 'Loading preview…'}</p>}
  </div>;
}
function PreviewCanvas({ coverage, compact, doc, focusId, focusContentNodeId, serial, onJump, diff, modifiedDiagramIds, migrations, searchFocus, searchMatches }: { coverage?: DiffCoverage; compact?: boolean; doc: ChangePreviewDocument; focusId?: string; focusContentNodeId?: string; migrations: MigrationPreview; serial: number; searchFocus?: DiagramFocus;
  searchMatches?: readonly DiagramLineSearchResult[];
  diff: ReturnType<typeof diffChangeDocument>; modifiedDiagramIds: ReadonlySet<string>;
  onJump: NonNullable<Parameters<typeof DiagramText>[0]['onJump']> }) {
  const controller = useMemo(() => {
    const state = structuredClone(doc.proposed);
    // Preview folds are local to this viewer; opening a change starts with visible content.
    const expand = (box: typeof state.document.scene.root): typeof box => box.kind === 'container'
      ? { ...box, collapsed: false, children: box.children.map(expand) } : { ...box, collapsed: false };
    state.document.scene.root = expand(state.document.scene.root); state.canvas.diagramViews = {};
    return new ChangePreviewState(state, doc.version);
  }, [doc.id, doc.version]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    if (!searchMatches?.length) return;
    controller.updateCanvas(current => {
      const revealed = revealSearchMatches(controller.getSnapshot().document.scene, current.diagramViews, searchMatches);
      return revealed.views === current.diagramViews ? current : { ...current, diagramViews: revealed.views };
    });
  }, [controller, searchMatches]);
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
  const baselineDiagramIds = useMemo(() => {
    const ids = new Set<string>();
    const visit = (box: typeof doc.proposed.document.scene.root) => {
      if (box.kind === 'diagram') ids.add(box.id);
      else box.children.forEach(visit);
    };
    if (doc.baseline) visit(doc.baseline.document.scene.root);
    return ids;
  }, [doc.baseline]);
  const scene = state.document.scene;
  const text = useMemo(() => changePreviewText(scene, state.canvas.diagramViews, diff.diagrams, modifiedDiagramIds, state.document.jumps, migrations.baseline),
    [scene, state.canvas.diagramViews, diff, modifiedDiagramIds, state.document.jumps, migrations]);
  const { resolved, boxes } = text;
  const coverageFor = useMemo(() => coverage ? diagramCoverage(doc, coverage) : undefined, [doc, coverage]);
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
  const focusBox = useMemo(() => searchFocus ?? (focusId?.startsWith('grid:') ? { id: focusId.slice(5), contentNodeId: focusContentNodeId, serial } : undefined), [focusId, focusContentNodeId, serial, searchFocus]);
  return <DraggableDiagramCanvas enabled resetKey={doc.id} className="mapping-poc-canvas" leftInset={compact ? 0 : 340}
    focusBox={focusBox}>
    <div className="change-preview-stage" style={{ position: 'relative', marginLeft: coverageFor ? 175 : 0, width: resolved.bounds.columns * cell.width, height: resolved.bounds.rows * cell.height }}>
      {(searchMatches?.length ? searchMatches : searchFocus?.search ? [searchFocus.search] : []).map(result => {
        const projection = text.projections.get(result.displayNodeId);
        const box = boxes.find(box => box.box.id === result.displayNodeId.slice(5));
        const focused = searchFocus?.search?.displayNodeId === result.displayNodeId && searchFocus.search.line === result.line;
        const row = projection?.rowForLine.get(result.line);
        return <SearchHighlight key={`${result.displayNodeId}:${result.line}`} result={result} focus={focused ? searchFocus : undefined} content={box?.box.kind === 'diagram' ? scene.contents[box.box.contentId].content : undefined}
          origin={box?.bounds} row={row} cell={cell} columnFor={column => {
            const run = row === undefined ? undefined : projection?.rows[row]?.runs.find(run => run.owner &&
              run.start - run.owner.columnOffset <= column && run.end - run.owner.columnOffset > column);
            return run?.owner ? column + run.owner.columnOffset : projection?.columnForLine(result.line, column) ?? column;
          }} />;
      })}
      {coverageFor && boxes.flatMap(({ box, bounds }) => {
        if (box.kind !== 'diagram') return [];
        const display = `grid:${box.id}`, projection = text.projections.get(display);
        return diagramContentNodes(scene.contents[box.contentId].content).flatMap(node => {
          const row = projection?.rowForLine.get(node.line);
          const stats = coverageFor(display, node.id);
          if (row === undefined || !stats.hunks) return [];
          return <span key={`${display}:${node.id}`} className="diff-coverage change-inline-coverage" data-coverage-node={node.id}
            title={coverageTitle(stats)} style={{ left: bounds.column * cell.width - 175, top: (bounds.row + row) * cell.height }}>{coverageLabel(stats)}</span>;
        });
      })}
      <DiagramText ref={pre} className="mapping-poc-ascii" rows={text.rows} registerEndpoint={geometry.registerEndpoint} onJump={onJump}
        renderRun={run => (run as PreviewTextRun).migrations?.length
          ? <span className={`migration-source${(run as PreviewTextRun).diffVersion ? ' migration-with-edit change-diff-modified' : ''}`}
              data-diff-status={(run as PreviewTextRun).diffVersion ? 'modified' : 'removed'} data-diff-version={(run as PreviewTextRun).diffVersion}
              data-migration-id={(run as PreviewTextRun).migrations!.map(m => m.id).join(' ')} title="Migration source · original text">{run.text}</span>
          : (run as PreviewTextRun).diffStatus === 'removed'
          ? <span className="change-diff-removed" data-diff-status="removed">{run.text}</span>
          : (run as PreviewTextRun).diffVersion
          ? <span className="change-diff-modified" data-diff-status="modified" data-diff-version={(run as PreviewTextRun).diffVersion}>{run.text}</span>
          : run.text}
        nodeProps={owner => {
          const marks = owner.contentNodeId ? migrations.proposed.get(migrationMarkKey(owner.displayNodeId, owner.contentNodeId)) : undefined;
          const migrationClass = [...new Set(marks?.map(mark => `migration-${mark.role}`))].join(' ');
          const side = modifiedDiagramIds.has(owner.displayNodeId) ? diff.diagrams.get(owner.displayNodeId)?.proposed : undefined;
          const change = owner.contentNodeId ? side?.nodes.get(owner.contentNodeId) : undefined;
          const status = owner.contentNodeId ? change?.status : side?.lines.get(owner.sourceLine);
          if (!status && !change?.moved && !change?.containsChanges && !marks?.length) return;
          return { className: [migrationClass, marks?.length && status && 'migration-with-edit', status && `change-diff-${status}`, change?.moved && 'change-diff-moved',
            change?.containsChanges && !status && !change.moved && 'change-diff-descendants'].filter(Boolean).join(' '),
            'data-migration-id': marks?.map(mark => mark.id).join(' '), 'data-migration-role': marks?.map(mark => mark.role).join(' '),
            'data-diff-status': status, 'data-diff-moved': change?.moved || undefined, 'data-diff-descendants': change?.containsChanges || undefined,
            'data-diff-version': status === 'modified' ? 'current' : undefined,
            title: [...(marks?.map(mark => `${mark.id} · ${mark.role}: ${mark.title}`) ?? []), status && `${status[0].toUpperCase()}${status.slice(1)}`, change?.moved && 'Moved or reparented',
              change?.containsChanges && 'Changes inside subtree'].filter(Boolean).join(' · ') };
        }} />
      {boxes.map(({ box, bounds }) => <div key={box.id} data-grid-box={box.id}
        ref={element => geometry.registerEndpoint({ displayNodeId: `grid:${box.id}` }, element)}
        className={`change-preview-box${box.kind === 'diagram' && !baselineDiagramIds.has(box.id) ? ' is-added-diagram' : ''}${focusId === `grid:${box.id}` ? ' is-change-target' : ''}`}
        style={{ left: bounds.column * cell.width, top: bounds.row * cell.height, width: bounds.columns * cell.width, height: bounds.rows * cell.height }} />)}
      <DiagramSubtreeControls nodes={controlNodes} visibleBoxIds={new Set(boxes.map(b => b.box.id))} cell={cell} disabled={false}
        onCollapse={(nodeId, contentNodeId, collapsed) => controller.collapse(nodeId, contentNodeId, collapsed)} />
      <svg className="diagram-connections" ref={geometry.svgRef} aria-label="Preview connections">
        {nodes.flatMap(node => {
          if (node.layout !== 'floating' || node.value.kind !== 'arrow') return [];
          const arrow = node.value, edge = state.document.edges.find(e => e.id === arrow.edgeId)!;
          if (!arrow.path || !arrow.target || !arrow.source) return [];
          return <g key={node.id} style={{ color: edge.appearance.color }} data-preview-edge={edge.id}>
            <PanelConnector path={arrow.path} target={arrow.target} dashed={edge.appearance.lineStyle === 'dashed' || arrow.status === 'proxy'} />
            {arrow.label?.text && <text fill={edge.appearance.color} textAnchor="middle"
              x={arrow.label.position.x} y={arrow.label.position.y}>{arrow.label.text}</text>}
          </g>;
        })}
      </svg>
    </div>
  </DraggableDiagramCanvas>;
}
