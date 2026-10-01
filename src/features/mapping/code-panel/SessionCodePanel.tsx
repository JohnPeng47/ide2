import { memo } from 'react';
import { useStore } from 'zustand';
import type { CanvasSession } from '../workspace/canvasSession';
import { CodePanel } from './CodePanel';

/** A panel subscribes to its own content, independent of parent selection/layout renders. */
export const SessionCodePanel = memo(function SessionCodePanel({ session, id }: { session: CanvasSession; id: string }) {
  const content = useStore(session.presentation, state => {
    const node = state.display.nodes[id];
    return node?.kind === 'projection' && node.content.kind === 'code-panel' ? node.content : undefined;
  });
  return content ? <CodePanel id={id} content={content} /> : null;
});
