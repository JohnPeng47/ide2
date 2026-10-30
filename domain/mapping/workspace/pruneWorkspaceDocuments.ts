import type { MappingWorkspaceSnapshot } from './mappingWorkspace';

/** Deleting a participant ends its paired undo action; surviving canvas checkpoints remain usable. */
export function pruneWorkspaceDocuments(workspace: MappingWorkspaceSnapshot, keep: (id: string) => boolean): MappingWorkspaceSnapshot {
  const next = structuredClone(workspace);
  next.documents = next.documents.filter(doc => keep(doc.representationId));
  const ids = new Set(next.documents.map(doc => doc.representationId));
  const retired = new Set((next.transfers ?? []).filter(tx => !ids.has(tx.sourceId) || !ids.has(tx.destinationId)).map(tx => tx.id));
  next.transfers = next.transfers?.filter(tx => !retired.has(tx.id));
  for (const doc of next.documents) for (const checkpoint of Object.values(doc.history?.snapshots ?? {})) {
    if (checkpoint.transactionId && retired.has(checkpoint.transactionId)) delete checkpoint.transactionId;
  }
  if (!next.documents.some(doc => doc.representationId === next.activeDocumentId && !doc.hidden))
    next.activeDocumentId = next.documents.find(doc => !doc.hidden)?.representationId;
  return next;
}
