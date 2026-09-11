import { memo, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchProjectSourceFile, type ProjectSourceFile } from "../../core/api";
import { SourceCodeView } from "../../core/components/SourceCodeView";
import type { SourceCodePaneView } from "../sourceCodePane";
import type { SourceCodePaneContent } from "../displayModel";
import { sourceCodeCompaction } from "../sourceCodeCompaction";
import { SourcePaneDocumentActiveContext, SourcePaneDocumentContext, SourcePaneViewStateContext } from "./SourcePaneViewStateContext";

const presentation = { syntaxHighlighting: "code", markdownRendering: "source", wrap: false, sourceCompaction: true } as const;

/** Source content only; DisplayPane owns the frame, geometry, and navigation. */
export const SourceCodePane = memo(function SourceCodePane(props: {
  id: string;
  content: SourceCodePaneContent;
  onChange: (id: string, patch: Partial<SourceCodePaneView>) => void;
}) {
  const { content } = props;
  const viewState = useContext(SourcePaneViewStateContext);
  const documentId = useContext(SourcePaneDocumentContext);
  const active = useContext(SourcePaneDocumentActiveContext);
  const scrollState = useMemo(() => viewState?.bind(documentId, props.id, content.sourceFile, content.scroll),
    [viewState, documentId, props.id, content.sourceFile, content.scroll]);
  const onChange = useCallback((patch: Partial<SourceCodePaneView>) => props.onChange(props.id, patch),
    [props.id, props.onChange]);
  const file = content.files.find(file => file.sourceFile === content.sourceFile)!;
  const [preview, setPreview] = useState<ProjectSourceFile | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [revealRequestId, setRevealRequestId] = useState(0);
  const { entries, compactedSource } = useMemo(() => sourceCodeCompaction(file), [file]);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError("");
    void fetchProjectSourceFile(content.projectId, file.sourceFile, controller.signal)
      .then(result => { if (!controller.signal.aborted) setPreview(result); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load source file");
      });
    return () => controller.abort();
  }, [content.projectId, file.sourceFile, attempt]);

  // A file switch must never display the previous file under the new name.
  const loaded = preview?.path === file.sourceFile ? preview : null;
  const stale = loaded !== null && loaded.sourceSha256 !== file.sourceSha256;
  const rangeIndex = Math.min(content.rangeIndex, Math.max(0, entries.length - 1));
  const target = entries[rangeIndex];
  const range = useMemo(() => ({ path: file.sourceFile, startLine: target?.startLine ?? 1,
    endLine: target?.endLine ?? 1, compactedSource: stale ? undefined : compactedSource }),
  [file.sourceFile, target, stale, compactedSource]);
  const reveal = (index: number) => {
    onChange({ rangeIndex: index, scroll: undefined });
    setRevealRequestId(id => id + 1);
  };

  return <section className="mapping-source-pane" data-projected-source={file.sourceFile}
    aria-label={`Source file ${file.sourceFile}`}>
    <div className="mapping-source-file-header">
      <select aria-label="Projected source file" value={file.sourceFile} onChange={event => {
        viewState?.resetPane(documentId, props.id);
        onChange({ sourceFile: event.target.value, rangeIndex: 0, scroll: undefined });
      }}>
        {content.files.map(file => <option key={file.sourceFile} value={file.sourceFile}>{file.sourceFile}</option>)}
      </select>
      <small>{file.selectedLineCount} mapped rows · {entries.length} ranges</small>
    </div>
    <div className="mapping-source-toolbar">
      <button type="button" aria-pressed={content.showCompactions} disabled={!loaded || stale}
        onClick={() => onChange({ showCompactions: !content.showCompactions })}>Compact source</button>
      <span>{target ? `Lines ${target.startLine}–${target.endLine}` : "No mapped ranges"}</span>
      <button type="button" aria-label="Previous mapped range" disabled={!loaded || stale || !entries.length}
        onClick={() => reveal((rangeIndex + entries.length - 1) % entries.length)}>↑</button>
      <button type="button" aria-label="Next mapped range" disabled={!loaded || stale || !entries.length}
        onClick={() => reveal((rangeIndex + 1) % entries.length)}>↓</button>
    </div>
    {stale && <p className="mapping-source-message" role="status">This file has changed since the projection was created. Showing current source without range highlights or compaction folds. Update the projection to align them.</p>}
    {error ? <div className="mapping-source-message" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
      : !loaded ? <p className="mapping-source-message" role="status">Loading source…</p>
      : <SourceCodeView key={`${content.projectId}:${file.sourceFile}`} preview={loaded}
        range={range}
        compacted={!stale && content.showCompactions} presentation={presentation} highlightedRanges={stale ? [] : entries} deferOffscreen
        targetLine={stale ? 1 : target?.startLine} revealRequestId={revealRequestId}
        initialScrollPosition={content.scroll} scrollState={scrollState} active={active}
        onScrollPositionChange={scrollState ? undefined : scroll => onChange({ scroll })} />}
  </section>;
});
