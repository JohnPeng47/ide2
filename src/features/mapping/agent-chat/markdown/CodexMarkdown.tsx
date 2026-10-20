import { Children, createContext, useContext, isValidElement, memo, useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import { ChatHighlightLink } from '../ChatHighlightLink';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { createIncrementalMarkdownPlugin } from './markdown-incremental';
import { remarkNormalizeListItemIndentation } from './markdown-list-indentation';
import { remarkGithubAlerts } from './markdown-github-alerts';
import { CodexMarkdownTable } from './CodexMarkdownTable';
import { ChatFileLink } from '../ChatFileLinks';
import { CopyButton } from './CopyButton';
import { CopyToCanvasButton } from '../ChatCanvasCopy';
import { useTheme, themeDefinitions } from '../../../../shared/theme/theme';
import { useSelectableStream } from './useSelectableStream';

export const MarkdownActivityContext = createContext(true);

// Port of T3 Code's CodexMarkdown/ChatMarkdown pipeline (40596072).
// The app-specific media, PR, and desktop handlers are replaced by browser-safe elements.
const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const theme = useTheme();
  const enabled = useContext(MarkdownActivityContext);
  const diagram = ['', 'text', 'txt', 'plaintext', 'plain', 'ascii', 'diagram'].includes(language.toLowerCase());
  const contentId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const lineCount = useMemo(() => code ? code.split('\n').length : 0, [code]);
  const [highlight, setHighlight] = useState<{ code: string; language: string; theme: string; html: string }>();
  useEffect(() => {
    if (!enabled || diagram || collapsed || (highlight?.code === code && highlight.language === language && highlight.theme === theme)) return;
    let cancelled = false;
    // Throttle highlighting while tokens stream; the plain code remains readable immediately.
    const timer = setTimeout(() => {
      if (code.length > 100_000 || !language) return;
      void import('shiki').then(async ({ bundledLanguagesInfo, codeToHtml }) => {
        const lang = bundledLanguagesInfo.find(entry => entry.id === language || entry.aliases?.includes(language));
        if (!lang) return;
        const html = await codeToHtml(code, { lang: lang.id, theme: themeDefinitions[theme].markdown });
        if (!cancelled) setHighlight({ code, language, theme, html });
      }).catch(() => {});
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code, language, theme, enabled, diagram, collapsed, highlight]);
  const toggle = <button type="button" className="agent-block-toggle" aria-expanded={!collapsed} aria-controls={contentId}
    onClick={() => setCollapsed(value => !value)}>{collapsed ? `▸ ${lineCount} ${lineCount === 1 ? 'line' : 'lines'} collapsed` : '▾ Collapse'}</button>;
  if (diagram) return <div className="agent-code-block agent-diagram-block">
    <div className="agent-diagram-toggle">{toggle}</div>
    <div id={contentId} hidden={collapsed}>{!collapsed && <pre><code>{code}</code></pre>}</div>
    <div className="agent-diagram-actions"><CopyButton text={code} label="Copy code" /><CopyToCanvasButton text={code} enabled={enabled} /></div>
  </div>;
  return <div className="agent-code-block"><header><span>{language || 'text'}</span>{toggle}<CopyButton text={code} label="Copy code" /></header>
    <div id={contentId} hidden={collapsed}>{!collapsed && (highlight?.code === code && highlight.language === language && highlight.theme === theme ? <div dangerouslySetInnerHTML={{ __html: highlight.html }} /> : <pre><code>{code}</code></pre>)}</div>
  </div>;
});
const components: Components = {
  pre({ children }) {
    const child = Children.toArray(children).find(isValidElement) as ReactElement<{ children?: string; className?: string }> | undefined;
    return child ? <CodeBlock code={String(child.props.children ?? '').replace(/\n$/, '')} language={/language-([^\s]+)/.exec(child.props.className ?? '')?.[1] ?? ''} /> : <pre>{children}</pre>;
  },
  table: ({ node: _node, ...props }) => <CodexMarkdownTable {...props} />,
  a({ href, children, title }) {
    if (!href) return <span>{children}</span>;
    if (href.startsWith('highlight:')) return <ChatHighlightLink href={href}>{children}</ChatHighlightLink>;
    if (/^https?:\/\//i.test(href) || href.startsWith('mailto:')) return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>;
    // File references are visible and copyable; never navigate the SPA to a filesystem path.
    return <ChatFileLink href={href}>{children}</ChatFileLink>;
  },
  img: ({ src, alt }) => src && /^https?:\/\//i.test(src) ? <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" /> : <span>{alt || 'Image'}</span>,
  blockquote({ children, node }) {
    const alert = node?.properties?.dataAlert;
    return <blockquote data-alert={alert}>{typeof alert === 'string' && <strong className="agent-alert-title">{alert}</strong>}{children}</blockquote>;
  }
};
export const CodexMarkdown = memo(function CodexMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const enabled = useContext(MarkdownActivityContext);
  const display = useSelectableStream(text, streaming);
  const plugins = useMemo(() => [remarkGfm, remarkGithubAlerts, remarkNormalizeListItemIndentation, remarkBreaks,
    ...(display.streaming ? [createIncrementalMarkdownPlugin()] : [])], [display.streaming]);
  return <MarkdownActivityContext.Provider value={enabled && !display.streaming}><div ref={display.root} className="agent-markdown" onPointerDown={display.onPointerDown}><ReactMarkdown remarkPlugins={plugins} components={components}
    urlTransform={url => /^(file|highlight):/i.test(url) ? url : defaultUrlTransform(url)}>{display.text}</ReactMarkdown></div></MarkdownActivityContext.Provider>;
});
