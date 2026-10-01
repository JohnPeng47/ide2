import { DefaultCanvasHistoryService, type CanvasHistoryService } from '../../../../domain/core/diagrams/canvasHistoryService';
import { createStore } from 'zustand/vanilla';
import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';
import type { DiagramService } from '../../../../domain/core/diagrams/diagramService';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { DiagramFocus } from '../search/SearchHighlight';
import { CanvasSession, readable, type SavedDocumentState } from './canvasSession';

export interface DraftMetadata extends SavedDocumentState {
  hidden?: boolean; newerRevision?: boolean; reloadKey?: string; representationId?: string;
  revisionId: string; busy: boolean; viewport?: CanvasTransform; focusBox?: DiagramFocus;
}
export interface CanvasDraft extends DraftMetadata { session: CanvasSession }
export type CanvasDraftSeed = DraftMetadata & Pick<ConstructorParameters<typeof CanvasSession>[0], 'document' | 'canvas' | 'history'>;
type DraftInput = CanvasDraft | CanvasDraftSeed;
type Drafts = Record<string, CanvasDraft>;

/** Registry owns session lifetimes. Page state contains metadata and stable handles only. */
export class CanvasWorkspace {
  private readonly storeState = createStore(() => ({ drafts: {} as Drafts }));
  readonly controllers = new Map<string, MappingDocumentController>();
  private readonly changesState = createStore(() => ({ version: 0 }));
  private readonly dirtyScenesState = createStore(() => ({ ids: [] as string[] }));
  readonly store = readable(this.storeState);
  readonly changes = readable(this.changesState);
  readonly dirtyScenes = readable(this.dirtyScenesState);
  private subscriptions = new Map<string, (() => void)[]>();
  constructor(private readonly diagrams?: DiagramService, private readonly history: CanvasHistoryService = new DefaultCanvasHistoryService()) {}
  private persistenceListeners = new Set<(ids: string[]) => void>();
  onPersist(listener: (ids: string[]) => void) { this.persistenceListeners.add(listener); return () => { this.persistenceListeners.delete(listener); }; }
  private persist(ids: string[]) { this.persistenceListeners.forEach(listener => listener(ids)); }
  private changed = () => this.changesState.setState(s => ({ version: s.version + 1 }));
  private refreshDirty = () => {
    const ids = Object.entries(this.store.getState().drafts).filter(([, d]) => d.session.status.getState().sceneDirty).map(([id]) => id);
    const prior = this.dirtyScenes.getState().ids;
    if (ids.length !== prior.length || ids.some((id, i) => id !== prior[i])) this.dirtyScenesState.setState({ ids });
  };
  setDrafts = (value: Record<string, DraftInput> | ((current: Drafts) => Record<string, DraftInput>)) => {
    const prior = this.store.getState().drafts;
    const input = typeof value === 'function' ? value(prior) : value;
    if (input === prior) return;
    const next: Drafts = {};
    let persist = false;
    const changedIds = new Set<string>();
    for (const [id, item] of Object.entries(input)) {
      if (item === prior[id]) { next[id] = prior[id]; continue; }
      if ('document' in item) {
        const { document, canvas, history, ...metadata } = item;
        next[id] = { ...metadata, session: new CanvasSession({ ...metadata, document, canvas, history }, this.diagrams, this.history) };
      } else next[id] = item;
      next[id].session.updateBaseline(next[id]);
      const old = prior[id];
      if (!old || next[id].session !== old.session || ['name', 'savedName', 'savedScene', 'savedEdges', 'revisionId', 'representationId', 'hidden'].some(key =>
        old[key as keyof DraftMetadata] !== next[id][key as keyof DraftMetadata])) { persist = true; changedIds.add(id); }
    }
    for (const [id, old] of Object.entries(prior)) if (next[id]?.session !== old.session) {
      this.subscriptions.get(id)?.forEach(unsubscribe => unsubscribe()); this.subscriptions.delete(id);
      this.controllers.delete(id); old.session.dispose(); persist = true; changedIds.add(id);
    }
    for (const [id, draft] of Object.entries(next)) if (!this.subscriptions.has(id)) {
      const session = draft.session;
      this.controllers.set(id, session.controller);
      this.subscriptions.set(id, [session.onCommit(() => { this.changed(); this.persist([id]); }), session.status.subscribe(this.refreshDirty), session.document.subscribe(() => {
        // Document consumers (search/explorer) get a new entry; presentation/interaction never enter this path.
        const current = this.store.getState().drafts;
        if (current[id]?.session === session) this.storeState.setState({ drafts: { ...current, [id]: { ...current[id] } } });
      })]);
    }
    this.storeState.setState({ drafts: next });
    this.refreshDirty();
    if (persist) { this.changed(); this.persist([...changedIds]); }
  };
  dispose() { this.subscriptions.forEach(list => list.forEach(off => off())); this.persistenceListeners.clear(); Object.values(this.store.getState().drafts).forEach(d => d.session.dispose()); }
}
