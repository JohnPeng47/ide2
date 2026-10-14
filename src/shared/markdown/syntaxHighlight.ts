import type { MarkdownIt, Token } from "markdown-it";

import { themeDefinitions, type ThemeName } from "../theme/themeDefinitions";
const MAX_HIGHLIGHT_BYTES = 512 * 1024;
const MAX_HIGHLIGHT_LINES = 10_000;
const CACHE_LIMIT = 80;

const LANGUAGE_ALIASES: Record<string, string> = {
  "c-sharp": "csharp",
  csharp: "csharp",
  cxx: "cpp",
  golang: "go",
  js: "javascript",
  py: "python",
  python3: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript"
};

const highlightCache = new Map<string, Promise<string | null>>();

export function installTerminalCodeRenderer(markdown: MarkdownIt): void {
  const fallback = markdown.renderer.rules.fence;
  if (!fallback) throw new Error("markdown-it fence renderer is unavailable");
  markdown.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
    const highlighted = tokens[index].meta?.terminalHighlightedHtml;
    return typeof highlighted === "string"
      ? `<div class="terminal-code-block"${renderer.renderAttrs(tokens[index])}>${highlighted}</div>\n`
      : fallback(tokens, index, options, environment, renderer);
  };
}

export async function highlightTerminalMarkdownFences(tokens: Token[], theme: ThemeName = "dark"): Promise<void> {
  await Promise.all(tokens.filter((token) => token.type === "fence").map(async (token) => {
    const language = requestedLanguage(token.info);
    if (!language || exceedsLimits(token.content)) return;
    const html = await highlightedCode(token.content, language, theme);
    if (html) token.meta = { ...token.meta, terminalHighlightedHtml: html };
  }));
}

function requestedLanguage(info: string): string | null {
  const requested = info.trim().toLowerCase().split(/[\s,]/, 1)[0];
  if (!requested) return null;
  return LANGUAGE_ALIASES[requested] ?? requested;
}

function exceedsLimits(code: string): boolean {
  return code.length > MAX_HIGHLIGHT_BYTES || code.split("\n").length > MAX_HIGHLIGHT_LINES;
}

function highlightedCode(code: string, language: string, theme: ThemeName): Promise<string | null> {
  const SHIKI_THEME = themeDefinitions[theme].markdown;
  const key = `${SHIKI_THEME}\0${language}\0${code}`;
  const cached = highlightCache.get(key);
  if (cached) return cached;
  const pending = import("shiki").then(({ bundledLanguagesInfo, codeToHtml }) => {
    const bundledLanguage = bundledLanguagesInfo.find((entry) => (
      entry.id === language || entry.aliases?.includes(language)
    ));
    if (!bundledLanguage) return null;
    return codeToHtml(code, { lang: bundledLanguage.id, theme: SHIKI_THEME });
  })
    .catch(() => null);
  highlightCache.set(key, pending);
  if (highlightCache.size > CACHE_LIMIT) {
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
  return pending;
}
