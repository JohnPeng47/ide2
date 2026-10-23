import { sha256 } from '../sha256';
import type { StoredCanvasSnapshot } from './canvasHistory';

type Path = string[];
type RefMap = Record<string, string>;
export interface CanvasCheckpointHead { id: string; records: RefMap }
export type CanvasStoredItem =
  | { format: 'canvas-text'; text: string }
  | { format: 'canvas-value'; value: unknown; texts: [Path, string][] };
export interface CanvasRecordDiff {
  added: RefMap;
  updated: Record<string, [string, string]>;
  removed: RefMap;
}
export interface CanvasCheckpointDelta {
  format: 'canvas-checkpoint-v1';
  id: string;
  parentId?: string;
  transactionId?: string;
  baseId?: string;
  depth: number;
  changes: CanvasRecordDiff;
}
export interface CanvasViewRecords { format: 'canvas-view-v1'; records: RefMap }
export interface CanvasCheckpointRecords {
  checkpoints: Record<string, CanvasCheckpointDelta>;
  items: Record<string, CanvasStoredItem>;
  head?: CanvasCheckpointHead;
}
export type PersistedCanvasCheckpoint = StoredCanvasSnapshot | CanvasCheckpointDelta;
export const MAX_CHECKPOINT_DELTA_DEPTH = 31;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.hasOwn(value, key);
const json = (value: unknown) => JSON.stringify(value);
export const isCheckpointDelta = (value: unknown): value is CanvasCheckpointDelta => object(value) && value.format === 'canvas-checkpoint-v1';
export const isCanvasViewRecords = (value: unknown): value is CanvasViewRecords => object(value) && value.format === 'canvas-view-v1';

// Split independently edited objects, retaining ordering in their parent skeleton.
// The codec is lossless: UI/API consumers still receive their existing read model.
function recordBoundary(path: Path): boolean {
  const joined = path.slice(0, -1).join('/');
  return path.join('/') === 'document/scene/root' || path.join('/') === 'nodeOrigins'
    || path.join('/') === 'unresolvedAnchors'
    || path[0] === 'document' && path[1] === 'scene' && path.at(-2) === 'children'
    || ['document/edges', 'document/jumps', 'document/sections', 'document/variants', 'document/variantSelections', 'document/diagramContexts', 'diagramBindings',
      'view/display/nodes', 'view/diagramViews', 'view/controls/surfaces', 'view/selection/items'].includes(joined);
}
function splitRecords(value: unknown): Record<string, unknown> {
  const records: Record<string, unknown> = {};
  const visit = (value: any, path: Path): any => {
    const next = Array.isArray(value) ? value.map((item, i) => visit(item, [...path, String(i)]))
      : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, [...path, key])])) : value;
    if (recordBoundary(path)) { records[json(path)] = next; return null; }
    return next;
  };
  records['[]'] = visit(value, []);
  return records;
}
function fill(root: any, path: Path, value: unknown): any {
  if (!Array.isArray(path) || path.some(part => typeof part !== 'string')) throw Error('Invalid canvas record path');
  if (!path.length) {
    if (root !== null) throw Error('Invalid canvas record placeholder');
    return value;
  }
  let parent = root;
  for (const key of path.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !own(parent, key)) throw Error('Missing canvas record parent');
    parent = parent[key];
  }
  const key = path.at(-1)!;
  if (!parent || typeof parent !== 'object' || !own(parent, key) || parent[key] !== null) throw Error('Invalid canvas record placeholder');
  Object.defineProperty(parent, key, { value, enumerable: true, writable: true, configurable: true });
  return root;
}

/** Values are immutable; repeated source ASCII is retained once, including stale selections. */
export class CanvasValueEncoder {
  private known = new Map<string, string>();
  private pending: Record<string, CanvasStoredItem> = {};
  private items: Record<string, CanvasStoredItem> = {};
  private put(item: CanvasStoredItem): string {
    const text = json(item), previous = this.known.get(text);
    if (previous) return previous;
    const id = sha256(text);
    this.known.set(text, id); this.pending[id] = item; this.items[id] = item;
    return id;
  }
  encode(value: unknown): RefMap {
    return Object.fromEntries(Object.entries(splitRecords(JSON.parse(json(value)))).map(([key, record]) => {
      const texts: [Path, string][] = [];
      const pack = (value: any, path: Path): any => {
        if (typeof value === 'string' && (value.length >= 512 || path.at(-1) === 'sourceAscii')) {
          texts.push([path, this.put({ format: 'canvas-text', text: value })]); return null;
        }
        if (Array.isArray(value)) return value.map((item, i) => pack(item, [...path, String(i)]));
        return object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pack(item, [...path, key])])) : value;
      };
      const packed = pack(record, []);
      return [key, this.put({ format: 'canvas-value', value: packed, texts })];
    }));
  }
  takeItems(all = false) { const items = all ? { ...this.items } : this.pending; this.pending = {}; return items; }
}

export function diffCanvasRecords(before: RefMap, after: RefMap): CanvasRecordDiff {
  const added: RefMap = {}, updated: Record<string, [string, string]> = {}, removed: RefMap = {};
  for (const [key, value] of Object.entries(after)) {
    if (!own(before, key)) added[key] = value;
    else if (before[key] !== value) updated[key] = [before[key], value];
  }
  for (const [key, value] of Object.entries(before)) if (!own(after, key)) removed[key] = value;
  return { added, updated, removed };
}
export function applyCanvasRecordDiff(before: RefMap, diff: CanvasRecordDiff, reverse = false): RefMap {
  if (!diff || !object(diff.added) || !object(diff.updated) || !object(diff.removed)) throw Error('Invalid canvas record diff');
  const result = { ...before }, seen = new Set<string>();
  const check = (key: string, refs: unknown[]) => {
    if (seen.has(key) || refs.some(ref => typeof ref !== 'string' || !/^[a-f0-9]{64}$/.test(ref))) throw Error('Invalid canvas record diff');
    seen.add(key);
  };
  for (const [key, ref] of Object.entries(reverse ? diff.removed : diff.added)) {
    check(key, [ref]); if (own(result, key)) throw Error('Canvas record diff conflict');
    Object.defineProperty(result, key, { value: ref, enumerable: true, writable: true, configurable: true });
  }
  for (const [key, pair] of Object.entries(diff.updated)) {
    if (!Array.isArray(pair) || pair.length !== 2) throw Error('Invalid canvas record diff');
    check(key, pair); const [from, to] = reverse ? [pair[1], pair[0]] : pair;
    if (!own(result, key) || result[key] !== from) throw Error('Canvas record diff conflict');
    result[key] = to;
  }
  for (const [key, ref] of Object.entries(reverse ? diff.added : diff.removed)) {
    check(key, [ref]); if (!own(result, key) || result[key] !== ref) throw Error('Canvas record diff conflict');
    delete result[key];
  }
  return result;
}

export class CanvasCheckpointEncoder {
  private values = new CanvasValueEncoder();
  private encoded = new Map<string, { refs: RefMap; checkpoint: CanvasCheckpointDelta }>();
  encode(snapshots: Record<string, StoredCanvasSnapshot>, full = false, headId?: string): CanvasCheckpointRecords {
    const checkpoints: Record<string, CanvasCheckpointDelta> = {}, visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw Error('Cyclic canvas history');
      const snapshot = snapshots[id];
      if (!snapshot || snapshot.id !== id) throw Error('Unknown canvas checkpoint');
      visiting.add(id);
      if (snapshot.parentId && !this.encoded.has(snapshot.parentId) && own(snapshots, snapshot.parentId)) visit(snapshot.parentId);
      const { id: _, parentId, transactionId, ...payload } = snapshot;
      const refs = this.values.encode(payload);
      const existing = this.encoded.get(id);
      if (existing) {
        if (json(existing.refs) !== json(refs) || existing.checkpoint.parentId !== parentId) throw Error('Immutable canvas checkpoint changed');
        checkpoints[id] = { ...existing.checkpoint, transactionId };
      } else {
        const parent = parentId && this.encoded.get(parentId);
        const base = parent && parent.checkpoint.depth < MAX_CHECKPOINT_DELTA_DEPTH ? parent : undefined;
        checkpoints[id] = { format: 'canvas-checkpoint-v1', id, parentId, transactionId,
          ...(base ? { baseId: parentId } : {}), depth: base ? base.checkpoint.depth + 1 : 0,
          changes: diffCanvasRecords(base?.refs ?? {}, refs) };
      }
      this.encoded.set(id, { refs, checkpoint: checkpoints[id] }); visiting.delete(id);
    };
    for (const id of Object.keys(snapshots)) visit(id);
    const head = headId && this.encoded.get(headId);
    if (headId && !head) throw Error('Unknown canvas checkpoint head');
    return { checkpoints, items: this.values.takeItems(full), ...(head ? { head: { id: headId!, records: head.refs } } : {}) };
  }
}

export function readCanvasRecords(refs: RefMap, get: (id: string) => CanvasStoredItem): any {
  const value = (id: string): unknown => {
    const item = get(id);
    if (!item || item.format !== 'canvas-value' || !Array.isArray(item.texts)) throw Error('Missing canvas value');
    let result = structuredClone(item.value);
    for (const [path, textId] of item.texts) {
      const text = get(textId);
      if (!text || text.format !== 'canvas-text' || typeof text.text !== 'string') throw Error('Missing canvas text');
      result = fill(result, path, text.text);
    }
    return result;
  };
  if (!own(refs, '[]')) throw Error('Missing canvas root record');
  let root = value(refs['[]']);
  const paths = Object.keys(refs).filter(key => key !== '[]').map(key => ({ key, path: JSON.parse(key) as Path }));
  paths.sort((a, b) => a.path.length - b.path.length);
  for (const { key, path } of paths) root = fill(root, path, value(refs[key]));
  return root;
}

function checkpointRefs(id: string, get: (id: string) => PersistedCanvasCheckpoint, cache: Map<string, RefMap>, visiting = new Set<string>()): RefMap {
  if (cache.has(id)) return cache.get(id)!;
  if (visiting.has(id) || visiting.size > MAX_CHECKPOINT_DELTA_DEPTH) throw Error('Invalid canvas checkpoint chain');
  const checkpoint = get(id);
  if (!isCheckpointDelta(checkpoint) || checkpoint.id !== id || !Number.isInteger(checkpoint.depth)
    || checkpoint.depth < 0 || checkpoint.depth > MAX_CHECKPOINT_DELTA_DEPTH) throw Error('Invalid canvas checkpoint');
  visiting.add(id);
  let base: RefMap = {};
  if (checkpoint.baseId) {
    const parent = get(checkpoint.baseId);
    if (checkpoint.baseId !== checkpoint.parentId || !isCheckpointDelta(parent) || parent.depth + 1 !== checkpoint.depth) throw Error('Invalid canvas checkpoint base');
    base = checkpointRefs(checkpoint.baseId, get, cache, visiting);
  } else if (checkpoint.depth !== 0) throw Error('Invalid canvas checkpoint depth');
  const refs = applyCanvasRecordDiff(base, checkpoint.changes);
  cache.set(id, refs); visiting.delete(id); return refs;
}

const restoredCheckpoints = new WeakMap<CanvasCheckpointDelta, {
  refs: RefMap; snapshot: StoredCanvasSnapshot; dependencies: [string, CanvasStoredItem][];
}>();
export function restoreCanvasCheckpoints(checkpoints: Record<string, PersistedCanvasCheckpoint>, items: Record<string, CanvasStoredItem>, head?: CanvasCheckpointHead, reuseImmutableRecords = false): Record<string, StoredCanvasSnapshot> {
  const cache = new Map<string, RefMap>();
  const snapshots = Object.fromEntries(Object.entries(checkpoints).map(([id, checkpoint]) => {
    if (!isCheckpointDelta(checkpoint)) return [id, checkpoint];
    const refs = checkpointRefs(id, key => checkpoints[key], cache);
    // Workspace batches retain accepted immutable objects. Re-expanding every
    // historical view during each validation would undo the serialization savings.
    const prior = reuseImmutableRecords && restoredCheckpoints.get(checkpoint);
    if (prior && Object.keys(prior.refs).length === Object.keys(refs).length
      && Object.entries(refs).every(([key, ref]) => prior.refs[key] === ref)
      && prior.dependencies.every(([key, item]) => items[key] === item)) return [id, prior.snapshot];
    const dependencies = new Map<string, CanvasStoredItem>();
    const payload = readCanvasRecords(refs, key => { dependencies.set(key, items[key]); return items[key]; });
    const snapshot: StoredCanvasSnapshot = { ...payload, id, parentId: checkpoint.parentId, transactionId: checkpoint.transactionId };
    if (reuseImmutableRecords) restoredCheckpoints.set(checkpoint, { refs, snapshot, dependencies: [...dependencies] });
    return [id, snapshot];
  }));
  if (head) {
    const refs = cache.get(head.id);
    if (!refs || !object(head.records) || Object.keys(refs).length !== Object.keys(head.records).length
      || Object.entries(refs).some(([key, ref]) => head.records[key] !== ref)) throw Error('Invalid canvas checkpoint head');
  }
  return snapshots;
}

/** Read one checkpoint with bounded replay; unrelated history and revision content stay cold. */
export async function loadCanvasCheckpoint(id: string, getCheckpoint: (id: string) => Promise<PersistedCanvasCheckpoint>, getItem: (id: string) => Promise<CanvasStoredItem>, head?: CanvasCheckpointHead): Promise<StoredCanvasSnapshot> {
  if (head && (head.id !== id || !object(head.records))) throw Error('Invalid canvas checkpoint head');
  const checkpoints: Record<string, PersistedCanvasCheckpoint> = {}, seen = new Set<string>();
  let next: string | undefined = id;
  while (next) {
    if (seen.has(next) || seen.size > MAX_CHECKPOINT_DELTA_DEPTH) throw Error('Invalid canvas checkpoint chain');
    seen.add(next);
    const checkpoint: PersistedCanvasCheckpoint = await getCheckpoint(next);
    if (!checkpoint || checkpoint.id !== next) throw Error('Unknown canvas checkpoint');
    checkpoints[next] = checkpoint;
    next = isCheckpointDelta(checkpoint) && !head ? checkpoint.baseId : undefined;
  }
  if (!isCheckpointDelta(checkpoints[id])) return checkpoints[id] as StoredCanvasSnapshot;
  const refs = head?.records ?? checkpointRefs(id, key => checkpoints[key], new Map()), items: Record<string, CanvasStoredItem> = {};
  const load = async (id: string) => {
    const item = await getItem(id); items[id] = item;
    if (!item || sha256(json(item)) !== id) throw Error('Canvas item integrity failure');
  };
  await Promise.all([...new Set(Object.values(refs))].map(load));
  await Promise.all([...new Set(Object.values(items).flatMap(item => item.format === 'canvas-value' ? item.texts.map(([, id]) => id) : []))].map(load));
  const checkpoint = checkpoints[id] as CanvasCheckpointDelta;
  return { ...readCanvasRecords(refs, key => items[key]), id, parentId: checkpoint.parentId, transactionId: checkpoint.transactionId };
}
