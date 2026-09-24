import { validateDiagram, type Diagram } from './diagram';
import { validateCanvasHistory, type CanvasHistoryRecord } from './canvasHistory';
import type { DiagramRevision } from './diagramRevisionEditor';

export type DiagramRecordKind = 'diagram' | 'revision' | 'history';
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
    if (object(value) && (restoring ? !!value.$diagramRecord || !!value.diagramHistory : isHistory(value) || isDiagram(value))) return true;
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

/** Accepts old embedded documents as well as the reference-only storage representation. */
export async function restoreDiagramData(value: unknown, store: DiagramRecordStore): Promise<unknown> {
  const contains = recordDetector(true);
  const hydrated = new Map<string, Promise<unknown>>();
  const records = new Map<string, Promise<unknown>>();
  const read = (ref: Reference) => {
    if (!['diagram', 'revision', 'history'].includes(ref.$diagramRecord) || !/^[a-f0-9]{64}$/.test(ref.id)) throw new Error('Invalid diagram record reference');
    const key = `${ref.$diagramRecord}:${ref.id}`;
    if (!records.has(key)) records.set(key, store.get(ref.$diagramRecord, ref.id));
    return records.get(key)!;
  };
  const visit = async (value: unknown): Promise<unknown> => {
    if (!contains(value)) return value;
    if (Array.isArray(value)) return Promise.all(value.map(item => item && typeof item === 'object' ? visit(item) : item));
    if (!object(value) || isEvidence(value)) return value;
    if (typeof value.$diagramRecord === 'string' && typeof value.id === 'string' && Object.keys(value).length === 2) {
      const ref = value as Reference;
      const key = `${ref.$diagramRecord}:${ref.id}`;
      if (!hydrated.has(key)) hydrated.set(key, (async () => {
        const restored = await visit(await read(ref));
        if (ref.$diagramRecord === 'diagram') validateDiagram(restored as Diagram);
        return restored;
      })());
      return structuredClone(await hydrated.get(key));
    }
    if (typeof value.contextId === 'string' && value.snapshots && value.diagramHistory?.$diagramRecord === 'history') {
      const stored = await read(value.diagramHistory) as StoredHistory;
      const { diagramHistory: _, snapshots, ...rest } = value;
      const diagramRevisions = await visit(stored.revisions) as Record<string, DiagramRevision>;
      const restoredSnapshots = Object.fromEntries(await Promise.all(Object.entries(snapshots).map(async ([id, raw]) => {
        const { diagramCheckpointId, ...canvas } = raw as Record<string, unknown>;
        if (diagramCheckpointId !== id || !Object.hasOwn(stored.bindings, id)) throw new Error('Unknown diagram checkpoint');
        return [id, { ...await visit(canvas) as object, diagramBindings: stored.bindings[id] }];
      })));
      const history = { ...rest, snapshots: restoredSnapshots, diagramRevisions } as CanvasHistoryRecord;
      validateCanvasHistory(history);
      return history;
    }
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, !item || typeof item !== 'object' ? item : await visit(item)])));
  };
  return visit(value);
}
