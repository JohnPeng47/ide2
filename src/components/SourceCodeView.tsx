import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ThemedToken, TokensResult } from "shiki";
import type { SourceSnippet } from "../api";
import type { CompactedSourceSection, SourceRange } from "../domain";

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
      rows.push(
        <button
          type="button"
          className="source-fold-placeholder"
          aria-label={`Reveal original lines ${section.startLine} through ${section.endLine}`}
          onClick={() => setExpandedSections((current) => new Set(current).add(key))}
          key={`fold:${key}`}
        >
          <span className="source-line-gutter" aria-hidden="true">
            <span className="source-fold-marker">[+]</span>
            <span>{section.startLine}</span>
          </span>
          <span className="source-fold-copy">
            {`// Lines ${section.startLine}-${section.endLine}: ${section.comment} (${section.endLine - section.startLine + 1} lines)`}
          </span>
        </button>
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
          <span className="source-line-number" aria-hidden="true">{lineNumber}</span>
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
