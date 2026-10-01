import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { sha256 } from '../../../../domain/core/sha256';
import { mappedResourceHandlers, type MappedResourceType, type PanelContent, type SourceDisplayFile } from '../../../../domain/mapping/code-panel/codePanel';
import type { CodePanelPaneContent, SourceCodePaneContent } from '../../../../domain/mapping/workspace/displayModel';
import type { CompactedSource } from '../../../../domain/core/records/domain';
import type { CodeRepoFile } from '../../../../domain/core/source/codeRepoService';
import type { SourceLocation, SourcePosition } from '../../../../domain/core/source/sourceNavigation';
import { supportsDefinitions } from '../../../../domain/core/source/sourceNavigation';
import { SourceCodeView } from '../../../shared/source/SourceCodeView';
import { SourceCodePane } from '../source-pane/SourceCodePane';
import { SourcePaneDocumentContext, SourcePaneViewStateContext, SourcePaneDocumentActiveContext } from '../source-pane/SourcePaneViewStateContext';
import { useMappingServices } from '../services/MappingServices';

const presentation = { syntaxHighlighting: 'code', markdownRendering: 'source', wrap: false, sourceCompaction: true } as const;
function SourceRangeSections({ file, onOpen, hoveredNode }: { file: SourceDisplayFile;
  onOpen: (file: SourceDisplayFile, location?: SourceLocation) => void; hoveredNode?: string }) {
  const { codeRepo } = useMappingServices();
  const [loaded, setLoaded] = useState<CodeRepoFile>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [definitions, setDefinitions] = useState<SourceLocation[]>([]);
  const [message, setMessage] = useState('');
  const definitionRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController(); setLoaded(undefined); setError('');
    void codeRepo.readFile(file.repo, file.path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setLoaded(result);
    }, error => { if (!controller.signal.aborted) setError(String(error.message ?? error)); });
    return () => { controller.abort(); definitionRequest.current?.abort(); };
  }, [codeRepo, file.id, attempt]);
  const lines = useMemo(() => loaded?.text.replace(/\r\n?/g, '\n').split('\n') ?? [], [loaded]);
  const stale = Boolean(loaded && file.ranges.some(range => range.items.some(({ resource: { target } }) =>
    target.endLine > lines.length || sha256(lines.slice(target.startLine - 1, target.endLine).join('\n')) !== target.rangeSha256)));
  // The existing folding renderer now folds gaps, leaving every mapped range visible.
  const compactedSource = useMemo<CompactedSource>(() => {
    const sections: CompactedSource['sections'] = [];
    let start = 1;
    for (const range of [...file.ranges, { startLine: lines.length + 1, endLine: lines.length }]) {
      if (start < range.startLine) sections.push({ kind: 'collapsed-comment', startLine: start, endLine: range.startLine - 1,
        comment: `${range.startLine - start} lines hidden` });
      start = range.endLine + 1;
    }
    return { level: 'medium', sections };
  }, [file.ranges, lines.length]);
  const preview = useMemo(() => ({ path: file.path, startLine: 1, lines }), [file.path, lines]);
  const sourceRange = useMemo(() => ({ path: file.path, startLine: file.ranges[0]?.startLine ?? 1,
    endLine: file.ranges.at(-1)?.endLine ?? 1, compactedSource }), [file.path, file.ranges, compactedSource]);
  const lookup = async (position: SourcePosition) => {
    if (!loaded) return;
    definitionRequest.current?.abort(); const controller = new AbortController(); definitionRequest.current = controller;
    setMessage('Finding definition…'); setDefinitions([]);
    try {
      const result = await codeRepo.definitions(file.repo, { path: file.path, position, sourceSha256: loaded.sha256 }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.locations.length === 1) { setMessage(''); onOpen(file, result.locations[0]); }
      else { setDefinitions(result.locations); setMessage(result.locations.length ? 'Choose a definition:' : 'No definition found in this repository.'); }
    } catch (error) { if (!controller.signal.aborted) setMessage(String(error)); }
  };
  const root = useRef<HTMLElement>(null);
  const highlightedNodes = useRef<HTMLElement[]>([]);
  const clearHighlights = () => {
    highlightedNodes.current.forEach(el => delete el.dataset.codePanelHighlight);
    highlightedNodes.current = [];
  };
  useEffect(() => clearHighlights, []);
  const highlightNodes = (ids: string[]) => {
    clearHighlights();
    const stage = root.current?.closest('.mapping-poc-graph-stage');
    stage?.querySelectorAll<HTMLElement>('[data-content-node-id]').forEach(el => {
      if (ids.includes(el.dataset.contentNodeId!)) {
        el.dataset.codePanelHighlight = 'true';
        highlightedNodes.current.push(el);
      }
    });
  };
  const annotations = useMemo(() => file.ranges.map(range => ({ startLine: range.startLine,
    content: <span className="code-panel-origins" data-panel-node-highlight={range.items.some(item => item.origins.some(origin => origin.selectedNodeId === hoveredNode)) || undefined}
      onMouseEnter={() => highlightNodes(range.items.flatMap(item => item.origins.map(origin => origin.selectedNodeId)))} onMouseLeave={() => highlightNodes([])}>
      {[...new Map(range.items.flatMap(item => item.origins).map(origin => [origin.selectedNodeId, origin])).values()].map(origin =>
        <span key={origin.selectedNodeId}>{origin.selectedLabel}{origin.selectedNodeId !== origin.mappedNodeId ? ` — via ${origin.mappedLabel}` : ''}</span>)}
    </span> })), [file.ranges, hoveredNode]);
  return <section ref={root} className="code-panel-file" data-code-panel-file={file.path} data-resource-loading={!loaded && !error}>
    <header><strong>{file.path}</strong><small>{file.repo.sourceId || 'Default repository'}</small>
      <button type="button" onClick={() => onOpen(file)}>Browse source</button>
      <button type="button" onClick={() => setAttempt(n => n + 1)} aria-label={`Reload ${file.path}`}>↻</button></header>
    {error ? <p role="alert">{error} <button onClick={() => setAttempt(n => n + 1)}>Retry</button></p>
      : !loaded ? <p role="status">Loading source…</p> : <>
        {stale && <p role="status">Mapped source has changed. Showing current file without range highlights or folds.</p>}
        {message && <p role="status">{message}{definitions.map((location, i) => <button key={i} onClick={() => onOpen(file, location)}>{location.path}:{(location.range?.start.line ?? 0) + 1}</button>)}</p>}
        <SourceCodeView preview={preview} range={sourceRange}
          compacted={!stale} foldPresentation="gap" highlightedRanges={stale ? [] : file.ranges} lineAnnotations={stale ? [] : annotations}
          presentation={presentation} onGoToDefinition={loaded.lspEnabled && supportsDefinitions(file.path) ? lookup : undefined} deferOffscreen />
      </>}
  </section>;
}
interface ResourceRendererProps {
  items: PanelContent['items'];
  hoveredNode?: string;
  onOpenSource: (file: SourceDisplayFile, location?: SourceLocation) => void;
}
/** Each renderer owns its resource-specific display model; the panel only dispatches by type. */
function SourceResources({ items, hoveredNode, onOpenSource }: ResourceRendererProps) {
  const order = useRef<string[]>([]);
  const files = useMemo(() => {
    const next = mappedResourceHandlers['source-range'].buildDisplayModel(items, order.current);
    order.current = next.map(file => file.id); return next;
  }, [items]);
  return files.map(file => <SourceRangeSections key={file.id} file={file} hoveredNode={hoveredNode} onOpen={onOpenSource} />);
}
const resourceRenderers = { 'source-range': SourceResources } satisfies Record<MappedResourceType, ComponentType<ResourceRendererProps>>;
export function CodePanel({ id, content }: { id: string; content: CodePanelPaneContent }) {
  const root = useRef<HTMLDivElement>(null);
  const [navigation, setNavigation] = useState<{ file: SourceCodePaneContent; location?: SourceLocation }>();
  const [hoveredNode, setHoveredNode] = useState<string>();
  const viewState = useContext(SourcePaneViewStateContext), documentId = useContext(SourcePaneDocumentContext);
  const active = useContext(SourcePaneDocumentActiveContext);
  const scroll = useMemo(() => viewState?.bind(documentId, id, '@code-panel', content.scroll), [viewState, documentId, id, content.scroll]);
  useLayoutEffect(() => {
    const el = root.current; if (!el || !active) return;
    const position = scroll?.read();
    let restoring = Boolean(position);
    const restore = () => {
      if (!restoring || !position) return;
      el.scrollTop = position.top; el.scrollLeft = position.left;
      if (!el.querySelector('[data-resource-loading="true"]')) restoring = false;
    };
    restore();
    // Source reads finish after mount. Restore again when their sections acquire height.
    const observer = new ResizeObserver(restore);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    const stopRestoring = () => { restoring = false; };
    el.addEventListener('wheel', stopRestoring, { passive: true });
    const disconnect = scroll?.connect(() => restoring ? position : el.getClientRects().length ? { top: el.scrollTop, left: el.scrollLeft } : undefined);
    return () => { observer.disconnect(); el.removeEventListener('wheel', stopRestoring); disconnect?.(); };
  }, [scroll, active, navigation !== undefined]);
  useEffect(() => { setNavigation(undefined); }, [content.panel]);
  useEffect(() => {
    const stage = root.current?.closest('.mapping-poc-graph-stage');
    const hover = (event: Event) => setHoveredNode((event.target as Element).closest<HTMLElement>('[data-content-node-id]')?.dataset.contentNodeId);
    stage?.addEventListener('pointerover', hover); return () => stage?.removeEventListener('pointerover', hover);
  }, []);
  const Renderer = resourceRenderers[content.panel.mappedResourceType];
  return <div className="code-panel" data-code-panel={content.panel.mappedResourceType}>
    <div className="code-panel-summary">{content.panel.selectedNodeIds.length} selected nodes · {content.panel.items.length} mapped resources
      {navigation && <button onClick={() => setNavigation(undefined)}>Back to mapped ranges</button>}</div>
    {navigation ? <SourceCodePane id={`${id}:browse`} content={navigation.file} initialLocation={navigation.location}
      onChange={(_id, patch) => setNavigation(current => current && ({ ...current, file: { ...current.file, ...patch } }))} />
      : <div ref={root} className="code-panel-content" onScroll={event => scroll?.write({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}>
        <div className="code-panel-resources">
        {!!content.panel.unmappedNodeIds.length && <p role="status">{content.panel.unmappedNodeIds.length} selected nodes have no mapping.</p>}
        <Renderer items={content.panel.items} hoveredNode={hoveredNode} onOpenSource={(file, location) => setNavigation({
          file: { kind: 'source-code', projectId: file.repo.projectId, sourceId: file.repo.sourceId, sourceFile: location?.path ?? file.path,
            files: [], showCompactions: false, rangeIndex: 0 }, location })} />
        </div>
      </div>}
  </div>;
}
