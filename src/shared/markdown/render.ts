import MarkdownIt from "markdown-it";
import { decorateMarkdownLinks, terminalRepositoryLinkController } from "./links";
import { highlightTerminalMarkdownFences, installTerminalCodeRenderer } from "./syntaxHighlight";
import { decorateTerminalMarkdownHeadings, type TerminalMarkdownOutline } from "./toc";

const markdownRenderer = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false
});
installTerminalCodeRenderer(markdownRenderer);

markdownRenderer.renderer.rules.heading_open = (tokens, index, options, environment, renderer) => {
  const token = tokens[index];
  const level = Number(token.tag.slice(1));
  const marker = Number.isInteger(level) && level > 0 ? `${"#".repeat(level)} ` : "";
  return `${renderer.renderToken(tokens, index, options)}${marker}`;
};

/** Shared markdown parser/highlighter without a document shell or required title. */
export async function renderTerminalMarkdownFragment(
  source: string,
  documentPath = "",
  sourceLineOffset = 0
): Promise<string> {
  const environment = {};
  const tokens = markdownRenderer.parse(source, environment);
  await highlightTerminalMarkdownFences(tokens);
  decorateTerminalMarkdownSourceLines(tokens, sourceLineOffset);
  decorateTerminalMarkdownHeadings(tokens);
  decorateMarkdownLinks(tokens, documentPath);
  return markdownRenderer.renderer.render(
    tokens,
    markdownRenderer.options,
    environment
  );
}

export async function renderTerminalMarkdownDocument(source: string, documentPath = ""): Promise<string> {
  const { title, markdown } = splitDocument(source);
  const content = await renderTerminalMarkdownFragment(markdown, documentPath, 1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: dark;
  --terminal-background: #0f1115;
  --terminal-foreground: #cdd6f4;
  --terminal-muted: #9399b2;
  --terminal-rule: #323232;
  --terminal-cyan: #88c0d0;
  --terminal-gold: #f9e2af;
}
html,
body {
  min-height: 100%;
  margin: 0;
  background: var(--terminal-background);
  color: var(--terminal-foreground);
}
body {
  box-sizing: border-box;
  padding: 1.5em 2ch 4.5em;
  font-family: "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  line-height: 1.5;
}
.terminal-markdown {
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  overflow-wrap: normal;
  word-break: normal;
}
.terminal-markdown-header {
  margin: 0 0 1.5em;
}
.terminal-markdown h1,
.terminal-markdown h2,
.terminal-markdown h3,
.terminal-markdown h4,
.terminal-markdown h5,
.terminal-markdown h6 {
  margin: 1.5em 0;
  outline: 0;
  color: inherit;
  font: inherit;
  scroll-margin-top: 1.5em;
}
.terminal-markdown-header h1 {
  margin: 0;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 0.14em;
}
.terminal-markdown h2 {
  font-weight: 700;
}
.terminal-markdown h3,
.terminal-markdown h4,
.terminal-markdown h5,
.terminal-markdown h6 {
  font-weight: 700;
  font-style: italic;
}
.terminal-markdown h1:focus-visible,
.terminal-markdown h2:focus-visible,
.terminal-markdown h3:focus-visible,
.terminal-markdown h4:focus-visible,
.terminal-markdown h5:focus-visible,
.terminal-markdown h6:focus-visible {
  color: var(--terminal-cyan);
}
.terminal-markdown p {
  margin: 0 0 1.5em;
}
.terminal-markdown ul,
.terminal-markdown ol {
  margin: 0 0 1.5em;
  padding-left: 2ch;
}
.terminal-markdown ul {
  list-style: none;
}
.terminal-markdown li {
  position: relative;
  margin: 0;
  padding: 0;
}
.terminal-markdown ul > li::before {
  position: absolute;
  left: -2ch;
  content: "-";
}
.terminal-markdown li > p {
  margin: 0;
}
.terminal-markdown li > ul,
.terminal-markdown li > ol {
  margin: 0;
  padding-left: 2ch;
}
.terminal-markdown blockquote {
  margin: 0 0 1.5em;
  padding: 0 0 0 2ch;
  color: inherit;
}
.terminal-markdown blockquote > p {
  position: relative;
  margin: 0;
}
.terminal-markdown blockquote > p::before {
  position: absolute;
  left: -2ch;
  color: var(--terminal-muted);
  content: ">";
}
.terminal-markdown strong {
  color: inherit;
  font-weight: 700;
}
.terminal-markdown em {
  font-style: italic;
}
.terminal-markdown code {
  font: inherit;
}
.terminal-markdown :not(pre) > code {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--terminal-cyan);
}
.terminal-markdown pre,
.terminal-code-block,
.terminal-code-block pre {
  box-sizing: border-box;
  max-width: 100%;
  margin: 0 0 1.5em;
  padding: 0;
  overflow-x: auto;
  border: 0;
  background: transparent !important;
  color: inherit;
  font: inherit;
  line-height: inherit;
  tab-size: 2;
  scrollbar-width: thin;
  scrollbar-color: var(--terminal-muted) transparent;
}
.terminal-code-block pre {
  margin: 0;
}
.terminal-markdown pre code,
.terminal-code-block pre code {
  display: block;
  padding: 0;
  background: transparent !important;
  font: inherit;
  line-height: inherit;
}
.terminal-markdown table {
  width: auto;
  max-width: 100%;
  margin: 0 0 1.5em;
  border-collapse: separate;
  border-spacing: 2ch 0;
  font: inherit;
}
.terminal-markdown th,
.terminal-markdown td {
  padding: 0.3em 0;
  border: 0;
  text-align: left;
  vertical-align: top;
}
.terminal-markdown th {
  border-bottom: 2px solid var(--terminal-rule);
  color: var(--terminal-gold);
  font-weight: 700;
}
.terminal-markdown tbody tr:not(:last-child) td {
  border-bottom: 1px solid var(--terminal-rule);
}
.terminal-markdown a {
  color: var(--terminal-cyan);
  text-decoration: none;
}
.terminal-markdown a:hover,
.terminal-markdown a:focus-visible {
  outline: 0;
  text-decoration: underline;
  text-underline-offset: 0.14em;
}
.terminal-markdown .is-source-selection {
  border-radius: 2px;
  background: rgb(249 226 175 / 8%) !important;
  box-shadow: -2px 0 var(--terminal-gold);
}
.terminal-markdown hr {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--terminal-rule);
}
@media (max-width: 700px) {
  body {
    padding-right: 2ch;
    padding-left: 2ch;
  }
  .terminal-markdown table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
</head>
<body>
<article class="terminal-markdown" data-cms-document="terminal-markdown" data-cms-transform-root>
  <header class="terminal-markdown-header">
    <h1 data-source-start-line="1" data-source-end-line="1"># ${escapeHtml(title)}</h1>
  </header>
${content}</article>
${terminalRepositoryLinkController()}
</body>
</html>`;
}

export function parseTerminalMarkdownOutline(source: string): TerminalMarkdownOutline {
  const { title, markdown } = splitDocument(source);
  const tokens = markdownRenderer.parse(markdown, {});
  const headings = decorateTerminalMarkdownHeadings(tokens);
  const documentEndLine = source.replace(/\r\n?/g, "\n").split("\n").length;
  return {
    title,
    sections: headings.map((heading, index) => {
      const nextPeer = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
      return {
        ...heading,
        endLine: Math.max(heading.startLine, (nextPeer?.startLine ?? documentEndLine + 1) - 1)
      };
    })
  };
}

function decorateTerminalMarkdownSourceLines(tokens: import("markdown-it").Token[], offset: number): void {
  for (const token of tokens) {
    if (token.map) {
      token.attrSet("data-source-start-line", String(token.map[0] + 1 + offset));
      token.attrSet("data-source-end-line", String(token.map[1] + offset));
    }
    if (token.children) decorateTerminalMarkdownSourceLines(token.children, offset);
  }
}

export function renderTerminalMarkdownErrorDocument(message: string): string {
  return `<!DOCTYPE html><html><body style="background:#0f1115;color:#f38ba8;font-family:monospace;padding:1.5em 2ch">${escapeHtml(message)}</body></html>`;
}

function splitDocument(source: string): { title: string; markdown: string } {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const titleMatch = /^# (.+)$/.exec(lines[0] ?? "");
  if (!titleMatch) throw new Error("Terminal Markdown must start with a level-one title");
  return {
    title: titleMatch[1],
    markdown: lines.slice(1).join("\n")
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
