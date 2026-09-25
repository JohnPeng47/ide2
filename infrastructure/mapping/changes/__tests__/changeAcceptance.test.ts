import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectCatalogStore } from '../../../core/persistence/projectCatalogStore';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import { singleDiagramScene, documentFromRevision, historyFromRevision } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { RevisionedDiagramService } from '../../../../domain/core/diagrams/diagramService';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'change-acceptance-'));
  const catalog = new ProjectCatalogStore(root);
  const saved = await catalog.saveMappingDiagram('project', { name: 'Original', scene: singleDiagramScene('Root\n|-- Old\n`-- Keep') });
  const source = { loadProject: async () => ({ id: 'project' }), projectCatalogs: catalog } as unknown as DiagramRepository;
  const bridge: CanvasSessionPort = { register() {}, list: () => [], poll: async () => [], reply() {}, unregister() {}, dispose() {}, dispatch: async () => { throw Error('Unexpected live call'); } };
  const repository = new DiagramChangeSessionStore(root), changes = new ChangeSessionService(repository, source, bridge);
  const create = async (requestId = 'create') => {
    const result = await changes.create({ title: 'Proposal', requestId }) as { changeSessionId: string };
    await changes.apply(result.changeSessionId, saved.representation.id, 0, [
      { method: 'patchDiagram', nodeId: 'grid:overview', start: 2, end: 2, patch: '|-- Changed' },
      { method: 'move', nodeId: 'grid:overview', position: { column: 12, row: 7 } }
    ], `${requestId}-edit`);
    return result.changeSessionId;
  };
  const ready = async (id: string) => {
    const session = await changes.get(id);
    await changes.update({ changeSessionId: id, expectedVersion: session.version, requestId: `ready-${session.version}`, status: 'ready' });
    return { changeSessionId: id, expectedVersion: session.version + 1, requestId: 'accept' };
  };
  return { root, catalog, source, saved, bridge, repository, changes, create, ready };
}

it('publishes composition and exact diagram bindings, retains the diff and identifiable before/after states across restart', () => fixture(async f => {
  const id = await f.create(), input = await f.ready(id), before = await f.changes.get(id);
  const accepted = await f.changes.accept(input);
  expect(accepted.status).toBe('accepted');
  const record = accepted.acceptance!, entry = record.documents[0];
  expect(record.changeIds).toEqual(before.changes.map(c => c.id));
  expect(entry.before?.revisionId).toBe(f.saved.representation.currentRevisionId);
  const catalog = await new ProjectCatalogStore(f.root).loadRepresentationCatalog('project');
  expect(catalog.changeSessionAcceptances?.[id]).toEqual(record);
  const published = catalog.revisions[entry.after.revisionId], history = historyFromRevision(published)!;
  expect(history.headId).toBe(entry.after.checkpointId);
  expect(documentFromHistory(history, entry.before!.checkpointId)).toEqual(documentFromRevision(f.saved.catalog.revisions[entry.before!.revisionId]));
  expect(documentFromRevision(published)).toEqual(before.documents[0].proposed.document);
  const proposed = before.documents[0].history!;
  expect(history.snapshots[history.headId].diagramBindings).toEqual(proposed.snapshots[proposed.headId].diagramBindings);
  const diagrams = new RevisionedDiagramService(), context = diagrams.openContext(documentFromHistory(history), {}, history);
  expect(diagrams.navigate(context)).toBe(true);
  expect(diagrams.document(context)).toEqual(documentFromHistory(history, entry.before!.checkpointId));
  const reopened = new ChangeSessionService(new DiagramChangeSessionStore(f.root), f.source, f.bridge);
  const retained = await reopened.get(id);
  expect(retained.documents).toEqual(before.documents);
  expect(diffChangeDocument(retained.documents[0]).counts).toEqual(diffChangeDocument(before.documents[0]).counts);
  expect(retained.acceptance).toEqual(record);
  const disk = JSON.parse(await readFile(path.join(f.root, 'canvases/catalog.json'), 'utf8'));
  expect(disk.changeSessionAcceptances[id]).toEqual(record);
  expect(disk.revisions[entry.after.revisionId].content.history.diagramHistory.$diagramRecord).toBe('history');
}));

it('publishes new canvases and existing canvases together with null before references for additions', () => fixture(async f => {
  const id = await f.create();
  const added = await f.changes.createDocument(id, 'New canvas', 'new');
  await f.changes.apply(id, added.documentId, 0, [{ method: 'replace', nodeId: 'grid:overview', ascii: '[New content]' }], 'new-content');
  const result = await f.changes.accept(await f.ready(id));
  const record = result.acceptance!.documents.find(d => d.documentId === added.documentId)!;
  expect(record.before).toBeNull();
  expect(record.representationId).not.toBe(added.documentId);
  const catalog = await f.catalog.loadRepresentationCatalog('project');
  expect(Object.keys(catalog.representations)).toHaveLength(2);
  expect(documentFromRevision(catalog.revisions[record.after.revisionId]).scene.contents.overview.content.ascii).toBe('[New content]');
}));

it('rejects a stale target without publishing any earlier documents from the batch', () => fixture(async f => {
  const second = await f.catalog.saveMappingDiagram('project', { name: 'Second', scene: singleDiagramScene('Second') });
  const id = await f.create();
  await f.changes.apply(id, second.representation.id, 0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Proposed second' }], 'second-edit');
  const input = await f.ready(id);
  const changed = await f.catalog.saveMappingDiagram('project', { name: 'Second', representationId: second.representation.id,
    expectedRevisionId: second.representation.currentRevisionId, scene: singleDiagramScene('Concurrent edit') });
  await expect(f.changes.accept(input)).rejects.toThrow('VERSION_CONFLICT');
  expect(await f.catalog.loadRepresentationCatalog('project')).toEqual(changed.catalog);
  expect((await f.changes.get(id)).status).toBe('ready');
}));

it('recovers acceptance after catalog commit but failed session persistence, without publishing twice', () => fixture(async f => {
  const id = await f.create(), input = await f.ready(id);
  const original = f.repository.write.bind(f.repository); let fail = true;
  vi.spyOn(f.repository, 'write').mockImplementation(async session => {
    if (session.status === 'accepted' && fail) { fail = false; throw new Error('session disk failure'); }
    return original(session);
  });
  await expect(f.changes.accept(input)).rejects.toThrow('session disk failure');
  const published = await f.catalog.loadRepresentationCatalog('project');
  const reopened = new ChangeSessionService(new DiagramChangeSessionStore(f.root), f.source, f.bridge);
  const result = await reopened.accept(input);
  expect(result.status).toBe('accepted');
  expect(result.acceptance).toEqual(published.changeSessionAcceptances?.[id]);
  expect(await f.catalog.loadRepresentationCatalog('project')).toEqual(published);
  expect(await reopened.accept(input)).toEqual(result);
}));

it('freezes accepted proposals and rejects another acceptance request', () => fixture(async f => {
  const id = await f.create(), input = await f.ready(id), result = await f.changes.accept(input);
  await expect(f.changes.accept({ ...input, requestId: 'different' })).rejects.toThrow('REQUEST_ID_CONFLICT');
  await expect(f.changes.apply(id, f.saved.representation.id, 1, [], 'edit-after')).rejects.toThrow('accepted');
  await expect(f.changes.createDocument(id, 'Another', 'create-after')).rejects.toThrow('accepted');
  await expect(f.changes.update({ changeSessionId: id, expectedVersion: result.version, requestId: 'reset-after', action: 'reset', documentId: f.saved.representation.id })).rejects.toThrow('accepted');
  expect((await f.changes.list())[0].status).toBe('accepted');
}));

it('requires readiness and the reviewed version', () => fixture(async f => {
  const id = await f.create(), draft = await f.changes.get(id);
  await expect(f.changes.accept({ changeSessionId: id, expectedVersion: draft.version, requestId: 'early' })).rejects.toThrow('ready');
  const input = await f.ready(id);
  await expect(f.changes.accept({ ...input, expectedVersion: input.expectedVersion - 1 })).rejects.toThrow('VERSION_CONFLICT');
}));

it('detects newer unsaved live edits before publication', () => fixture(async f => {
  const id = await f.create(), input = await f.ready(id);
  f.bridge.list = () => [{ canvasId: 'live', projectId: 'project', documents: [{ documentId: f.saved.representation.id, name: 'Original' }] }];
  f.bridge.dispatch = vi.fn(async () => ({ name: 'Original', document: { scene: singleDiagramScene('Unsaved concurrent edit'), edges: [], sections: {} } }));
  await expect(f.changes.accept(input)).rejects.toThrow('live canvas changed');
  expect(f.bridge.dispatch).toHaveBeenCalledWith('live', { method: 'document-state', documentId: f.saved.representation.id });
  expect(await f.catalog.loadRepresentationCatalog('project')).toEqual(f.saved.catalog);
}));

it('accepts unchanged live state without history but still rejects an unsaved rename', () => fixture(async f => {
  const id = await f.create(), input = await f.ready(id);
  const document = (await f.changes.get(id)).documents[0].baseline!.document;
  f.bridge.list = () => [{ canvasId: 'live', projectId: 'project', documents: [{ documentId: f.saved.representation.id, name: 'Original' }] }];
  f.bridge.dispatch = async () => ({ name: 'Renamed', document });
  await expect(f.changes.accept(input)).rejects.toThrow('live canvas changed');
  expect(await f.catalog.loadRepresentationCatalog('project')).toEqual(f.saved.catalog);
  f.bridge.dispatch = async () => ({ name: 'Original', document });
  expect((await f.changes.accept(input)).status).toBe('accepted');
}));

it('serializes two competing acceptances so only one advances the original', () => fixture(async f => {
  const a = await f.create('a'), b = await f.create('b');
  const inputs = [await f.ready(a), await f.ready(b)];
  const results = await Promise.allSettled(inputs.map(input => f.changes.accept(input)));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const catalog = await f.catalog.loadRepresentationCatalog('project');
  expect(catalog.representations[f.saved.representation.id].revisionIds).toHaveLength(2);
  expect(Object.keys(catalog.changeSessionAcceptances!)).toHaveLength(1);
}));
