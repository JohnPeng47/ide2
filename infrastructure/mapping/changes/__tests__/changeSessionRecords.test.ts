import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { DiagramPersistence } from '../../../../domain/core/diagrams/diagramPersistence';
import { DiagramRevisionStore } from '../../../core/persistence/diagramRevisionStore';
import { CanvasHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import type { DiagramChangeSession } from '../../../../domain/mapping/changes/diagramChangeSession';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
vi.mock('node:fs/promises', async original => { const actual = await original<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename) }; });
const roots: string[] = [];
afterEach(async () => { vi.mocked(rename).mockRestore(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'change-record-test-')); roots.push(root);
  const store = new DiagramChangeSessionStore(root);
  const documents = ['Alpha', 'Beta'].map(name => {
    const state = { document: { scene: singleDiagramScene(name), edges: [], sections: {} }, canvas: initialCanvasState() };
    return { id: name, name, version: 0, baseline: state, proposed: structuredClone(state), past: [], future: [], history: new CanvasHistory(state.document,state.canvas).export() };
  });
  const session: DiagramChangeSession = { schemaVersion: 1, id: 'proposal', projectId: 'project', title: 'Proposal', description: '', status: 'draft', version: 0,
    createdAt: '2026-09-28', updatedAt: '2026-09-28', documents, changes: [], receipts: { create: { signature: 'create', result: { id: 'proposal' } } } };
  await store.write(session);
  const manifest = () => readFile(path.join(root,'mapping-change-sessions/project/proposal.manifest.json'),'utf8').then(JSON.parse);
  const blob = (id: string) => readFile(path.join(root,'change-session-records',id+'.json'),'utf8').then(JSON.parse);
  return { root, store, session, manifest, blob };
}
it('shares unchanged view checkpoints and reads one canvas without loading its history or other canvases', async () => {
  const f = await fixture(), manifest = await f.manifest(), alpha = await f.blob(manifest.documents.Alpha);
  expect(alpha.baseline).toBe(alpha.proposed);
  // Make the unrelated canvas and undo history unreadable. A scoped preview and list still work.
  await rm(path.join(f.root,'change-session-records',manifest.documents.Beta+'.json'));
  await rm(path.join(f.root,'change-session-records',alpha.history.header+'.json'));
  const fresh = new DiagramChangeSessionStore(f.root);
  expect((await fresh.listSummaries('project'))[0].documents).toHaveLength(2);
  const preview = await fresh.readPreview('project','proposal','Alpha');
  expect(preview.document.proposed.document.scene.contents.overview.content.ascii).toBe('Alpha');
  for (const field of ['history','past','future']) expect(preview.document).not.toHaveProperty(field);
  expect(preview).not.toHaveProperty('receipts');
  await expect(fresh.read('project','proposal')).rejects.toThrow();
});
it('updates metadata/receipts without rewriting canvases and rejects a stale publisher', async () => {
  const f = await fixture(), original = await f.manifest();
  const first = await f.store.read('project','proposal'), stale = await f.store.read('project','proposal');
  first.title = 'Renamed'; first.version++;
  first.receipts.rename = { signature: 'rename', result: { version: 1 } };
  await f.store.write(first, { documents: [], receipts: ['rename'] });
  const next = await f.manifest();
  expect(next.documents).toEqual(original.documents);
  expect(next.receipts).not.toBe(original.receipts);
  stale.title = 'Stale'; stale.version++;
  await expect(f.store.write(stale, { documents: [], receipts: [] })).rejects.toThrow('VERSION_CONFLICT');
  expect((await new DiagramChangeSessionStore(f.root).read('project','proposal')).receipts).toEqual(first.receipts);
});
it('serializes only the edited canvas and reuses its old checkpoints and the other canvas', async () => {
  const f=await fixture(), before=await f.manifest(), oldAlpha=await f.blob(before.documents.Alpha);
  const diagrams=new DiagramPersistence(new DiagramRevisionStore(f.root));
  const store=new DiagramChangeSessionStore(f.root,diagrams), session=await store.read('project','proposal');
  const persist=vi.spyOn(diagrams,'persist'), doc=session.documents[0];
  const history=new CanvasHistory(doc.proposed.document,doc.proposed.canvas,doc.history);
  const document={...doc.proposed.document,scene:singleDiagramScene('Edited Alpha')};
  history.append(document,doc.proposed.canvas);
  doc.history=history.export(); doc.proposed={...doc.proposed,document}; doc.version++; session.version++;
  await store.write(session,{documents:['Alpha'],receipts:[]});
  expect(persist).toHaveBeenCalledTimes(1);
  expect(persist.mock.calls[0][0]).toHaveProperty('id','Alpha');
  const after=await f.manifest(), alpha=await f.blob(after.documents.Alpha);
  expect(after.documents.Beta).toBe(before.documents.Beta);
  expect(alpha.baseline).toBe(oldAlpha.baseline);
  for(const [id,ref] of Object.entries(oldAlpha.history.checkpoints)) expect(alpha.history.checkpoints[id]).toBe(ref);
  expect((await new DiagramChangeSessionStore(f.root).readPreview('project','proposal','Alpha')).document.proposed.document.scene.contents.overview.content.ascii).toBe('Edited Alpha');
});
it('a failed manifest replacement leaves the old complete session and permits retry', async () => {
  const f = await fixture(), before = await f.manifest(), session = await f.store.read('project','proposal');
  session.title = 'Replacement'; session.version++;
  vi.mocked(rename).mockRejectedValueOnce(Error('disk failure'));
  await expect(f.store.write(session,{documents:[],receipts:[]})).rejects.toThrow('disk failure');
  expect(await f.manifest()).toEqual(before);
  await f.store.write(session,{documents:[],receipts:[]});
  expect((await new DiagramChangeSessionStore(f.root).readSummary('project','proposal')).title).toBe('Replacement');
});
it('checks versions without hydrating a preview', async () => {
  const f=await fixture();
  const preview=vi.spyOn(f.store,'readPreview');
  const source={loadProject:async()=>({id:'project'}),projectCatalogs:{loadChangeSessionAcceptances:async()=>({})}} as unknown as DiagramRepository;
  const service=new ChangeSessionService(f.store,source,{} as CanvasSessionPort);
  expect(await service.preview('proposal','Alpha',0)).toBeNull();
  expect(preview).not.toHaveBeenCalled();
  expect((await service.preview('proposal','Alpha'))?.document.id).toBe('Alpha');
});
it('uses the production worker for scoped reads and preserves full compatibility reads', async () => {
  const f=await fixture(), worker=new DiagramChangeSessionStore(f.root,undefined,true);
  expect((await worker.readPreview('project','proposal','Beta')).document.proposed.document.scene.contents.overview.content.ascii).toBe('Beta');
  const session=await worker.read('project','proposal'); session.title='Worker title'; session.version++;
  await worker.write(session,{documents:[],receipts:[]});
  expect((await f.store.readSummary('project','proposal')).title).toBe('Worker title');
  expect((await f.store.read('project','proposal')).documents).toEqual(f.session.documents);
});
it('migrates embedded legacy data without altering its original file or losing history and receipts', async () => {
  const f=await fixture();
  const directory=path.join(f.root,'mapping-change-sessions/project');
  await rm(path.join(directory,'proposal.manifest.json'));
  const original=JSON.stringify(f.session);
  await writeFile(path.join(directory,'proposal.json'),original);
  const fresh=new DiagramChangeSessionStore(f.root);
  const preview=await fresh.readPreview('project','proposal','Alpha');
  expect(preview.document.proposed).toEqual(f.session.documents[0].proposed);
  expect(await readFile(path.join(directory,'proposal.json'),'utf8')).toBe(original);
  expect(await new DiagramChangeSessionStore(f.root).read('project','proposal')).toEqual({ ...f.session, migrations: [] });
  const manifest=await f.manifest(), doc=await f.blob(manifest.documents.Alpha), state=await f.blob(doc.proposed);
  expect(state.document.scene.contents.overview).toHaveProperty('$diagramRecord','diagram');
});

it('publishes DiffTree data and summary together, preserving the prior review after a failed write', async () => {
  const { defaultDiffTree } = await import('../../../../domain/mapping/changes/diffTree');
  const { revisionFixture } = await import('../../../../tests/support/diagramRevisions');
  const f = await fixture(), before = await f.manifest();
  const session = await f.store.read('project', 'proposal');
  session.repositoryId = 'repo-test'; session.commits = []; session.head = 'a'.repeat(40);
  session.diffTree = defaultDiffTree([]); session.version++;
  vi.mocked(rename).mockRejectedValueOnce(Error('disk failure'));
  await expect(f.store.write(session, { documents: [], receipts: [], diffTree: true })).rejects.toThrow('disk failure');
  expect(await f.manifest()).toEqual(before);
  expect((await new DiagramChangeSessionStore(f.root).readDiffTree('project', 'proposal')).diffTree).toBeUndefined();
  await f.store.write(session, { documents: [], receipts: [], diffTree: true });
  const after = await f.manifest();
  expect(after.diffTree).toBeTruthy(); expect(after.documents).toEqual(before.documents);
  expect((await new DiagramChangeSessionStore(f.root).readDiffTree('project', 'proposal')).diffTree).toEqual(session.diffTree);
  // A missing tree blob must not break summary or canvas-preview reads.
  await rm(path.join(f.root, 'change-session-records', after.diffTree + '.json'));
  const fresh = new DiagramChangeSessionStore(f.root);
  expect((await fresh.readSummary('project', 'proposal')).diffTree?.hunkCount).toBe(0);
  expect((await fresh.readPreview('project', 'proposal', 'Alpha')).document.name).toBe('Alpha');
  await expect(fresh.readDiffTree('project', 'proposal')).rejects.toThrow();
});
