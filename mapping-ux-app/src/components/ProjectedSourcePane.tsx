import { useEffect, useMemo, useState } from "react";
import { fetchProjectSourceFile, type ProjectSourceFile } from "../api";
import type { projectCompactions } from "../compactionProjection";
import { SourceCodeView } from "./SourceCodeView";

type ProjectedFile = ReturnType<typeof projectCompactions>[number];
const presentation = { syntaxHighlighting: "code", markdownRendering: "source", wrap: false, sourceCompaction: false } as const;

export function ProjectedSourcePane(props: {
  projectId: string;
  files: ProjectedFile[];
  file: ProjectedFile;
  onFileChange: (path: string) => void;
  onBack: () => void;
  onCallTree: () => void;
}) {
  const [preview, setPreview] = useState<ProjectSourceFile | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [showCompactions, setShowCompactions] = useState(true);
  const [rangeIndex, setRangeIndex] = useState(0);
  const [revealRequestId, setRevealRequestId] = useState(0);
  const entries = useMemo(() => {
    const lines = props.file.ascii.split("\n");
    const groups = new Map<string, { startLine: number; endLine: number; lines: string[] }>();
    props.file.rows.forEach((row, index) => {
      if (!row.selected) return;
      row.sourceRanges.forEach((range) => {
        const key = `${range.startLine}:${range.endLine}`;
        const group = groups.get(key) ?? { ...range, lines: [] };
        group.lines.push(lines[index]);
        groups.set(key, group);
      });
    });
    return [...groups.values()].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  }, [props.file]);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError("");
    void fetchProjectSourceFile(props.projectId, props.file.sourceFile, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPreview(result); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load source file");
      });
    return () => controller.abort();
  }, [props.projectId, props.file.sourceFile, attempt]);
  const stale = preview !== null && preview.sourceSha256 !== props.file.sourceSha256;
  const target = entries[rangeIndex] ?? entries[0];
  const reveal = (index: number) => { setRangeIndex(index); setRevealRequestId((id) => id + 1); };
  return <section className="mapping-source-pane" data-projected-source={props.file.sourceFile}
    aria-label={`Source file ${props.file.sourceFile}`}>
    <nav className="mapping-source-navigation" aria-label="Projection panes">
      <button type="button" onClick={props.onCallTree}>Call tree</button><span aria-hidden="true">/</span>
      <button type="button" aria-label="Back to compactions" onClick={props.onBack}>Compactions</button><span aria-hidden="true">/</span>
      <strong aria-current="page">Source file</strong>
      <button type="button" className="mapping-source-close" aria-label="Close source file" title="Back to compactions (Escape)" onClick={props.onBack}>×</button>
    </nav>
    <header className="mapping-source-file-header">
      <select aria-label="Projected source file" value={props.file.sourceFile} onChange={(event) => props.onFileChange(event.target.value)}>
        {props.files.map((file) => <option key={file.sourceFile} value={file.sourceFile}>{file.sourceFile}</option>)}
      </select>
      <small>{props.file.selectedLineCount} mapped rows · {entries.length} ranges</small>
    </header>
    <div className="mapping-source-toolbar">
      <button type="button" aria-pressed={showCompactions} disabled={stale} onClick={() => setShowCompactions((show) => !show)}>Compaction overlays</button>
      <span>{target ? `Lines ${target.startLine}–${target.endLine}` : "No mapped ranges"}</span>
      <button type="button" aria-label="Previous mapped range" disabled={stale || !entries.length} onClick={() => reveal((rangeIndex + entries.length - 1) % entries.length)}>↑</button>
      <button type="button" aria-label="Next mapped range" disabled={stale || !entries.length} onClick={() => reveal((rangeIndex + 1) % entries.length)}>↓</button>
    </div>
    {stale && <p className="mapping-source-message" role="status">This file has changed since the projection was created. Showing current source without range highlights or compaction overlays. Update the projection to align them.</p>}
    {error ? <div className="mapping-source-message" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>
      : !preview ? <p className="mapping-source-message" role="status">Loading source…</p>
      : <SourceCodeView preview={preview} range={{ path: preview.path, startLine: target?.startLine ?? 1, endLine: target?.endLine ?? 1 }}
        compacted={false} presentation={presentation} highlightedRanges={stale ? [] : entries}
        targetLine={stale ? 1 : target?.startLine} revealRequestId={revealRequestId}
        lineAnnotations={stale || !showCompactions ? [] : entries.map((entry) => ({ startLine: entry.startLine,
          content: <div className="mapping-source-compaction" data-source-compaction-range={`${entry.startLine}:${entry.endLine}`}>
            <small>PROJECTED COMPACTION · L{entry.startLine}–{entry.endLine}</small>
            <pre>{entry.lines.join("\n")}</pre>
          </div>
        }))} />}
  </section>;
}
