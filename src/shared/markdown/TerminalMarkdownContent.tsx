import { useTheme } from "../theme/theme";
import { useEffect, useState } from "react";
import { renderTerminalMarkdownFragment } from "./render";

/** Embedded Markdown with shared parsing and code highlighting. Raw HTML stays escaped. */
export function TerminalMarkdownContent(props: { source: string; className?: string; onRendered?: () => void }) {
  const theme = useTheme();
  const [rendered, setRendered] = useState<{ source: string; theme: string; html: string }>();
  useEffect(() => {
    let cancelled = false;
    void renderTerminalMarkdownFragment(props.source, "", 0, theme).then((html) => {
      if (!cancelled) setRendered({ source: props.source, theme, html });
    }).catch(() => { /* Keep the escaped text fallback if rendering fails. */ });
    return () => { cancelled = true; };
  }, [props.source, theme]);
  const ready = rendered?.source === props.source && rendered?.theme === theme;
  useEffect(() => { if (ready) props.onRendered?.(); }, [ready, rendered, props.onRendered]);
  return ready
    ? <div className={props.className} data-rendered-markdown dangerouslySetInnerHTML={{ __html: rendered.html }} />
    : <div className={props.className}><p>{props.source}</p></div>;
}
