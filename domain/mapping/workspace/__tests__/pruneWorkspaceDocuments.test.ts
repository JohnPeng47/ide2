import { expect, it } from 'vitest';
import { CanvasHistory } from '../../../core/diagrams/canvasHistory';
import { prepareCanvasTransfer } from '../../../core/diagrams/canvasTransfer';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { initialCanvasState, type MappingWorkspaceSnapshot } from '../mappingWorkspace';
import { MappingDocumentController } from '../mappingDocumentController';
import { deserializeWorkspace, serializeWorkspace } from '../mappingWorkspaceCodec';
import { pruneWorkspaceDocuments } from '../pruneWorkspaceDocuments';

it.each(['source', 'draft-destination'])('deletes %s, retires paired navigation, and preserves usable surviving checkpoints', deleted => {
  const doc = { scene: singleDiagramScene('Original'), edges: [], sections: {} };
  const history = new CanvasHistory(doc, initialCanvasState()).export();
  const transfer = prepareCanvasTransfer(history, { mode: 'move', sourceId: 'source', sourceAliases: ['source'],
    destinationId: 'draft-destination', selectedIds: ['grid:overview'], destinationView: initialCanvasState() });
  const workspace: MappingWorkspaceSnapshot = { schemaVersion: 3, projectId: 'project', activeDocumentId: deleted, transfers: [transfer.transaction],
    documents: [['source', transfer.source], ['draft-destination', transfer.destination]].map(([id, state]) => {
      const value = state as typeof transfer.source;
      return { representationId: id as string, name: id as string, savedName: '', revisionId: id === 'source' ? 'revision-source' : '',
        savedScene: JSON.stringify(doc.scene), document: value.document, history: value.history, canvas: initialCanvasState() };
    }) };
  const before = structuredClone(workspace);
  const next = deserializeWorkspace(serializeWorkspace(pruneWorkspaceDocuments(workspace, id => id !== deleted)));
  expect(workspace).toEqual(before);
  expect(next.transfers).toEqual([]); expect(next.documents).toHaveLength(1);
  expect(next.activeDocumentId).toBe(next.documents[0].representationId);
  const surviving = next.documents[0], old = before.documents.find(d => d.representationId === surviving.representationId)!;
  expect(surviving.history!.diagramRevisions).toEqual(old.history!.diagramRevisions);
  expect(Object.keys(surviving.history!.snapshots)).toEqual(Object.keys(old.history!.snapshots));
  expect(Object.values(surviving.history!.snapshots).every(checkpoint => !checkpoint.transactionId)).toBe(true);
  const controller = new MappingDocumentController(surviving.document, surviving.canvas, 0, undefined, undefined, surviving.history);
  expect(() => controller.undo()).not.toThrow();
  expect(() => controller.undo(true)).not.toThrow();
  expect(controller.getSnapshot().document).toEqual(surviving.document);
});
it('keeps retained documents and clears the active selection when the workspace becomes empty', () => {
  const workspace: MappingWorkspaceSnapshot = { schemaVersion: 3, projectId: 'p', activeDocumentId: 'draft-only', documents: [{
    representationId: 'draft-only', name: 'Only', savedName: '', revisionId: '', savedScene: JSON.stringify(singleDiagramScene('Only')),
    document: { scene: singleDiagramScene('Only'), edges: [], sections: {} }, canvas: initialCanvasState()
  }] };
  expect(pruneWorkspaceDocuments(workspace, () => true)).toEqual(workspace);
  expect(pruneWorkspaceDocuments(workspace, () => false)).toMatchObject({ documents: [], activeDocumentId: undefined });
});
