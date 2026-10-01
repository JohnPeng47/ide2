import type { DisplayState, ProjectedPane } from '../../../../domain/mapping/workspace/displayModel';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import type { ScrollPosition, SourceScrollState } from '../../../shared/source/sourceScrollState';
interface Entry {
  sourceId?: string;
  sourceFile: string;
  position: ScrollPosition;
  read?: () => ScrollPosition | undefined;
  owner?: symbol;
}

function ownsViewport(content: ProjectedPane['content'], entry: Entry): content is Extract<ProjectedPane['content'], { kind: 'code-panel' | 'source-code' }> {
  if (content.kind === 'code-panel') return entry.sourceFile === '@code-panel';
  return content.kind === 'source-code' && content.sourceFile === entry.sourceFile && content.sourceId === entry.sourceId;
}

/** Live viewport state is sampled at snapshot time, never published into the React display tree. */
export class SourcePaneViewState {
  private readonly listeners = new Set<(documentId: string) => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  get pending() { return this.timers.size > 0; }
  subscribe(listener: (documentId: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed(id: string) {
    if (this.timers.has(id)) return;
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); this.listeners.forEach(fn => fn(id)); }, 250));
  }
  flush() { for (const [id, timer] of this.timers) { clearTimeout(timer); this.listeners.forEach(fn => fn(id)); } this.timers.clear(); }
  dispose() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.listeners.clear(); }
  private readonly entries = new Map<string, Map<string, Entry>>();
  private readonly cameras = new Map<string, CanvasTransform>();
  private readonly captures = new Map<string, { input: DisplayState; output: DisplayState }>();

  bind(documentId: string, paneId: string, sourceFile: string, fallback?: ScrollPosition, sourceId?: string): SourceScrollState {
    const owner = Symbol();
    const current = () => {
      const entry = this.entries.get(documentId)?.get(paneId);
      return entry?.sourceFile === sourceFile && entry.sourceId === sourceId ? entry : undefined;
    };
    return {
      read: () => current()?.position ?? fallback,
      connect: read => {
        let panes = this.entries.get(documentId);
        if (!panes) this.entries.set(documentId, panes = new Map());
        const entry: Entry = { sourceFile, sourceId, position: read() ?? current()?.position ?? fallback ?? { top: 0, left: 0 }, read, owner };
        panes.set(paneId, entry);
        return () => {
          // A reset or a newly mounted viewer takes ownership before an old cleanup may run.
          if (current() !== entry) return;
          entry.position = read() ?? entry.position;
          delete entry.read;
          delete entry.owner;
        };
      },
      write: position => {
        const entry = current();
        if (entry?.owner === owner) { entry.position = position; this.changed(documentId); }
      }
    };
  }

  resetPane(documentId: string, paneId: string) {
    this.entries.get(documentId)?.delete(paneId);
    this.captures.delete(documentId);
  }

  prune(documentId: string, display: DisplayState) {
    const panes = this.entries.get(documentId);
    if (!panes) return;
    for (const [id, entry] of panes) {
      const node = display.nodes[id];
      if (node?.kind !== 'projection' || !ownsViewport(node.content, entry)) panes.delete(id);
    }
  }

  captureDisplay(documentId: string, display: DisplayState): DisplayState {
    const panes = this.entries.get(documentId);
    if (!panes?.size) return display;
    const previous = this.captures.get(documentId);
    const base = previous?.input === display ? previous.output : display;
    let nodes = base.nodes;
    for (const [id, entry] of panes) {
      const node = nodes[id];
      if (node?.kind !== 'projection' || !ownsViewport(node.content, entry)) continue;
      const scroll = entry.read?.() ?? entry.position;
      if (node.content.scroll?.top === scroll.top && node.content.scroll?.left === scroll.left) continue;
      if (nodes === base.nodes) nodes = { ...nodes };
      nodes[id] = { ...node, content: { ...node.content, scroll: { ...scroll } } };
    }
    const output = nodes === base.nodes ? base : { ...display, nodes };
    this.captures.set(documentId, { input: display, output });
    return output;
  }

  setCamera(documentId: string, camera: CanvasTransform) { this.cameras.set(documentId, camera); this.changed(documentId); }
  captureCamera(documentId: string, fallback?: CanvasTransform) { return this.cameras.get(documentId) ?? fallback; }
}
