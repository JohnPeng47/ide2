import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ThemedToken, TokensResult } from "shiki";
import type { SourceSnippet } from "../api";
import type { CompactedSourceNode, CompactedSourceSection, SourceRange } from "../domain";

const SHIKI_THEME = "dark-plus";
const TOKEN_CACHE_LIMIT = 40;

const LANGUAGE_BY_EXTENSION: Record<string, { id: string; name: string }> = {
  c: { id: "c", name: "C" },
  cc: { id: "cpp", name: "C++" },
  cjs: { id: "javascript", name: "JavaScript" },
  cpp: { id: "cpp", name: "C++" },
  cs: { id: "csharp", name: "C#" },
  css: { id: "css", name: "CSS" },
  cts: { id: "typescript", name: "TypeScript" },
  dockerfile: { id: "dockerfile", name: "Dockerfile" },
  go: { id: "go", name: "Go" },
  h: { id: "c", name: "C" },
  hpp: { id: "cpp", name: "C++" },
  html: { id: "html", name: "HTML" },
  java: { id: "java", name: "Java" },
  js: { id: "javascript", name: "JavaScript" },
  json: { id: "json", name: "JSON" },
  jsonc: { id: "jsonc", name: "JSON with Comments" },
  jsx: { id: "jsx", name: "JSX" },
  less: { id: "less", name: "Less" },
  lua: { id: "lua", name: "Lua" },
  makefile: { id: "makefile", name: "Makefile" },
  md: { id: "markdown", name: "Markdown" },
  mjs: { id: "javascript", name: "JavaScript" },
  mts: { id: "typescript", name: "TypeScript" },
  php: { id: "php", name: "PHP" },
  ps1: { id: "powershell", name: "PowerShell" },
  py: { id: "python", name: "Python" },
  pyi: { id: "python", name: "Python" },
  pyw: { id: "python", name: "Python" },
  rb: { id: "ruby", name: "Ruby" },
  rs: { id: "rust", name: "Rust" },
  sass: { id: "sass", name: "Sass" },
  scss: { id: "scss", name: "SCSS" },
  sh: { id: "bash", name: "Shell" },
  sql: { id: "sql", name: "SQL" },
  svelte: { id: "svelte", name: "Svelte" },
  swift: { id: "swift", name: "Swift" },
  toml: { id: "toml", name: "TOML" },
  ts: { id: "typescript", name: "TypeScript" },
  tsx: { id: "tsx", name: "TSX" },
  vue: { id: "vue", name: "Vue" },
  xml: { id: "xml", name: "XML" },
  yaml: { id: "yaml", name: "YAML" },
  yml: { id: "yaml", name: "YAML" },
  zig: { id: "zig", name: "Zig" },
  zsh: { id: "zsh", name: "Zsh" }
};

const tokenCache = new Map<string, Promise<TokensResult>>();

function languageKey(path: string): string {
  const filename = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (filename in LANGUAGE_BY_EXTENSION) return filename;
  return filename.includes(".") ? filename.split(".").at(-1) ?? "" : filename;
}

function languageForPath(path: string): { id: string; name: string } {
  return LANGUAGE_BY_EXTENSION[languageKey(path)] ?? { id: "text", name: "Plain text" };
}

export function sourceLanguageName(path: string): string {
  return languageForPath(path).name;
}

async function tokenizeSource(path: string, source: string): Promise<TokensResult> {
  const configuredLanguage = LANGUAGE_BY_EXTENSION[languageKey(path)]?.id;
  const candidateLanguage = configuredLanguage ?? languageKey(path);
  const key = `${SHIKI_THEME}\0${candidateLanguage}\0${source}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;

  const pending = import("shiki").then(({ bundledLanguagesInfo, codeToTokens }) => {
    const bundledLanguage = bundledLanguagesInfo.find((language) => (
      language.id === candidateLanguage || language.aliases?.includes(candidateLanguage)
    ));
    const language = configuredLanguage ?? bundledLanguage?.id ?? "text";
    return codeToTokens(source, {
      lang: language as Parameters<typeof codeToTokens>[1]["lang"],
      theme: SHIKI_THEME
    });
  });
  tokenCache.set(key, pending);
  if (tokenCache.size > TOKEN_CACHE_LIMIT) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  pending.catch(() => tokenCache.delete(key));
  return pending;
}

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
        <code>
          <SourceTokens tokens={props.tokenLines[index] ?? []} fallback={props.preview.lines[index]} />
        </code>
      </div>
    );
  }
  return <div className="source-call-graph-node-source">{rows}</div>;
}

export function SourceCodeView(props: {
  preview: SourceSnippet;
  range: SourceRange;
  compacted: boolean;
  revealed?: boolean;
  revealRequestId?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [highlighted, setHighlighted] = useState<TokensResult | null>(null);
  const [highlightFailed, setHighlightFailed] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [expandedGraphNodes, setExpandedGraphNodes] = useState<Set<string>>(() => new Set());
  const source = useMemo(() => props.preview.lines.join("\n"), [props.preview.lines]);
  const sourceIdentity = `${props.preview.path}:${props.preview.startLine}:${source}`;
  const sections = useMemo(
    () => collapsedSections(props.range, props.preview),
    [props.preview, props.range]
  );
  const sectionsByStart = useMemo(
    () => new Map(sections.map((section) => [section.startLine, section])),
    [sections]
  );

  useEffect(() => {
    let cancelled = false;
    setHighlighted(null);
    setHighlightFailed(false);
    void tokenizeSource(props.preview.path, source).then((result) => {
      if (!cancelled) setHighlighted(result);
    }).catch(() => {
      if (!cancelled) setHighlightFailed(true);
    });
    return () => { cancelled = true; };
  }, [props.preview.path, source]);

  useEffect(() => {
    setExpandedSections(new Set());
    setExpandedGraphNodes(new Set());
  }, [sourceIdentity, props.range.compactedSource]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [props.revealRequestId, sourceIdentity]);

  const tokenLines = highlighted?.tokens ?? [];
  const rows: ReactNode[] = [];
  for (let index = 0; index < props.preview.lines.length;) {
    const lineNumber = props.preview.startLine + index;
    const section = sectionsByStart.get(lineNumber);
    const key = section ? sectionKey(section) : "";
    const expanded = section ? expandedSections.has(key) : false;

    if (props.compacted && section && !expanded) {
      const graphLines = section.comment.replace(/\r\n?/g, "\n").split("\n");
      const nodesByGraphLine = new Map(section.nodes?.map((node) => [node.graphLine, node]) ?? []);
      const sourceIndent = props.preview.lines[index]?.match(/^\s*/)?.[0] ?? "";
      rows.push(
        <div
          className="source-fold-placeholder"
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
      <div className="source-code-line" data-line={lineNumber} key={`line:${lineNumber}`}>
        <span className="source-line-gutter">
          {props.compacted && section && expanded ? (
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
          {props.compacted && section && expanded ? null : (
            <span className="source-line-number" aria-hidden="true">{lineNumber}</span>
          )}
        </span>
        <code className="source-line-text">
          <SourceTokens tokens={tokenLines[index] ?? []} fallback={props.preview.lines[index]} />
        </code>
      </div>
    );
    index += 1;
  }

  const rootStyle = {
    "--source-bg": highlighted?.bg ?? "#1e1e1e",
    "--source-fg": highlighted?.fg ?? "#d4d4d4"
  } as CSSProperties;

  return (
    <div
      ref={scrollRef}
      className={props.revealed ? "source-code-viewer is-revealed" : "source-code-viewer"}
      data-highlighted={highlighted ? "true" : "false"}
      data-language={sourceLanguageName(props.preview.path)}
      data-highlight-error={highlightFailed ? "true" : undefined}
      aria-label={`Read-only ${sourceLanguageName(props.preview.path)} source code`}
      aria-busy={!highlighted && !highlightFailed}
      tabIndex={0}
      style={rootStyle}
    >
      <div className="source-code-content">{rows}</div>
    </div>
  );
}
