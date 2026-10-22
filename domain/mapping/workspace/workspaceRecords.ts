import { canvasTransferSchema } from '../../core/diagrams/canvasTransfer';
import { sha256 } from '../../core/sha256';
import { CanvasCheckpointEncoder, CanvasValueEncoder, isCanvasViewRecords, readCanvasRecords, restoreCanvasCheckpoints,
  type CanvasStoredItem, type CanvasViewRecords, type PersistedCanvasCheckpoint } from '../../core/diagrams/canvasCheckpointRecords';
import { validateCanvasParents } from './canvasParents';
import { CanvasHistory, currentHistoryChanges, documentFromHistory, validateCanvasHistory, type CanvasHistoryRecord, type HistoryChanges, type HistoryValidation } from '../../core/diagrams/canvasHistory';
import type { StorageChange } from '../../core/storage/storageService';
import { deserializeWorkspace } from './mappingWorkspaceCodec';
import type { MappingDocumentSnapshot, MappingWorkspaceSnapshot, MappingCanvasState } from './mappingWorkspace';

export type WorkspaceRecords = Record<string, unknown>;
export interface WorkspaceIndex { projectId: string; documentIds: string[]; activeDocumentId?: string; transfers: NonNullable<MappingWorkspaceSnapshot['transfers']> }
export interface WorkspaceBatch { requestId: string; expectedRevision: number; changes: StorageChange[] }
export interface WorkspaceRecordState { revision: number; records: WorkspaceRecords }
export const documentPrefix = (id: string) => `document/${encodeURIComponent(id)}/`;
export function historyChanges(id: string, history: HistoryChanges): StorageChange[] {
  const prefix = documentPrefix(id);
  const storage = history.storage ?? new CanvasCheckpointEncoder().encode(history.snapshots, true, history.header.headId);
  return [
    { key: prefix + 'history', value: { ...history.header, checkpointHead: storage.head } },
    ...Object.entries(storage.items).map(([key, value]) => ({ key: prefix + 'item/' + key, value })),
    ...Object.entries(storage.checkpoints).map(([key, value]) => ({ key: prefix + 'checkpoint/' + key, value })),
    ...Object.entries(history.diagramRevisions).map(([key, value]) => ({ key: prefix + 'revision/' + key, value }))
  ];
}
export function canvasViewChanges(id: string, canvas: MappingCanvasState): StorageChange[] {
  const prefix = documentPrefix(id), encoder = new CanvasValueEncoder();
  const value: CanvasViewRecords = { format: 'canvas-view-v1', records: encoder.encode({ view: normalizeRecord(prefix + 'canvas', structuredClone(canvas)) }) };
  return [...Object.entries(encoder.takeItems()).map(([key, value]) => ({ key: prefix + 'item/' + key, value })),
    { key: prefix + 'canvas', value }];
}
export function documentRecords(doc: MappingDocumentSnapshot): WorkspaceRecords {
  const { document, canvas, history, viewport, savedName, savedScene, savedEdges, revisionId, ...metadata } = doc;
  const changes = new CanvasHistory(document, canvas, history).persistenceChanges();
  const prefix = documentPrefix(doc.representationId);
  return Object.fromEntries([
    ...historyChanges(doc.representationId, changes).map(change => [change.key, 'value' in change ? change.value : undefined]),
    [prefix + 'metadata', metadata], [prefix + 'baseline', { savedName, savedScene, savedEdges, revisionId }],
    ...canvasViewChanges(doc.representationId, canvas).map(change => [change.key, 'value' in change ? change.value : undefined]),
    ...(viewport ? [[prefix + 'viewport', viewport]] : [])
  ]);
}
export function workspaceRecords(workspace: MappingWorkspaceSnapshot): WorkspaceRecords {
  return Object.assign({ workspace: { projectId: workspace.projectId, activeDocumentId: workspace.activeDocumentId,
    documentIds: workspace.documents.map(doc => doc.representationId), transfers: workspace.transfers ?? [] } satisfies WorkspaceIndex },
  ...workspace.documents.map(documentRecords));
}
export function recordHistory(records: WorkspaceRecords, id: string): CanvasHistoryRecord {
  const prefix = documentPrefix(id);
  const checkpoints: Record<string, PersistedCanvasCheckpoint> = {}, items: Record<string, CanvasStoredItem> = {}, diagramRevisions: CanvasHistoryRecord['diagramRevisions'] = {};
  for (const [key, value] of Object.entries(records)) {
    if (key.startsWith(prefix + 'checkpoint/')) checkpoints[key.slice((prefix + 'checkpoint/').length)] = value as PersistedCanvasCheckpoint;
    else if (key.startsWith(prefix + 'item/')) items[key.slice((prefix + 'item/').length)] = value as CanvasStoredItem;
    else if (key.startsWith(prefix + 'revision/')) diagramRevisions[key.slice((prefix + 'revision/').length)] = value as CanvasHistoryRecord['diagramRevisions'][string];
  }
  const { checkpointHead, ...header } = records[prefix + 'history'] as HistoryChanges['header'] & { checkpointHead?: import('../../core/diagrams/canvasCheckpointRecords').CanvasCheckpointHead };
  if (checkpointHead && checkpointHead.id !== header.headId) throw Error('Invalid canvas checkpoint head');
  return { ...header,
    snapshots: restoreCanvasCheckpoints(checkpoints, items, checkpointHead, true), diagramRevisions
  } as CanvasHistoryRecord;
}
export function recordDocument(records: WorkspaceRecords, id: string): MappingDocumentSnapshot {
  const prefix = documentPrefix(id), history = recordHistory(records, id);
  const storedCanvas = records[prefix + 'canvas'];
  return { ...records[prefix + 'metadata'] as object, ...records[prefix + 'baseline'] as object,
    representationId: id, document: documentFromHistory(history), history,
    canvas: isCanvasViewRecords(storedCanvas) ? readCanvasRecords(storedCanvas.records, key => records[prefix + 'item/' + key] as CanvasStoredItem).view : storedCanvas as MappingCanvasState,
    ...(records[prefix + 'viewport'] ? { viewport: records[prefix + 'viewport'] } : {}) } as MappingDocumentSnapshot;
}
export function recordsWorkspace(records: WorkspaceRecords): MappingWorkspaceSnapshot | null {
  const index = records.workspace as WorkspaceIndex | undefined;
  return index ? { schemaVersion: 3, projectId: index.projectId, activeDocumentId: index.activeDocumentId,
    transfers: index.transfers, documents: index.documentIds.map(id => recordDocument(records, id)) } : null;
}
/** Save projection, separate from full import validation. Called on the worker's copy. */
export function normalizeRecord(key: string, value: unknown): unknown {
  if (!key.endsWith('/canvas') || isCanvasViewRecords(value)) return value;
  const canvas = value as MappingCanvasState;
  for (const node of Object.values(canvas.display.nodes)) if (node.kind === 'conversation') {
    if (node.thread.pending && node.thread.context) node.thread.error = 'Reply interrupted by workspace reload. Retry to continue.';
    delete node.thread.progress; node.thread.pending = false;
  }
  for (const surface of Object.values(canvas.controls.surfaces)) if (surface.promptPhase === 'generating') {
    surface.promptPhase = 'error'; surface.statusMessage = 'Operation interrupted by workspace reload; review before retrying.';
  }
  return value;
}
/** Validate changed records and their references; previously accepted history is not reparsed. */
export function validateRecordUpdate(records: WorkspaceRecords, keys: string[], projectId: string, historyValidation: HistoryValidation = 'all'): void {
  const index = records.workspace as WorkspaceIndex;
  if (!index || index.projectId !== projectId || !Array.isArray(index.documentIds) || new Set(index.documentIds).size !== index.documentIds.length
    || index.documentIds.length > 100 || !Array.isArray(index.transfers)) throw Error('Invalid workspace index');
  if (index.documentIds.some(id => typeof id !== 'string' || !id || id.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(id))) throw Error('Invalid canvas ID');
  if (index.activeDocumentId !== undefined && !index.documentIds.includes(index.activeDocumentId)) throw Error('Invalid active canvas');
  const prefixes = new Set(index.documentIds.map(id => documentPrefix(id)));
  for (const key of Object.keys(records)) {
    if (key !== 'workspace' && !prefixes.has(key.slice(0, key.indexOf('/', 'document/'.length) + 1))) throw Error('Record belongs to a removed canvas');
  }
  const affected = new Set<string>();
  for (const key of keys) {
    if (key === 'workspace') continue;
    const match = /^document\/([^/]+)\/(metadata|baseline|canvas|viewport|history|checkpoint\/[^/]+|revision\/[^/]+|item\/[a-f0-9]{64})$/.exec(key);
    if (!match) throw Error('Invalid workspace record key');
    const id = decodeURIComponent(match[1]);
    if (!id || match[1] !== encodeURIComponent(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw Error('Invalid canvas ID');
    if (match[2].startsWith('item/') && Object.hasOwn(records, key) && sha256(JSON.stringify(records[key])) !== match[2].slice(5)) throw Error('Canvas item integrity failure');
    if (index.documentIds.includes(id)) affected.add(id);
    else if (Object.hasOwn(records, key)) throw Error('Record belongs to a removed canvas');
  }
  for (const id of index.documentIds) {
    const prefix = documentPrefix(id);
    if (!records[prefix + 'metadata'] || !records[prefix + 'baseline'] || !records[prefix + 'history'] || !records[prefix + 'canvas']) throw Error('Incomplete canvas');
  }
  validateCanvasParents(index.documentIds.map(id => ({ representationId: id,
    parentCanvasId: (records[documentPrefix(id) + 'metadata'] as MappingDocumentSnapshot).parentCanvasId })));
  for (const id of affected) {
    const prefix = documentPrefix(id), history = recordHistory(records, id);
    const removesHistory = keys.some(k => (k.startsWith(prefix + 'revision/') || k.startsWith(prefix + 'checkpoint/')) && !Object.hasOwn(records, k));
    validateCanvasHistory(history, historyValidation === 'current' ? currentHistoryChanges(history) : removesHistory ? undefined : {
      revisions: keys.filter(k => k.startsWith(prefix + 'revision/') && Object.hasOwn(records, k)).map(k => k.slice((prefix + 'revision/').length)),
      snapshots: keys.filter(k => k.startsWith(prefix + 'checkpoint/') && Object.hasOwn(records, k)).map(k => k.slice((prefix + 'checkpoint/').length))
    });
    // Current presentation/composition validation never includes accumulated history.
    const { history: _, ...doc } = recordDocument(records, id);
    deserializeWorkspace({ schemaVersion: 3, projectId, documents: [doc] });
  }
  // Cross-canvas transaction references are small and checked as one batch.
  if (new Set(index.transfers.map(tx => tx.id)).size !== index.transfers.length) throw Error('Duplicate transfer');
  for (const tx of index.transfers) {
    canvasTransferSchema.parse(tx);
    if (!index.documentIds.includes(tx.sourceId) || !index.documentIds.includes(tx.destinationId) || tx.sourceId === tx.destinationId) throw Error('Missing transfer participant');
    for (const [id, before, after] of [[tx.sourceId, tx.sourceBefore, tx.sourceAfter], [tx.destinationId, tx.destinationBefore, tx.destinationAfter]]) {
      if (!records[documentPrefix(id) + 'checkpoint/' + before] || !records[documentPrefix(id) + 'checkpoint/' + after]) throw Error('Missing transfer checkpoint');
    }
    const destination = records[documentPrefix(tx.destinationId) + 'checkpoint/' + tx.destinationAfter] as { transactionId?: string };
    const source = records[documentPrefix(tx.sourceId) + 'checkpoint/' + tx.sourceAfter] as { transactionId?: string };
    if (destination.transactionId !== tx.id || tx.mode === 'move' && source.transactionId !== tx.id) throw Error('Unlinked transfer');
  }
}
