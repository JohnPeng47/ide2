import { diagramRevisions as revisionRegistry } from './internal/revisionRegistry';
import { validateDiagram, validateSourceBinding, type Diagram, type DiagramSourceBinding } from './diagram';
import { currentHistoryChanges, validateCanvasHistory, type CanvasHistoryRecord, type HistoryValidation } from './canvasHistory';
import type { DiagramRevision } from './diagramRevisionEditor';

export type DiagramRecordKind = 'diagram' | 'revision' | 'history' | 'workspace';
/** Immutable, content-addressed records; the implementation supplies durable atomic writes. */
export interface DiagramRecordStore {
  put(kind: DiagramRecordKind, data: unknown): Promise<string>;
  get(kind: DiagramRecordKind, id: string): Promise<unknown>;
}
interface Reference { $diagramRecord: DiagramRecordKind; id: string }
interface StoredHistory {
  revisions: Record<string, Reference>;
  bindings: Record<string, Record<string, string>>;
}
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const isHistory = (value: Record<string, any>) => value.schemaVersion === 1 && typeof value.contextId === 'string'
  && value.snapshots && value.diagramRevisions && typeof value.headId === 'string';
// Captured evidence contains source text, never nested diagram records.
const isEvidence = (value: Record<string, any>) => typeof value.id === 'string' && typeof value.label === 'string'
  && typeof value.category === 'string' && Array.isArray(value.sourceRanges);
const isDiagram = (value: Record<string, any>) => typeof value.id === 'string' && Number.isInteger(value.revision)
  && value.content && typeof value.content.ascii === 'string' && value.sourceContext;

/** Avoid allocating a promise/object for every captured source line or unrelated UI field. */
function recordDetector(restoring: boolean) {
  const cache = new WeakMap<object, boolean>();
  const contains = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    if (cache.has(value)) return cache.get(value)!;
    if (object(value) && (restoring ? !!value.$diagramRecord || !!value.workspaceRecords || !!value.diagramHistory || isHistory(value) || isDiagram(value) : isHistory(value) || isDiagram(value))) return true;
    const result = Object.values(value).some(contains);
    cache.set(value, result);
    return result;
  };
  return contains;
}

/** Storage adapter only. Public transports/exports remain portable expanded documents. */
export async function persistDiagramData(value: unknown, store: DiagramRecordStore): Promise<unknown> {
  const contains = recordDetector(false);
  const reference = async (kind: DiagramRecordKind, data: unknown): Promise<Reference> => ({ $diagramRecord: kind, id: await store.put(kind, data) });
  const visit = async (value: unknown): Promise<unknown> => {
    if (!contains(value)) return value;
    if (Array.isArray(value)) return Promise.all(value.map(item => item && typeof item === 'object' ? visit(item) : item));
    if (!object(value) || isEvidence(value)) return value;
    if (isHistory(value)) {
      const history = value as CanvasHistoryRecord;
      validateCanvasHistory(history);
      const revisions = Object.fromEntries(await Promise.all(Object.entries(history.diagramRevisions).map(async ([id, revision]) =>
        [id, await reference('revision', { ...revision, diagram: await visit(revision.diagram) })])));
      const bindings = Object.fromEntries(Object.entries(history.snapshots).map(([id, snapshot]) => [id, snapshot.diagramBindings]));
      const { diagramRevisions: _, snapshots, ...rest } = history;
      return { ...rest, diagramHistory: await reference('history', { revisions, bindings }),
        snapshots: await visit(Object.fromEntries(Object.entries(snapshots).map(([id, snapshot]) => {
          const { diagramBindings: _, ...canvas } = snapshot;
          return [id, { ...canvas, diagramCheckpointId: id }];
        }))) };
    }
    if (isDiagram(value)) { validateDiagram(value as Diagram); return reference('diagram', value); }
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, !item || typeof item !== 'object' ? item : await visit(item)])));
  };
  return visit(value);
}

/** Restore current portable documents or their content-addressed storage representation. */
export async function restoreDiagramData(value: unknown, store: DiagramRecordStore, historyValidation: HistoryValidation = 'all'): Promise<unknown> {
  const contains = recordDetector(true);
  const hydrated = new Map<string, Promise<unknown>>();
  const records = new Map<string, Promise<unknown>>();
  const read = (ref: Reference) => {
    if (!['diagram', 'revision', 'history', 'workspace'].includes(ref.$diagramRecord) || !/^[a-f0-9]{64}$/.test(ref.id)) throw new Error('Invalid diagram record reference');
    const key = `${ref.$diagramRecord}:${ref.id}`;
    if (!records.has(key)) records.set(key, store.get(ref.$diagramRecord, ref.id));
    return records.get(key)!;
  };
  const visit = async (value: unknown, deferred = false): Promise<unknown> => {
    if (!contains(value)) return value;
    if (Array.isArray(value)) return Promise.all(value.map(item => item && typeof item === 'object' ? visit(item, deferred) : item));
    if (!object(value) || isEvidence(value)) return value;
    if (typeof value.$diagramRecord === 'string' && typeof value.id === 'string' && Object.keys(value).length === 2) {
      const ref = value as Reference;
      const key = `${ref.$diagramRecord}:${ref.id}`;
      if (!hydrated.has(key)) hydrated.set(key, (async () => {
        const restored = await visit(await read(ref), deferred);
        return restored;
      })());
      const restored = await hydrated.get(key);
      if (ref.$diagramRecord === 'diagram' && !deferred) validateDiagram(restored as Diagram);
      return structuredClone(restored);
    }
    if (typeof value.contextId === 'string' && value.workspaceRecords) {
      const { workspaceRecords, ...header } = value;
      const [snapshots, diagramRevisions] = await Promise.all([visit(workspaceRecords.checkpoints), visit(workspaceRecords.revisions, historyValidation === 'current')]);
      const history = { ...header, snapshots, diagramRevisions } as CanvasHistoryRecord;
      validateCanvasHistory(history, historyValidation === 'current' ? currentHistoryChanges(history) : undefined);
      for (const revision of Object.values(history.diagramRevisions)) {
        if (historyValidation === 'current') revisionRegistry.restore(revision); else revisionRegistry.register(revision);
      }
      return history;
    }
    if (typeof value.contextId === 'string' && value.snapshots && value.diagramHistory?.$diagramRecord === 'history') {
      const stored = await read(value.diagramHistory) as StoredHistory;
      const { diagramHistory: _, snapshots, ...rest } = value;
      const diagramRevisions = await visit(stored.revisions, historyValidation === 'current') as Record<string, DiagramRevision>;
      const restoredSnapshots = Object.fromEntries(await Promise.all(Object.entries(snapshots).map(async ([id, raw]) => {
        const { diagramCheckpointId, ...canvas } = raw as Record<string, unknown>;
        if (diagramCheckpointId !== id || !Object.hasOwn(stored.bindings, id)) throw new Error('Unknown diagram checkpoint');
        return [id, { ...await visit(canvas) as object, diagramBindings: stored.bindings[id] }];
      })));
      const history = { ...rest, snapshots: restoredSnapshots, diagramRevisions } as CanvasHistoryRecord;
      validateCanvasHistory(history, historyValidation === 'current' ? currentHistoryChanges(history) : undefined);
      for (const revision of Object.values(history.diagramRevisions)) {
        if (historyValidation === 'current') revisionRegistry.restore(revision); else revisionRegistry.register(revision);
      }
      return history;
    }
    if (isHistory(value)) {
      const history = value as CanvasHistoryRecord;
      validateCanvasHistory(history, historyValidation === 'current' ? currentHistoryChanges(history) : undefined);
      for (const revision of Object.values(history.diagramRevisions)) {
        if (historyValidation === 'current') revisionRegistry.restore(revision); else revisionRegistry.register(revision);
      }
      return structuredClone(history);
    }
    if (isDiagram(value)) { if (!deferred) validateDiagram(value as Diagram); return structuredClone(value); }
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, !item || typeof item !== 'object' ? item : await visit(item, deferred)])));
  };
  return visit(value);
}

export class DiagramPersistence {
  constructor(private readonly store: DiagramRecordStore) {}
  persist(value: unknown) { return persistDiagramData(value, this.store); }
  /** Hydrate one checkpoint and its exact bound revisions, preserving logical IDs. */
  async currentHistory(raw: unknown): Promise<CanvasHistoryRecord> {
    if (!object(raw)) throw Error('Missing canvas history');
    const read = async (value: any) => value?.$diagramRecord ? this.store.get(value.$diagramRecord, value.id) : value;
    let head: any, revisions: Record<string, any>;
    if (raw.workspaceRecords) {
      head = await read(raw.workspaceRecords.checkpoints[raw.headId]); revisions = raw.workspaceRecords.revisions;
    } else if (raw.diagramHistory) {
      const archive = await read(raw.diagramHistory);
      head = { ...raw.snapshots[raw.headId], diagramBindings: archive.bindings[raw.headId] }; revisions = archive.revisions;
    } else { head = raw.snapshots[raw.headId]; revisions = raw.diagramRevisions; }
    if (!head) throw Error('Unknown canvas checkpoint');
    const bound: Record<string, DiagramRevision> = Object.fromEntries(await Promise.all([...new Set(Object.values(head.diagramBindings) as string[])].map(async id => {
      const revision = await read(revisions[id]);
      return [id, { ...revision, diagram: await read(revision.diagram) } as DiagramRevision] as const;
    })));
    const history: CanvasHistoryRecord = { schemaVersion: 1, contextId: raw.contextId, baselineId: raw.headId, headId: raw.headId, past: [], future: [],
      snapshots: { [raw.headId]: { ...head, parentId: undefined } }, diagramRevisions: bound,
      revisionBoundary: Object.fromEntries(Object.values(bound).flatMap(r => r.parentId && !bound[r.parentId] ? [[r.parentId, r.diagramId]] : [])) };
    validateCanvasHistory(history);
    for (const revision of Object.values(bound)) revisionRegistry.register(revision);
    return history;
  }
  /** Read only each published canvas head's source metadata, without restoring its undo history. */
  async sourceBindings(histories: readonly unknown[]): Promise<DiagramSourceBinding[]> {
    const records = new Map<string, Promise<Record<string, any>>>();
    const read = async (value: unknown, kind: DiagramRecordKind): Promise<Record<string, any>> => {
      if (!object(value)) throw new Error('Missing diagram source record');
      if (!value.$diagramRecord) return value;
      if (value.$diagramRecord !== kind && value.$diagramRecord !== 'workspace' || typeof value.id !== 'string' || !/^[a-f0-9]{64}$/.test(value.id)) throw new Error('Invalid diagram record reference');
      const key = `${kind}:${value.id}`;
      if (!records.has(key)) records.set(key, this.store.get(value.$diagramRecord, value.id).then(record => {
        if (!object(record)) throw new Error('Invalid diagram source record');
        return record;
      }));
      return records.get(key)!;
    };
    const bindings = new Map<string, DiagramSourceBinding>();
    for (const raw of histories) {
      if (object(raw) && raw.workspaceRecords) {
        const head = await read(raw.workspaceRecords.checkpoints[raw.headId], 'workspace');
        for (const id of Object.values(head.diagramBindings)) {
          const revision = await read(raw.workspaceRecords.revisions[id as string], 'workspace');
          const binding = revision.diagram?.sourceContext?.binding as DiagramSourceBinding | undefined;
          if (binding) { validateSourceBinding(binding); bindings.set(JSON.stringify(binding), binding); }
        }
        continue;
      }
      if (!object(raw) || !raw.snapshots?.[raw.headId]) throw new Error('Unknown diagram checkpoint');
      const stored = raw.diagramHistory ? await read(raw.diagramHistory, 'history') : undefined;
      const headBindings = stored ? stored.bindings?.[raw.headId] : raw.snapshots[raw.headId].diagramBindings;
      if (!object(headBindings)) throw new Error('Unknown diagram checkpoint');
      for (const revisionId of Object.values(headBindings)) {
        const revision = await read((stored?.revisions ?? raw.diagramRevisions)?.[revisionId], 'revision');
        const diagram = await read(revision.diagram, 'diagram');
        const binding = diagram.sourceContext?.binding as DiagramSourceBinding | undefined;
        if (binding) {
          validateSourceBinding(binding);
          const key = JSON.stringify(binding);
          // Preserve last occurrence order when a source's optional metadata changes across revisions.
          bindings.delete(key); bindings.set(key, binding);
        }
      }
    }
    return [...bindings.values()];
  }
  async restore<T>(value: unknown, historyValidation: HistoryValidation = 'all'): Promise<T> { return restoreDiagramData(value, this.store, historyValidation) as Promise<T>; }
}
