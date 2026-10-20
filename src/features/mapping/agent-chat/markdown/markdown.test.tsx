import { ChatHighlightContext } from '../ChatHighlightLink';
import { highlightReferenceUrl, parseHighlightReference } from '../../../../../domain/mapping/agent-chat/highlightReference';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { createIncrementalMarkdownPlugin } from './markdown-incremental';
import { remarkNormalizeListItemIndentation } from './markdown-list-indentation';
import { remarkGithubAlerts } from './markdown-github-alerts';
import { CodexMarkdown } from './CodexMarkdown';
import { codexTableLayout } from './codexTableLayout';

describe('ported t3code markdown', () => {
  it('keeps streaming fences and document-wide references equivalent to a full parse', () => {
    const plugin = createIncrementalMarkdownPlugin();
    const prefix = '# Title\n\n```ts\nconst x = 1;\n```\n\n';
    for (const text of [prefix, `${prefix}**Partial`, `${prefix}**Finished**\n\n[link][ref]\n\n[ref]: https://example.com`, 'Replacement\r\ntext']) {
      const render = (incremental: boolean) => renderToStaticMarkup(createElement(Markdown, { children: text, remarkPlugins: [remarkGfm, ...(incremental ? [plugin] : [])] }));
      expect(render(true)).toBe(render(false));
    }
  });
  it('recovers spaced chat lists while preserving fenced code and GitHub alerts', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { children: '-       **bold**\n\n> [!NOTE]\n> Helpful\n\n```ts\nconst x = 1;\n```', remarkPlugins: [remarkNormalizeListItemIndentation, remarkGithubAlerts] }));
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('data-alert="note"');
    expect(html).toContain('class="language-ts"');
  });
  it('escapes HTML, rejects script URLs and prevents filesystem links navigating the app', () => {
    const html = renderToStaticMarkup(<CodexMarkdown text={'<script>alert(1)</script>\n\n[bad](javascript:alert) [file](/tmp/file.ts) [web](https://example.com)'} />);
    expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('href="/tmp/');
    expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('title="/tmp/file.ts"');
  });
  it('switches narrow tables to labeled records without dropping cells', () => {
    const layout = codexTableLayout(['Feature', 'Description'], [['LongFeatureName', 'A lengthy description that needs space to remain readable.']], 20);
    expect(layout.records).toBe(true); expect(layout.stacked).toBe(true);
    expect(codexTableLayout(['A', 'B'], [['One', 'Two']], 80).records).toBe(false);
  });
});


it('renders saved highlight markers as local navigation buttons and handles malformed destinations safely', () => {
  const target = { documentId: 'doc with spaces', nodeId: 'grid:overview', highlightId: 'highlight-1' };
  const url = highlightReferenceUrl(target);
  expect(parseHighlightReference(url)).toEqual(target);
  const html = renderToStaticMarkup(<ChatHighlightContext.Provider value={() => {}}><CodexMarkdown text={`[Service](${url})`} /></ChatHighlightContext.Provider>);
  expect(html).toContain('agent-highlight-reference');
  expect(html).toContain('Jump to saved highlight');
  expect(html).not.toContain('href=');
  for (const value of ['highlight:%broken/grid:overview/id', 'highlight:doc/grid:overview', 'highlight:doc/not-a-diagram/id', 'javascript:alert(1)']) expect(parseHighlightReference(value)).toBeUndefined();
  const missing = renderToStaticMarkup(<CodexMarkdown text={`[Service](${url})`} />);
  expect(missing).toContain('Highlight reference unavailable');
});
