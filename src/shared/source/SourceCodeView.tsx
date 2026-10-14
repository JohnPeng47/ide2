import { useTheme } from "../theme/theme";
import { tokenizeSource, sourceLanguageName, contentLanguageName } from "./sourceHighlighting";
export { sourceLanguageName, contentLanguageName } from "./sourceHighlighting";
import type { SourceLocation, SourcePosition } from '../../../domain/core/source/sourceNavigation';
import { sourcePositionAtNode, sourcePositionAtPoint, selectSourceRange } from './sourceDomPosition';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";
import type { ThemedToken, TokensResult } from "shiki";
import type { SourceSnippet } from "../http/api";
import type { CompactedSourceNode, CompactedSourceSection, SourceRange } from "../../../domain/core/records/domain";
import type { ContentPresentation } from "../../../domain/core/profiles/domainProfile";
import type { SourceScrollState } from "./sourceScrollState";

type CollapsedSection = Extract<CompactedSourceSection, { kind: "collapsed-comment" }>;

function collapsedSections(range: SourceRange, preview: SourceSnippet): CollapsedSection[] {
  const lastLine = preview.startLine + preview.lines.length - 1;
  return range.compactedSource?.sections.filter(
    (section): section is CollapsedSection => section.kind === "collapsed-comment"
      && section.startLine >= preview.startLine
      && section.endLine <= lastLine
      && section.endLine >= section.startLine
  ).sort((left, right) => left.startLine - right.startLine) ?? [];
}

function sectionKey(section: CollapsedSection): string {
  return `${section.startLine}:${section.endLine}`;
}

export function formatCollapsedCallGraph(section: CollapsedSection): string {
  const graphLines = section.comment.replace(/\r\n?/g, "\n").split("\n");
  if (!section.nodes) {
    while (graphLines[0]?.trim() === "") graphLines.shift();
    while (graphLines.at(-1)?.trim() === "") graphLines.pop();
  }
  const lineCount = section.endLine - section.startLine + 1;
  return [
    `// [Lines ${section.startLine}-${section.endLine} | ${lineCount} lines compacted]`,
    "//",
    ...graphLines.map((line) => `//${line ? ` ${line}` : ""}`)
  ].join("\n");
}

function tokenStyle(token: ThemedToken): CSSProperties {
  const fontStyle = token.fontStyle ?? 0;
  return {
    color: token.color,
    backgroundColor: token.bgColor,
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? 700 : undefined,
    textDecoration: fontStyle & 4 ? "underline" : undefined
  };
}

function SourceTokens(props: { tokens: ThemedToken[]; fallback: string }) {
  const tokens = props.tokens.length > 0
    ? props.tokens
    : [{ content: props.fallback, offset: 0 } satisfies ThemedToken];
  return tokens.map((token, index) => (
    <span className="source-token" style={tokenStyle(token)} key={`${token.offset}:${index}`}>
      {token.content}
    </span>
  ));
}

function GraphNodeSource(props: {
  node: CompactedSourceNode;
  preview: SourceSnippet;
  tokenLines: ThemedToken[][];
}) {
  const rows: ReactNode[] = [];
  for (let lineNumber = props.node.startLine; lineNumber <= props.node.endLine; lineNumber += 1) {
    const index = lineNumber - props.preview.startLine;
    if (index < 0 || index >= props.preview.lines.length) continue;
    rows.push(
      <div className="source-call-graph-node-source-line" data-line={lineNumber} key={lineNumber}>
        <span aria-hidden="true">{lineNumber}</span>
        <code data-source-text="">
          <SourceTokens tokens={props.tokenLines[index] ?? []} fallback={props.preview.lines[index]} />
        </code>
      </div>
    );
  }
  return <div className="source-call-graph-node-source">{rows}</div>;
}

const SOURCE_CHUNK_ROWS = 80;

/** Retain native search/selection, but let the browser skip offscreen token trees. */
const SourceCodeContent = memo(function SourceCodeContent(props: { rows: ReactNode[]; deferOffscreen: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chunked = props.deferOffscreen && props.rows.length > SOURCE_CHUNK_ROWS * 3;
  useLayoutEffect(() => {
    if (!chunked || !ref.current) return;
    const content = ref.current;
    const viewer = content.parentElement!;
    const chunks = Array.from(content.children) as HTMLElement[];
    // Measure the real rows (including annotations) before deferring them. Exact
    // intrinsic sizes preserve both scroll axes and distant range navigation.
    const measure = () => {
      if (!viewer.clientWidth) return;
      for (const chunk of chunks) chunk.style.contentVisibility = "visible";
      const sizes = chunks.map(chunk => {
        const style = getComputedStyle(chunk);
        return `${style.width} ${style.height}`;
      });
      chunks.forEach((chunk, index) => {
        chunk.style.containIntrinsicSize = sizes[index];
        chunk.style.contentVisibility = "auto";
      });
    };
    measure();
    let width = viewer.clientWidth;
    const observer = new ResizeObserver(() => {
      if (viewer.clientWidth === width) return;
      width = viewer.clientWidth;
      measure();
    });
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [chunked, props.rows]);
  const chunks: ReactNode[] = [];
  if (chunked) for (let index = 0; index < props.rows.length; index += SOURCE_CHUNK_ROWS) {
    chunks.push(<div className="source-code-chunk" key={index}>{props.rows.slice(index, index + SOURCE_CHUNK_ROWS)}</div>);
  }
  return <div ref={ref} className="source-code-content">{chunked ? chunks : props.rows}</div>;
});

export function SourceCodeView(props: {
  preview: SourceSnippet;
  range: SourceRange;
  compacted: boolean;
  foldPresentation?: 'compaction' | 'gap';
  highlightedRanges?: readonly Pick<SourceRange, "startLine" | "endLine">[];
  lineAnnotations?: readonly { startLine: number; content: ReactNode }[];
  presentation: ContentPresentation;
  targetLine?: number;
  navigationRange?: SourceLocation['range'];
  onGoToDefinition?: (position: SourcePosition) => void;
  revealed?: boolean;
  revealRequestId?: number;
  initialScrollPosition?: { top: number; left: number };
  scrollState?: SourceScrollState;
  active?: boolean;
  onScrollPositionChange?: (position: { top: number; left: number }) => void;
  deferOffscreen?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialScroll = useRef(props.initialScrollPosition);
  const restoredSource = useRef<string | undefined>(undefined);
  const [highlighted, setHighlighted] = useState<TokensResult | null>(null);
  const [highlightFailed, setHighlightFailed] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(
    props.navigationRange ? collapsedSections(props.range, props.preview).filter(section =>
      props.navigationRange!.start.line + 1 >= section.startLine && props.navigationRange!.start.line + 1 <= section.endLine).map(sectionKey) : []));
  const [expandedGraphNodes, setExpandedGraphNodes] = useState<Set<string>>(() => new Set());
  const theme = useTheme();
  const source = useMemo(() => props.preview.lines.join("\n"), [props.preview.lines]);
  const sourceIdentity = `${props.preview.path}:${props.preview.startLine}:${source}`;
  const sections = useMemo(
    () => collapsedSections(props.range, props.preview),
    [props.preview, props.range.compactedSource]
  );
  const sectionsByStart = useMemo(
    () => new Map(sections.map((section) => [section.startLine, section])),
    [sections]
  );

  useEffect(() => {
    let cancelled = false;
    setHighlighted(null);
    setHighlightFailed(false);
    if (props.presentation.syntaxHighlighting === "plain") return undefined;
    void tokenizeSource(props.preview.path, source, theme).then((result) => {
      if (!cancelled) setHighlighted(result);
    }).catch(() => {
      if (!cancelled) setHighlightFailed(true);
    });
    return () => { cancelled = true; };
  }, [props.presentation.syntaxHighlighting, props.preview.path, source, theme]);

  useEffect(() => {
    const destination = props.navigationRange?.start.line;
    const next = new Set(destination === undefined ? [] : sections.filter(section => destination + 1 >= section.startLine && destination + 1 <= section.endLine).map(sectionKey));
    setExpandedSections(current => current.size === next.size && [...current].every(key => next.has(key)) ? current : next);
    setExpandedGraphNodes(new Set());
  }, [sourceIdentity, props.range.compactedSource, props.navigationRange, sections]);

  useLayoutEffect(() => {
    if (props.active === false) {
      restoredSource.current = undefined;
      return;
    }
    const viewer = scrollRef.current;
    if (!viewer) return;
    if (restoredSource.current !== sourceIdentity) {
      restoredSource.current = sourceIdentity;
      const position = props.scrollState?.read() ?? initialScroll.current;
      if (position) {
        viewer.scrollTop = position.top;
        viewer.scrollLeft = position.left;
        return;
      }
    }
    viewer.scrollLeft = 0;
    const line = props.targetLine ?? props.range.startLine;
    const foldedSection = props.compacted && props.presentation.sourceCompaction
      ? sections.find(section => line >= section.startLine && line <= section.endLine) : undefined;
    const target = viewer.querySelector<HTMLElement>(`[data-line="${line}"]`)
      ?? (foldedSection ? viewer.querySelector<HTMLElement>(`[data-line="${foldedSection.startLine}"]`) : null);
    let top = target?.offsetTop ?? 0;
    for (let parent = target?.offsetParent as HTMLElement | null; parent && parent !== viewer; parent = parent.offsetParent as HTMLElement | null) {
      top += parent.offsetTop;
    }
    viewer.scrollTop = target ? Math.max(0, top - viewer.clientHeight * 0.2) : 0;
    if (props.navigationRange) {
      const { start, end } = props.navigationRange;
      selectSourceRange(viewer, start.line + 1, start.character, end.line === start.line ? end.character : props.preview.lines[start.line - props.preview.startLine + 1]?.length ?? start.character);
    }
  }, [props.range.startLine, props.revealRequestId, props.targetLine, props.compacted, props.presentation.sourceCompaction, sections, sourceIdentity, props.scrollState, props.active, props.navigationRange ? expandedSections : undefined, props.navigationRange]);

  useLayoutEffect(() => {
    const viewer = scrollRef.current;
    if (!viewer || !props.scrollState || props.active === false) return;
    // A hidden document has no CSS box: its scroll getters return zero, not its retained offset.
    return props.scrollState.connect(() => viewer.getClientRects().length
      ? { top: viewer.scrollTop, left: viewer.scrollLeft } : undefined);
  }, [props.scrollState, sourceIdentity, props.active]);

  // Tokenization replaces text nodes; reapply the destination selection after that replacement.
  useLayoutEffect(() => {
    if (!props.navigationRange || !scrollRef.current || props.active === false || initialScroll.current) return;
    const { start, end } = props.navigationRange;
    selectSourceRange(scrollRef.current, start.line + 1, start.character,
      end.line === start.line ? end.character : props.preview.lines[start.line - props.preview.startLine + 1]?.length ?? start.character);
  }, [highlighted, expandedSections, props.navigationRange, props.active]);

  const rows = useMemo(() => {
    const annotationsByLine = new Map<number, ReactNode[]>();
    for (const annotation of props.lineAnnotations ?? []) {
      const annotations = annotationsByLine.get(annotation.startLine) ?? [];
      annotations.push(annotation.content);
      annotationsByLine.set(annotation.startLine, annotations);
    }
    const tokenLines = highlighted?.tokens ?? [];
    const rows: ReactNode[] = [];
    for (let index = 0; index < props.preview.lines.length;) {
      const lineNumber = props.preview.startLine + index;
      const selected = (props.highlightedRanges ?? [props.range]).some(
        (range) => lineNumber >= range.startLine && lineNumber <= range.endLine
      );
      const annotations = annotationsByLine.get(lineNumber);
      if (annotations) rows.push(<div className="source-line-annotations" key={`annotations:${lineNumber}`}>
        {annotations.map((annotation, index) => <div key={index}>{annotation}</div>)}
      </div>);
      const section = sectionsByStart.get(lineNumber);
      const key = section ? sectionKey(section) : "";
      const expanded = section ? expandedSections.has(key) : false;

      if (props.presentation.sourceCompaction && props.compacted && section && !expanded) {
        if (props.foldPresentation === 'gap') {
          rows.push(<div className="source-gap" data-line={section.startLine} key={`fold:${key}`}>
            <button type="button" aria-label={`Reveal all original lines ${section.startLine} through ${section.endLine}`}
              onClick={() => setExpandedSections(current => new Set(current).add(key))}>
              ··· {section.endLine - section.startLine + 1} lines hidden ···
            </button>
          </div>);
          index += section.endLine - section.startLine + 1;
          continue;
        }
        const graphLines = section.comment.replace(/\r\n?/g, "\n").split("\n");
        const nodesByGraphLine = new Map(section.nodes?.map((node) => [node.graphLine, node]) ?? []);
        const sourceIndent = props.preview.lines[index]?.match(/^\s*/)?.[0] ?? "";
        rows.push(
          <div
            className="source-fold-placeholder"
            data-line={section.startLine}
            data-selected={selected ? "true" : undefined}
            key={`fold:${key}`}
          >
            <span className="source-line-gutter">
              <button
                type="button"
                className="source-fold-marker source-section-fold-toggle"
                aria-label={`Reveal all original lines ${section.startLine} through ${section.endLine}`}
                title={`Reveal all lines ${section.startLine}-${section.endLine}`}
                onClick={() => setExpandedSections((current) => new Set(current).add(key))}
              >[+]</button>
            </span>
            <div className="source-fold-copy">
              <div className="source-call-graph-line">
                <span aria-hidden="true" />
                <span>{`${sourceIndent}// [Lines ${section.startLine}-${section.endLine} | ${section.endLine - section.startLine + 1} lines compacted]`}</span>
              </div>
              <div className="source-call-graph-line">
                <span aria-hidden="true" />
                <span>{`${sourceIndent}//`}</span>
              </div>
              {graphLines.map((line, graphIndex) => {
                const graphLine = graphIndex + 1;
                const node = nodesByGraphLine.get(graphLine);
                if (!node) {
                  return (
                    <div className="source-call-graph-line" key={`graph:${key}:${graphLine}`}>
                      <span aria-hidden="true" />
                      <span>{`${sourceIndent}//${line ? ` ${line}` : ""}`}</span>
                    </div>
                  );
                }
                const nodeKey = `${key}:${graphLine}`;
                const nodeExpanded = expandedGraphNodes.has(nodeKey);
                return (
                  <div className="source-call-graph-node-wrap" key={`graph:${nodeKey}`}>
                    <button
                      type="button"
                      className="source-call-graph-node"
                      data-graph-line={graphLine}
                      aria-expanded={nodeExpanded}
                      aria-label={`${nodeExpanded ? "Collapse" : "Reveal"} source lines ${node.startLine} through ${node.endLine} for graph node ${line.trim()}`}
                      onClick={() => setExpandedGraphNodes((current) => {
                        const next = new Set(current);
                        if (next.has(nodeKey)) next.delete(nodeKey);
                        else next.add(nodeKey);
                        return next;
                      })}
                    >
                      <span className="source-call-graph-node-marker" aria-hidden="true">{nodeExpanded ? "[-]" : "[+]"}</span>
                      <span>{`${sourceIndent}//${line ? ` ${line}` : ""}`}</span>
                    </button>
                    {nodeExpanded ? (
                      <GraphNodeSource node={node} preview={props.preview} tokenLines={tokenLines} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
        index += section.endLine - section.startLine + 1;
        continue;
      }

      rows.push(
        <div
          className={selected
            ? "source-code-line is-selected"
            : "source-code-line"}
          data-line={lineNumber}
          data-selected={selected
            ? "true"
            : undefined}
          key={`line:${lineNumber}`}
        >
          <span className="source-line-gutter">
            {props.presentation.sourceCompaction && props.compacted && section && expanded ? (
              <button
                type="button"
                className="source-fold-toggle"
                aria-label={`Collapse lines ${section.startLine} through ${section.endLine}`}
                title={`Collapse lines ${section.startLine}-${section.endLine}`}
                onClick={() => setExpandedSections((current) => {
                  const next = new Set(current);
                  next.delete(key);
                  return next;
                })}
              >[-]</button>
            ) : <span className="source-fold-spacer" aria-hidden="true" />}
            {props.presentation.sourceCompaction && props.compacted && section && expanded ? null : (
              <span className="source-line-number" aria-hidden="true">{lineNumber}</span>
            )}
          </span>
          <code className="source-line-text" data-source-text="">
            <SourceTokens tokens={tokenLines[index] ?? []} fallback={props.preview.lines[index]} />
          </code>
        </div>
      );
      index += 1;
    }

    return rows;
  }, [props.preview, props.highlightedRanges, props.range.startLine, props.range.endLine, props.lineAnnotations,
    props.presentation.sourceCompaction, props.compacted, props.foldPresentation, sectionsByStart, expandedSections, expandedGraphNodes, highlighted]);

  const rootStyle = {
    "--source-bg": highlighted?.bg ?? "var(--surface-code)",
    "--source-fg": highlighted?.fg ?? "var(--text-primary)"
  } as CSSProperties;

  return (
    <div
      ref={scrollRef}
      data-definitions={Boolean(props.onGoToDefinition)}
      onClick={event => {
        if (!(event.ctrlKey || event.metaKey) || !props.onGoToDefinition) return;
        const position = sourcePositionAtPoint(event.currentTarget, event.clientX, event.clientY);
        if (position) { event.preventDefault(); event.stopPropagation(); props.onGoToDefinition(position); }
      }}
      onKeyDown={event => {
        if (event.key !== 'F12' || !props.onGoToDefinition) return;
        event.preventDefault(); event.stopPropagation();
        const selection = window.getSelection();
        const position = sourcePositionAtNode(event.currentTarget, selection?.focusNode ?? null, selection?.focusOffset ?? 0);
        if (position) props.onGoToDefinition(position);
      }}
      onScroll={(event) => {
        const position = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft };
        if (position.top === 0 && position.left === 0 && !event.currentTarget.getClientRects().length) return;
        props.scrollState?.write(position);
        props.onScrollPositionChange?.(position);
      }}
      className={props.revealed ? "source-code-viewer is-revealed" : "source-code-viewer"}
      data-highlighted={highlighted ? "true" : "false"}
      data-language={contentLanguageName(props.preview.path, props.presentation)}
      data-presentation={props.presentation.syntaxHighlighting}
      data-wrap={props.presentation.wrap ? "true" : "false"}
      data-highlight-error={highlightFailed ? "true" : undefined}
      aria-label={props.presentation.syntaxHighlighting === "code"
        ? `Read-only ${sourceLanguageName(props.preview.path)} source code`
        : "Read-only plain text document"}
      aria-busy={props.presentation.syntaxHighlighting === "code" && !highlighted && !highlightFailed}
      tabIndex={0}
      style={rootStyle}
    >
      <SourceCodeContent rows={rows} deferOffscreen={Boolean(props.deferOffscreen && !props.presentation.wrap)} />
    </div>
  );
}
