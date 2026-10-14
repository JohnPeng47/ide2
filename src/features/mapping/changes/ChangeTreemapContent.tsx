import { useCallback, useEffect, useState } from 'react';
import { TreemapContent } from '../treemap/TreemapContent';
import type { TreemapCanvasColors, TreemapDiagramColor } from './treemapDiagramColors';
import { readChangeTreemaps, type ChangeTreemapRead, type DisplayModeChange } from './changeSessionApi';

export function ChangeTreemapContent({ mode, onNavigate, onCanvasColors }: {
  mode: DisplayModeChange; onCanvasColors?: (colors: TreemapCanvasColors | undefined) => void; onNavigate: (mode: DisplayModeChange) => void;
}) {
  const [data, setData] = useState<ChangeTreemapRead>(), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>, version: number | undefined;
    const refresh = async () => {
      let terminal = false;
      try {
        const next = await readChangeTreemaps(mode.sessionId, version, abort.signal);
        if (abort.signal.aborted) return;
        if (next) { version = next.version; setData(next); terminal = ['accepted', 'archived'].includes(next.status); }
        setError('');
      } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (!abort.signal.aborted && !terminal) timer = setTimeout(refresh, 2000); }
    };
    void refresh(); return () => { abort.abort(); clearTimeout(timer); };
  }, [mode.sessionId]);
  const publishColors = useCallback((diagrams: readonly TreemapDiagramColor[] | undefined) => {
    onCanvasColors?.(diagrams ? { sessionId: mode.sessionId, diagrams } : undefined);
  }, [mode.sessionId, onCanvasColors]);
  return <TreemapContent data={data} metric="diff" error={error} onCanvasColors={publishColors}
    notice={data && (data.unresolvedTargets > 0 || data.nonTextHunks > 0) ? <small className="treemap-notice">
      {data.unresolvedTargets > 0 && `${data.unresolvedTargets} unresolved destinations. `}
      {data.nonTextHunks > 0 && `${data.nonTextHunks} binary / metadata changes · no LOC area`}
    </small> : undefined}
    onNavigate={node => { if (node.target) onNavigate({ kind: 'change-session', sessionId: mode.sessionId,
      documentId: node.target.representationId, displayNodeId: node.target.displayNodeId,
      contentNodeId: node.target.contentNodeId, serial: Date.now() }); }} />;
}
