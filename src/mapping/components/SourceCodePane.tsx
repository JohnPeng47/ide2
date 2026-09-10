import { useEffect, useMemo, useState } from "react";
import { fetchProjectSourceFile, type ProjectSourceFile } from "../../core/api";
import { SourceCodeView } from "../../core/components/SourceCodeView";
import type { SourceCodePaneView } from "../sourceCodePane";
import type { SourceCodePaneContent } from "../displayModel";

const presentation = { syntaxHighlighting: "code", markdownRendering: "source", wrap: false, sourceCompaction: false } as const;

/** Source content only; DisplayPane owns the frame, geometry, and navigation. */
export function SourceCodePane(props: {
  content: SourceCodePaneContent;
  onChange: (patch: Partial<SourceCodePaneView>) => void;
}) {
  const { content } = props;
  const file = content.files.find(file => file.sourceFile === content.sourceFile)!;
  const [preview, setPreview] = useState<ProjectSourceFile | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [revealRequestId, setRevealRequestId] = useState(0);
  const entries = useMemo(() => {
    const lines = file.ascii.split("\n");
    const groups = new Map<string, { startLine: number; endLine: number; lines: string[] }>();
    file.rows.forEach((row, index) => {
      if (!row.selected) return;
      row.sourceRanges.forEach(range => {
        const key = `${range.startLine}:${range.endLine}`;
        const group = groups.get(key) ?? { ...range, lines: [] };
        group.lines.push(lines[index]);
        groups.set(key, group);
      });
    });
    return [...groups.values()].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  }, [file]);

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
  const reveal = (index: number) => {
    props.onChange({ rangeIndex: index, scroll: undefined });
    setRevealRequestId(id => id + 1);
  };

  return <section className="mapping-source-pane" data-projected-source={file.sourceFile}
    aria-label={`Source file ${file.sourceFile}`}>
    <div className="mapping-source-file-header">
      <select aria-label="Projected source file" value={file.sourceFile} onChange={event =>
        props.onChange({ sourceFile: event.target.value, rangeIndex: 0, scroll: undefined })}>
        {content.files.map(file => <option key={file.sourceFile} value={file.sourceFile}>{file.sourceFile}</option>)}
      </select>
      <small>{file.selectedLineCount} mapped rows · {entries.length} ranges</small>
    </div>
    <div className="mapping-source-toolbar">
      <button type="button" aria-pressed={content.showCompactions} disabled={!loaded || stale}
        onClick={() => props.onChange({ showCompactions: !content.showCompactions })}>Compaction overlays</button>
      <span>{target ? `Lines ${target.startLine}–${target.endLine}` : "No mapped ranges"}</span>
      <button type="button" aria-label="Previous mapped range" disabled={!loaded || stale || !entries.length}
        onClick={() => reveal((rangeIndex + entries.length - 1) % entries.length)}>↑</button>
      <button type="button" aria-label="Next mapped range" disabled={!loaded || stale || !entries.length}
        onClick={() => reveal((rangeIndex + 1) % entries.length)}>↓</button>
    </div>
    {stale && <p className="mapping-source-message" role="status">This file has changed since the projection was created. Showing current source without range highlights or compaction overlays. Update the projection to align them.</p>}
    {error ? <div className="mapping-source-message" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
      : !loaded ? <p className="mapping-source-message" role="status">Loading source…</p>
      : <SourceCodeView key={`${content.projectId}:${file.sourceFile}`} preview={loaded}
        range={{ path: loaded.path, startLine: target?.startLine ?? 1, endLine: target?.endLine ?? 1 }}
        compacted={false} presentation={presentation} highlightedRanges={stale ? [] : entries}
        targetLine={stale ? 1 : target?.startLine} revealRequestId={revealRequestId}
        initialScrollPosition={content.scroll} onScrollPositionChange={scroll => props.onChange({ scroll })}
        lineAnnotations={stale || !content.showCompactions ? [] : entries.map(entry => ({ startLine: entry.startLine,
          content: <div className="mapping-source-compaction" data-source-compaction-range={`${entry.startLine}:${entry.endLine}`}>
            <small>PROJECTED COMPACTION · L{entry.startLine}–{entry.endLine}</small>
            <pre>{entry.lines.join("\n")}</pre>
          </div>
        }))} />}
  </section>;
}
