import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSourceFile } from '../../../shared/http/api';
import { useMappingServices } from '../services/MappingServices';
import { SourceCodeView } from '../../../shared/source/SourceCodeView';
import { RepositoryFileExplorer } from '../../../shared/source/RepositoryFileExplorer';
import { supportsDefinitions, type SourceLocation, type SourcePosition } from '../../../../domain/core/source/sourceNavigation';
import type { SourceCodePaneView } from './sourceCodePane';
import type { SourceCodePaneContent } from '../../../../domain/mapping/workspace/displayModel';
import { SourcePaneDocumentActiveContext, SourcePaneDocumentContext, SourcePaneViewStateContext } from './SourcePaneViewStateContext';

const presentation = { syntaxHighlighting: 'code', markdownRendering: 'source', wrap: false, sourceCompaction: true } as const;
const emptyEntries: { startLine: number; endLine: number }[] = [];
type Visit = SourceLocation & { scroll?: { top: number; left: number }; rangeIndex?: number };

/** Source navigation stays within the existing display pane and its projection ownership. */
export const SourceCodePane = memo(function SourceCodePane(props: {
  id: string; content: SourceCodePaneContent; initialLocation?: SourceLocation;
  onChange: (id: string, patch: Partial<SourceCodePaneView>) => void;
}) {
  const { content } = props;
  const { codeRepo } = useMappingServices();
  const viewState = useContext(SourcePaneViewStateContext);
  const documentId = useContext(SourcePaneDocumentContext);
  const active = useContext(SourcePaneDocumentActiveContext);
  const scrollState = useMemo(() => viewState?.bind(documentId, props.id, content.sourceFile, content.scroll, content.sourceId),
    [viewState, documentId, props.id, content.sourceFile, content.scroll, content.sourceId]);
  const onChange = useCallback((patch: Partial<SourceCodePaneView>) => props.onChange(props.id, patch), [props.id, props.onChange]);
  const file = content.files.find(file => file.sourceFile === content.sourceFile);
  const root = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<ProjectSourceFile | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [revealRequestId, setRevealRequestId] = useState(0);
  const [navigation, setNavigation] = useState<{ visit: Visit; id: number } | undefined>(() => props.initialLocation ? { visit: props.initialLocation, id: 1 } : undefined);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [history, setHistory] = useState<{ back: Visit[]; forward: Visit[] }>({ back: [], forward: [] });
  const [definitionMessage, setDefinitionMessage] = useState('');
  const [definitions, setDefinitions] = useState<SourceLocation[]>([]);
  const definitionRequest = useRef<AbortController | undefined>(undefined);
  const entries = file?.ranges ?? emptyEntries;
  const compactedSource = file?.compactedSource;

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setError('');
    void codeRepo.readFile({ projectId: content.projectId, sourceId: content.sourceId ?? '' }, content.sourceFile, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setPreview({ path: result.path, startLine: 1, lines: result.text.split('\n'), sourceSha256: result.sha256, lspEnabled: Boolean(result.lspEnabled) }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load source file'); });
    return () => controller.abort();
  }, [codeRepo, content.projectId, content.sourceId, content.sourceFile, attempt]);
  useEffect(() => {
    definitionRequest.current?.abort(); setDefinitionMessage(''); setDefinitions([]);
    return () => definitionRequest.current?.abort();
  }, [content.projectId, content.sourceId, content.sourceFile, active]);

  const loaded = preview?.path === content.sourceFile ? preview : null;
  const stale = Boolean(file && loaded && loaded.sourceSha256 !== file.sourceSha256);
  const rangeIndex = Math.min(content.rangeIndex, Math.max(0, entries.length - 1));
  const target = entries[rangeIndex];
  const destination = navigation?.visit.path === content.sourceFile ? navigation.visit : undefined;
  const range = useMemo(() => ({ path: content.sourceFile, startLine: target?.startLine ?? 1,
    endLine: target?.endLine ?? 1, compactedSource: stale ? undefined : compactedSource }), [content.sourceFile, target, stale, compactedSource]);
  const capture = (): Visit => {
    const viewer = root.current?.querySelector<HTMLElement>('.source-code-viewer');
    return { path: content.sourceFile, rangeIndex: content.rangeIndex, range: destination?.range,
      scroll: viewer?.getClientRects().length ? { top: viewer.scrollTop, left: viewer.scrollLeft } : scrollState?.read() ?? content.scroll };
  };
  const navigate = (visit: Visit, direction?: 'back' | 'forward') => {
    definitionRequest.current?.abort(); setDefinitions([]); setDefinitionMessage('');
    const current = capture();
    setHistory(history => direction === 'back' ? { back: history.back.slice(0, -1), forward: [...history.forward, current] }
      : direction === 'forward' ? { back: [...history.back, current], forward: history.forward.slice(0, -1) }
      : { back: [...history.back.slice(-99), current], forward: [] });
    viewState?.resetPane(documentId, props.id);
    onChange({ sourceFile: visit.path, rangeIndex: visit.rangeIndex ?? 0, scroll: visit.scroll });
    setNavigation(current => ({ visit, id: (current?.id ?? 0) + 1 }));
  };
  const openFile = (path: string) => { if (path !== content.sourceFile) navigate({ path }); };
  const reveal = (index: number) => {
    viewState?.resetPane(documentId, props.id);
    setNavigation(undefined);
    onChange({ rangeIndex: index, scroll: undefined });
    setRevealRequestId(id => id + 1);
  };
  const lookup = async (position: SourcePosition) => {
    if (!loaded?.lspEnabled || !supportsDefinitions(content.sourceFile)) return;
    definitionRequest.current?.abort();
    const controller = new AbortController(); definitionRequest.current = controller;
    setDefinitionMessage('Finding definition…'); setDefinitions([]);
    try {
      const result = await codeRepo.definitions({ projectId: content.projectId, sourceId: content.sourceId ?? '' }, { path: content.sourceFile, position, sourceSha256: loaded.sourceSha256 }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.locations.length === 1) navigate(result.locations[0]);
      else {
        setDefinitions(result.locations);
        setDefinitionMessage(result.locations.length ? 'Choose a definition:' : result.outsideRoot ? 'Definition is outside this repository.' : 'No definition found.');
      }
    } catch (error) { if (!controller.signal.aborted) setDefinitionMessage(error instanceof Error ? error.message : 'Definition lookup failed'); }
  };

  return <section ref={root} className="mapping-source-pane" data-projected-source={content.sourceFile} aria-label={`Source file ${content.sourceFile}`}>
    <div className="mapping-source-file-header">
      <button type="button" aria-label="Toggle repository files" aria-expanded={explorerOpen} onClick={() => setExplorerOpen(open => !open)}>{explorerOpen ? '▾' : '▸'} Files</button>
      <button type="button" aria-label="Back in source history" disabled={!history.back.length} onClick={() => navigate(history.back.at(-1)!, 'back')}>←</button>
      <button type="button" aria-label="Forward in source history" disabled={!history.forward.length} onClick={() => navigate(history.forward.at(-1)!, 'forward')}>→</button>
      <select aria-label="Projected source file" value={content.sourceFile} onChange={event => openFile(event.target.value)}>
        {!file && <option value={content.sourceFile}>{content.sourceFile}</option>}
        {content.files.map(file => <option key={file.sourceFile} value={file.sourceFile}>{file.sourceFile}</option>)}
      </select>
    </div>
    <div className="mapping-source-body">
      {explorerOpen && <RepositoryFileExplorer codeRepo={codeRepo} projectId={content.projectId} sourceId={content.sourceId} selected={content.sourceFile} onOpen={openFile} />}
      <div className="mapping-source-main">
        <div className="mapping-source-toolbar">
          <button type="button" aria-pressed={content.showCompactions} disabled={!loaded || stale || !file}
            onClick={() => onChange({ showCompactions: !content.showCompactions })}>Compact source</button>
          <span>{target ? `Lines ${target.startLine}–${target.endLine}` : 'No mapped ranges'}</span>
          <button type="button" aria-label="Previous mapped range" disabled={!loaded || stale || !entries.length} onClick={() => reveal((rangeIndex + entries.length - 1) % entries.length)}>↑</button>
          <button type="button" aria-label="Next mapped range" disabled={!loaded || stale || !entries.length} onClick={() => reveal((rangeIndex + 1) % entries.length)}>↓</button>
          <button type="button" aria-label="Reload source file" onClick={() => { definitionRequest.current?.abort(); setDefinitionMessage(''); setDefinitions([]); setAttempt(n => n + 1); }}>↻</button>
        </div>
        {loaded?.lspEnabled && supportsDefinitions(content.sourceFile) && <small className="source-navigation-hint">Ctrl/Cmd+click or F12: go to definition</small>}
        {definitionMessage && <div className="mapping-source-message" role="status">{definitionMessage}
          {definitions.map((location, index) => <button type="button" key={index} onClick={() => navigate(location)}>{location.path}:{(location.range?.start.line ?? 0) + 1}</button>)}
        </div>}
        {stale && <p className="mapping-source-message" role="status">This file has changed since the projection was created. Showing current source without range highlights or compaction folds. Update the projection to align them.</p>}
        {error ? <div className="mapping-source-message" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
          : !loaded ? <p className="mapping-source-message" role="status">Loading source…</p>
          : <SourceCodeView key={`${content.projectId}:${content.sourceFile}:${navigation?.id ?? 0}`} preview={loaded}
            range={range} compacted={Boolean(file && !stale && content.showCompactions)} presentation={presentation} highlightedRanges={stale ? emptyEntries : entries} deferOffscreen
            targetLine={destination?.range ? destination.range.start.line + 1 : stale ? 1 : target?.startLine}
            navigationRange={destination?.range} revealRequestId={revealRequestId}
            onGoToDefinition={loaded.lspEnabled && supportsDefinitions(content.sourceFile) ? lookup : undefined}
            initialScrollPosition={content.scroll} scrollState={scrollState} active={active}
            onScrollPositionChange={scrollState ? undefined : scroll => onChange({ scroll })} />}
      </div>
    </div>
  </section>;
});
