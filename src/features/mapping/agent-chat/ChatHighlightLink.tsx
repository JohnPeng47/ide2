import { createContext, useContext, useState, type ReactNode } from 'react';
import { parseHighlightReference, type HighlightReference } from '../../../../domain/mapping/agent-chat/highlightReference';

export type OpenHighlightReference = (target: HighlightReference) => void | Promise<void>;
export const ChatHighlightContext = createContext<OpenHighlightReference | undefined>(undefined);
export function ChatHighlightLink({ href, children }: { href: string; children: ReactNode }) {
  const open = useContext(ChatHighlightContext), target = parseHighlightReference(href);
  const [error, setError] = useState('');
  const jump = async () => {
    setError('');
    try { await open?.(target!); }
    catch (error) { setError(error instanceof Error ? error.message : 'Highlight reference unavailable'); }
  };
  return target && open ? <span><button type="button" className="agent-file-reference agent-highlight-reference" title="Jump to saved highlight"
    onClick={() => void jump()}>{children}</button>{error && <small role="alert"> {error}</small>}</span> : <span title="Highlight reference unavailable">{children}</span>;
}
