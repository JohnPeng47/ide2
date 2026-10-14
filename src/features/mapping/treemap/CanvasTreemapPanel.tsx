import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { buildCanvasTreemaps, canvasTreemapInput, type CanvasSourceFile, type CanvasSourceRead, type CanvasTreemapScope } from '../../../../domain/mapping/treemap/canvasTreemap';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import type { CanvasSession } from '../workspace/canvasSession';
import type { TreemapDiagramColor } from '../changes/treemapDiagramColors';
import { useMappingServices } from '../services/MappingServices';
import { WindowPanel, type WindowPanelLayout } from '../window-panel/WindowPanel';
import { TreemapContent } from './TreemapContent';

const scopeKey = 'canvas-treemap-scope';
const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
export function CanvasTreemapPanel({ session, documentId, projectId, name, onClose, onNavigate, onCanvasColors }: {
  session: CanvasSession; documentId: string; projectId: string; name: string; onClose: () => void;
  onNavigate: (target: DiagramJumpTarget) => void;
  onCanvasColors: (colors: readonly TreemapDiagramColor[] | undefined) => void;
}) {
  const { codeRepo } = useMappingServices();
  const scene = useStore(session.document, state => state.document.scene);
  const input = useMemo(() => canvasTreemapInput(scene, documentId), [scene, documentId]);
  const fileKey = JSON.stringify(input.files);
  const files = useMemo(() => JSON.parse(fileKey) as CanvasSourceFile[], [fileKey]);
  const [attempt, setAttempt] = useState(0);
  const [reads, setReads] = useState<{ key: string; files: Map<string, CanvasSourceRead> }>();
  const [scope, setScope] = useState<CanvasTreemapScope>(() => {
    try { return localStorage.getItem(scopeKey) === 'files' ? 'files' : 'mapped'; } catch { return 'mapped'; }
  });
  const [layout, setLayout] = useState<WindowPanelLayout<'treemaps'>>({ mode: 'full-single', pane: 'treemaps', focusedPane: 'treemaps', minimized: false, ratio: 1, minimizedWidth: .45, expandedWidth: .5 });
  useEffect(() => { try { localStorage.setItem(scopeKey, scope); } catch { /* Optional storage. */ } }, [scope]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setReads(undefined);
    const results = new Map<string, CanvasSourceRead>();
    let index = 0;
    const worker = async () => {
      while (index < files.length && !abort.signal.aborted) {
        const file = files[index++];
        try {
          const result = await codeRepo.readFile({ projectId, sourceId: file.binding.sourceId }, file.path, { signal: abort.signal, reload: true });
          results.set(file.key, { text: result.text });
        } catch (error) { results.set(file.key, { error: error instanceof Error ? error.message : 'Could not read file' }); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, files.length) }, worker)).then(() => {
      if (!abort.signal.aborted) setReads({ key: fileKey, files: results });
    });
    return () => abort.abort();
  }, [codeRepo, projectId, files, fileKey, attempt]);
  const data = useMemo(() => reads?.key === fileKey ? buildCanvasTreemaps(input, reads.files, scope) : undefined, [input, reads, fileKey, scope]);
  const navigate = useCallback((node: Parameters<Parameters<typeof TreemapContent>[0]['onNavigate']>[0]) => {
    if (node.target) onNavigate(node.target);
  }, [onNavigate]);
  return <WindowPanel className="canvas-treemap-window" title={`${name} · Treemaps`} canvasId={documentId} state={layout}
    onChange={patch => setLayout(value => ({ ...value, ...patch }))} onClose={onClose} canvas={null}
    panes={[{ id: 'treemaps', title: 'Treemaps', content: <TreemapContent data={data} metric="source" onNavigate={navigate} onCanvasColors={onCanvasColors}
      controls={<div className="change-treemap-switch" role="group" aria-label="Treemap scope">
        <label>Scope <select aria-label="Treemap scope" value={scope} onChange={event => setScope(event.target.value as CanvasTreemapScope)}>
          <option value="mapped">Mapped ranges</option><option value="files">Referenced files</option>
        </select></label>
        <button onClick={() => setAttempt(value => value + 1)}>Refresh sources</button>
      </div>}
      notice={data && <div className="treemap-notice" aria-live="polite">
        <span>{format(data.mapped)} mapped / {format(data.total)} file LOC · {format(data.total ? 100 * data.mapped / data.total : 0)}% coverage</span>
        {data.issues.length > 0 && <details><summary>{data.issues.length} source {data.issues.length === 1 ? 'issue' : 'issues'} · totals exclude unresolved mappings or unavailable files</summary>
          <ul>{data.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}
      </div>} /> }]} />;
}
