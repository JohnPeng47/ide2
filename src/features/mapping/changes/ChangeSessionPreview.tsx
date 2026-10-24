import { DiagramDisplayToggle } from '../../../shared/diagrams/DiagramDisplayToggle';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import { useTreemapRegionSelection } from '../treemap/useTreemapRegionSelection';
import { treemapCanvasTiles, treemapCanvasRegions } from './treemapCanvasTiles';
import { diagramColorStyle, type TreemapDiagramColor } from './treemapDiagramColors';
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
import { projectDiagramComparisons, layoutDiagramComparisons, type PreviewTextRun } from '../../../../domain/mapping/workspace/diagramDiffProjection';
import type { SearchDocument } from '../search/diagramSearchService';
import { SearchHighlight, type DiagramFocus } from '../search/SearchHighlight';
import type { DiagramLineSearchResult } from '../../../../domain/mapping/search/diagramSearch';
import { revealSearchMatches } from '../search/revealSearchMatches';
import '../canvas/diagramConnections.css';
import './changeSessions.css';

export function ChangeSessionPreview(props: { treemapColors?: readonly TreemapDiagramColor[]; compact?: boolean; mode: DisplayModeChange; onSelect: (mode: DisplayModeChange) => void;
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
      const endpoint = new URL(`${import.meta.env.BASE_URL}api/mapping/agent/change-sessions/${encodeURIComponent(props.mode.sessionId)}/preview`, location.href);
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
      ? <DiagramDiffCanvas key={`${session!.id}:${doc.id}:${doc.version}:${props.mode.migrationId ? props.mode.serial : ''}`} doc={doc}
          compact={props.compact} coverage={coverage} treemapColors={props.treemapColors} searchFocus={props.searchFocus}
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
// Measure only when jumping: resizing an overlay must not move a panned canvas.
function previewFocusBounds(viewport: HTMLElement) {
  const bounds = viewport.getBoundingClientRect();
  let left = bounds.left, right = bounds.right, top = bounds.top;
  const workspace = viewport.closest('.mapping-viewport');
  for (const element of workspace?.querySelectorAll<HTMLElement>('.mapping-floating-pane, .window-panel, .diagram-search-panel') ?? []) {
    if (element.contains(viewport)) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
    if (element.matches('.mapping-floating-pane')) left = Math.max(left, Math.min(bounds.right, rect.right + 12));
    else right = Math.min(right, Math.max(bounds.left, rect.left - 12));
  }
  const header = viewport.closest('.change-session-preview')?.querySelector('.change-session-actions')?.getBoundingClientRect();
  if (header?.height) top = Math.max(top, Math.min(bounds.bottom, header.bottom + 12));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bounds.bottom - top) };
}

export function DiagramDiffCanvas({ initialTransform, onTransformChange, removedDiagramIds, highlightAdded = false, treemapColors, coverage, compact, doc, focusId, focusContentNodeId, serial, onJump, diff, modifiedDiagramIds, migrations, searchFocus, searchMatches }: { initialTransform?: CanvasTransform; onTransformChange?: (value: CanvasTransform) => void; removedDiagramIds?: ReadonlySet<string>; highlightAdded?: boolean; treemapColors?: readonly TreemapDiagramColor[]; coverage?: DiffCoverage; compact?: boolean; doc: ChangePreviewDocument; focusId?: string; focusContentNodeId?: string; migrations: MigrationPreview; serial: number; searchFocus?: DiagramFocus;
  searchMatches?: readonly DiagramLineSearchResult[];
  diff: ReturnType<typeof diffChangeDocument>; modifiedDiagramIds: ReadonlySet<string>;
  onJump: NonNullable<Parameters<typeof DiagramText>[0]['onJump']> }) {
  const controller = useMemo(() => {
    const state = structuredClone(doc.proposed);
    // Lay out fully expanded diff bounds before freezing. Subsequent local folds
    // retain these positions, and routing reads this same prepared scene.
    state.document.scene = layoutDiagramComparisons(state.document.scene, diff.diagrams, modifiedDiagramIds);
    state.canvas.diagramViews = {};
    return new ChangePreviewState(state, doc.version);
  }, [doc.id, doc.version, diff, modifiedDiagramIds]);
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
  const diffEnabled = (id: string) => state.canvas.diagramViews?.[id]?.display !== 'regular';
  const visibleDiffIds = useMemo(() => new Set([...modifiedDiagramIds].filter(id => state.canvas.diagramViews?.[id]?.display !== 'regular')),
    [modifiedDiagramIds, state.canvas.diagramViews]);

  const text = useMemo(() => projectDiagramComparisons(scene, state.canvas.diagramViews, diff.diagrams, visibleDiffIds, state.document.jumps, migrations.baseline, true, state.document.diagramPresentations, doc.baseline?.document),
    [scene, state.canvas.diagramViews, diff, visibleDiffIds, state.document.jumps, migrations, doc.baseline]);
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
  const tintRef = useTreemapRegionSelection(treemapColors);
  const canvasTiles = useMemo(() => boxes.flatMap(({ box, bounds }) => {
    if (box.kind !== 'diagram') return [];
    const displayNodeId = `grid:${box.id}`, projection = text.projections.get(displayNodeId);
    if (!projection) return [];
    const colors = treemapColors?.filter(color => color.displayNodeId === displayNodeId
      && (color.documentId === doc.id || color.documentId === doc.representationId)) ?? [];
    const content = scene.contents[box.contentId].content;
    return [
      ...treemapCanvasTiles(content, projection, bounds, colors).map(tile => ({ ...tile, outline: false })),
      ...treemapCanvasRegions(content, projection, bounds, colors.filter(color => color.hovered)).map(tile => ({ ...tile, outline: true })),
    ].map(tile => ({ ...tile, column: tile.column + bounds.column, row: tile.row + bounds.row }));
  }), [boxes, text.projections, scene, treemapColors, doc.id, doc.representationId]);
  const focusBox = useMemo(() => searchFocus ?? (focusId?.startsWith('grid:') ? { id: focusId.slice(5), contentNodeId: focusContentNodeId, serial } : undefined), [focusId, focusContentNodeId, serial, searchFocus]);
  const renderText = (rows: Parameters<typeof DiagramText>[0]['rows'], measure = false) => (
    <DiagramText ref={measure ? pre : undefined} className="mapping-poc-ascii" rows={rows} registerEndpoint={geometry.registerEndpoint} onJump={onJump}
        renderRun={(run, highlightedText) => (run as PreviewTextRun).migrations?.length
          ? <span className={`migration-source${(run as PreviewTextRun).diffVersion ? ' migration-with-edit change-diff-modified' : ''}`}
              data-diff-status={(run as PreviewTextRun).diffVersion ? 'modified' : 'removed'} data-diff-version={(run as PreviewTextRun).diffVersion}
              data-migration-id={(run as PreviewTextRun).migrations!.map(m => m.id).join(' ')} title="Migration source · original text">{highlightedText}</span>
          : (run as PreviewTextRun).diffStatus === 'removed'
          ? <span className="change-diff-removed" data-diff-status="removed">{highlightedText}</span>
          : (run as PreviewTextRun).diffVersion
          ? <span className="change-diff-modified" data-diff-status="modified" data-diff-version={(run as PreviewTextRun).diffVersion}>{highlightedText}</span>
          : highlightedText}
        nodeProps={owner => {
          if (!diffEnabled(owner.displayNodeId)) return;
          const marks = owner.contentNodeId ? migrations.proposed.get(migrationMarkKey(owner.displayNodeId, owner.contentNodeId)) : undefined;
          const migrationClass = [...new Set(marks?.map(mark => `migration-${mark.role}`))].join(' ');
          const side = modifiedDiagramIds.has(owner.displayNodeId) ? diff.diagrams.get(owner.displayNodeId)?.proposed : undefined;
          const change = owner.contentNodeId ? side?.nodes.get(owner.contentNodeId) : undefined;
          const status = removedDiagramIds?.has(owner.displayNodeId) ? 'removed' : !baselineDiagramIds.has(owner.displayNodeId.slice(5)) ? (highlightAdded ? 'added' : undefined) : owner.contentNodeId ? change?.status : side?.lines.get(owner.sourceLine);
          if (!status && !change?.moved && !change?.containsChanges && !marks?.length) return;
          return { className: [migrationClass, marks?.length && status && 'migration-with-edit', status && `change-diff-${status}`, change?.moved && 'change-diff-moved',
            change?.containsChanges && !status && !change.moved && 'change-diff-descendants'].filter(Boolean).join(' '),
            'data-migration-id': marks?.map(mark => mark.id).join(' '), 'data-migration-role': marks?.map(mark => mark.role).join(' '),
            'data-diff-status': status, 'data-diff-moved': change?.moved || undefined, 'data-diff-descendants': change?.containsChanges || undefined,
            'data-diff-version': status === 'modified' ? 'current' : undefined,
            title: [...(marks?.map(mark => `${mark.id} · ${mark.role}: ${mark.title}`) ?? []), status && `${status[0].toUpperCase()}${status.slice(1)}`, change?.moved && 'Moved or reparented',
              change?.containsChanges && 'Changes inside subtree'].filter(Boolean).join(' · ') };
        }} />
  );
  return <DraggableDiagramCanvas enabled resetKey={doc.id} className="mapping-poc-canvas" leftInset={compact ? 0 : 340}
    focusBox={focusBox} getFocusBounds={previewFocusBounds} initialTransform={initialTransform} onTransformChange={onTransformChange}>
    <div className="change-preview-stage" style={{ position: 'relative', marginLeft: coverageFor ? 175 : 0, width: resolved.bounds.columns * cell.width, height: resolved.bounds.rows * cell.height }}>
      {canvasTiles.map(({ identity, column, row, columns, rows, outline }, index) => <div ref={index === 0 ? tintRef : undefined} data-treemap-region={outline ? undefined : identity.nodeId}
        key={`${outline}:${identity.position}:${column}:${row}`} className={outline ? "treemap-canvas-hover" : "change-preview-treemap-tint"} aria-hidden="true"
        data-treemap-diagram={identity.displayNodeId} data-content-node-id={identity.contentNodeId}
        data-treemap-color={identity.color} data-diagram-position={identity.position}
        style={{ ...diagramColorStyle(identity.color), left: column * cell.width, top: row * cell.height,
          width: columns * cell.width, height: rows * cell.height }} />)}
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
      {boxes.filter(({ box }) => box.kind === 'diagram').map(({ box, bounds }, index) =>
        <div key={box.id} data-diff-diagram={box.id} style={{ position: 'absolute', left: bounds.column * cell.width, top: bounds.row * cell.height }}>
          {renderText(text.projections.get(`grid:${box.id}`)!.rows, index === 0)}
          <div style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 8 }}>
            <DiagramDisplayToggle mode={diffEnabled(`grid:${box.id}`) ? 'diff' : 'regular'} onChange={display => controller.updateCanvas(canvas => ({
              ...canvas, diagramViews: { ...canvas.diagramViews, [`grid:${box.id}`]: {
                contentRevisionId: scene.contents[(box as Extract<typeof box, { kind: 'diagram' }>).contentId].content.revisionId, collapsedContentNodeIds: [],
                ...canvas.diagramViews?.[`grid:${box.id}`], display
              } }
            }))} />
          </div>
        </div>)}
      {boxes.map(({ box, bounds }) => <div key={box.id} data-grid-box={box.id}
        ref={element => geometry.registerEndpoint({ displayNodeId: `grid:${box.id}` }, element)}
        className={`change-preview-box${removedDiagramIds?.has(`grid:${box.id}`) ? ' is-removed-diagram' : ''}${box.kind === 'diagram' && !baselineDiagramIds.has(box.id) ? ' is-added-diagram' : ''}${focusId === `grid:${box.id}` ? ' is-change-target' : ''}`}
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
