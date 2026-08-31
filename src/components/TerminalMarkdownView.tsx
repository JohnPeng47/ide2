import { useEffect, useRef, useState } from "react";
import {
  parseTerminalMarkdownOutline,
  renderTerminalMarkdownDocument,
  renderTerminalMarkdownErrorDocument
} from "../terminalMarkdown/render";
import {
  TERMINAL_MARKDOWN_ACTIVE_SECTION_MESSAGE,
  TERMINAL_MARKDOWN_OPEN_FILE_MESSAGE,
  TERMINAL_MARKDOWN_REVEAL_LINE_MESSAGE
} from "../terminalMarkdown/links";
import type { TerminalMarkdownOutline } from "../terminalMarkdown/toc";

export function isMarkdownDocumentPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

export function TerminalMarkdownView(props: {
  source: string;
  path: string;
  targetLine?: number;
  targetRange?: { startLine: number; endLine: number };
  jumpRequestId?: number;
  onOpenRepositoryFile?: (path: string) => void;
  onOutlineChange?: (outline: TerminalMarkdownOutline & { path: string }) => void;
  onActiveSectionChange?: (section: { id: string; line: number; scrollTop: number }) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [document, setDocument] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDocument(null);
    try {
      props.onOutlineChange?.({ path: props.path, ...parseTerminalMarkdownOutline(props.source) });
    } catch {
      // The renderer below owns the visible validation error.
    }
    void renderTerminalMarkdownDocument(props.source, props.path)
      .then((rendered) => {
        if (!cancelled) setDocument(rendered);
      })
      .catch((caught) => {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : "Markdown rendering failed";
          setDocument(renderTerminalMarkdownErrorDocument(message));
        }
      });
    return () => { cancelled = true; };
  }, [props.path, props.source, props.onOutlineChange]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== "object") return;
      const payload = event.data as {
        type?: unknown;
        path?: unknown;
        id?: unknown;
        line?: unknown;
        scrollTop?: unknown;
      };
      if (payload.type === TERMINAL_MARKDOWN_OPEN_FILE_MESSAGE
        && typeof payload.path === "string"
        && props.onOpenRepositoryFile) {
        props.onOpenRepositoryFile(payload.path);
      } else if (payload.type === TERMINAL_MARKDOWN_ACTIVE_SECTION_MESSAGE
        && typeof payload.id === "string"
        && typeof payload.line === "number"
        && typeof payload.scrollTop === "number") {
        props.onActiveSectionChange?.({ id: payload.id, line: payload.line, scrollTop: payload.scrollTop });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.onActiveSectionChange, props.onOpenRepositoryFile]);

  const revealTargetLine = () => {
    if (!props.targetLine) return;
    frameRef.current?.contentWindow?.postMessage({
      type: TERMINAL_MARKDOWN_REVEAL_LINE_MESSAGE,
      line: props.targetLine,
      startLine: props.targetRange?.startLine,
      endLine: props.targetRange?.endLine,
      behavior: props.jumpRequestId ? "smooth" : "auto"
    }, "*");
  };

  useEffect(() => {
    if (document) revealTargetLine();
  }, [
    document,
    props.jumpRequestId,
    props.targetLine,
    props.targetRange?.endLine,
    props.targetRange?.startLine
  ]);

  if (!document) return <p className="source-state">Rendering Markdown...</p>;
  return (
    <iframe
      ref={frameRef}
      className="terminal-markdown-frame"
      title={`Rendered Markdown: ${props.path}`}
      sandbox="allow-scripts allow-popups"
      srcDoc={document}
      onLoad={revealTargetLine}
    />
  );
}
