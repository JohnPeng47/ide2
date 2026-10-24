import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IdentityMigration, prepareMigration, publishMigration, verifyMigration } from '../../../../scripts/migrations/migrate-diagram-identities';
import { CanvasHistory, documentFromHistory, validateCanvasHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { CanvasCatalogStore } from '../canvasCatalogStore';

function oldHistory() {
  const service = revisionFixture();
  const document = { scene: singleDiagramScene('Before'), edges: [], sections: {} };
  const h = new CanvasHistory(document, initialCanvasState());
  const next = service.revise(document.scene.contents.overview.revisionId, { kind: 'replace', input: { ascii: 'After' } });
  h.append({ ...document, scene: { ...document.scene, contents: { ...document.scene.contents, overview: next.diagram } } }, initialCanvasState());
  h.navigate(); // Retain redo as well as both immutable revisions.
  const raw: any = h.export();
  const ids = Object.fromEntries(Object.keys(raw.diagramRevisions).map(id => [id, `diagram-revision-${crypto.randomUUID()}`]));
  raw.diagramRevisions = Object.fromEntries(Object.values(raw.diagramRevisions).map((r: any) => {
    r.id = ids[r.id]; if (r.parentId) r.parentId = ids[r.parentId];
    r.diagramId = r.diagram.id; delete r.diagram.diagramId; delete r.diagram.revisionId;
    return [r.id, r];
  }));
  for (const s of Object.values(raw.snapshots) as any[]) for (const k of Object.keys(s.diagramBindings)) s.diagramBindings[k] = ids[s.diagramBindings[k]];
  return raw;
}

it('preserves revision ancestry, node references, checkpoints and redo while assigning lineage identities', () => {
  const old = oldHistory(), migration = new IdentityMigration(); migration.collect(old);
  const migrated = migration.upgradeHistory(old);
  expect(migrated.snapshots).toEqual(old.snapshots);
  expect(migrated.future).toEqual(old.future);
  for (const [id, r] of Object.entries(migrated.diagramRevisions) as [string, any][]) {
    expect(r.diagram.revisionId).toBe(id);
    expect(r.nodeRefs).toEqual(old.diagramRevisions[id].nodeRefs);
    expect(r.parentId).toBe(old.diagramRevisions[id].parentId);
    if (r.parentId) expect(r.diagramId).toBe(migrated.diagramRevisions[r.parentId].diagramId);
  }
  const restored = new CanvasHistory(documentFromHistory(migrated), initialCanvasState(), migrated);
  expect(restored.document().scene.contents.overview.content.ascii).toBe('Before');
  restored.navigate(true);
  expect(restored.document().scene.contents.overview.content.ascii).toBe('After');
  expect(migration.upgradeHistory(migrated)).toEqual(migrated);
});

it('keeps identical local IDs in independent histories distinct and reuses identities across forks', () => {
  const a = oldHistory(), b = oldHistory(), fork = { ...a, contextId: 'fork' };
  const migration = new IdentityMigration(); migration.collect([a, b, fork]);
  const ma = migration.upgradeHistory(a), mb = migration.upgradeHistory(b), mf = migration.upgradeHistory(fork);
  const identity = (h: any) => h.diagramRevisions[h.snapshots[h.headId].diagramBindings.overview].diagramId;
  expect(identity(ma)).not.toBe(identity(mb)); expect(identity(mf)).toBe(identity(ma));
});

it('converts legacy proposal stacks without dropping undo/redo or changing their content', () => {
  const old = oldHistory();
  const before = { document: documentFromHistory(old), canvas: initialCanvasState() };
  const after = { document: documentFromHistory(old, old.future[0]), canvas: initialCanvasState() };
  const session = { schemaVersion: 1, id: 'change-test', projectId: 'project', title: 'Test', description: '', status: 'draft', version: 1,
    createdAt: 'now', updatedAt: 'now', changes: [], receipts: {}, documents: [{ id: 'document', name: 'Canvas', version: 1,
      baseline: before, proposed: before, past: [after], future: [after] }] };
  const m = new IdentityMigration(); m.collect(session);
  const next = m.session(session), d = next.documents[0];
  validateCanvasHistory(d.history);
  expect(d.history.past).toHaveLength(1); expect(d.history.future).toHaveLength(1);
  const h = new CanvasHistory(d.proposed.document, d.proposed.canvas, d.history);
  h.navigate(true); expect(h.document().scene.contents.overview.content.ascii).toBe('After');
});

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('stages old catalogs without touching source, rejects concurrent writes, and publishes with a complete backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'diagram-migration-test-')); roots.push(root);
  const source = path.join(root, 'source'), stage = path.join(root, 'stage');
  const old = oldHistory();
  const { mkdir } = await import('node:fs/promises'); await mkdir(path.join(source, 'canvases'), { recursive: true });
  const catalog = { schemaVersion: 1, projectId: 'project', representations: {}, revisions: { r: { representationId: 'rep', content: { kind: 'canvas-history', history: old } },
    legacy: { representationId: 'rep-legacy', content: { kind: 'mapping-canvas', scene: documentFromHistory(old).scene } } } };
  const file = path.join(source, 'canvases/catalog.json'), original = JSON.stringify(catalog);
  await writeFile(file, original);
  await writeFile(path.join(source, 'project.json'), JSON.stringify({ id: 'project' }));
  await prepareMigration(source, stage);
  expect(await readFile(file, 'utf8')).toBe(original);
  const restored = await new CanvasCatalogStore(stage).loadRepresentationCatalog('project');
  expect(Object.values(restored.revisions).every(r => r.content?.kind === 'canvas-history')).toBe(true);
  await expect(publishMigration(stage)).rejects.toThrow('Stage must pass verification');
  await verifyMigration(stage);
  await writeFile(file, original + '\n');
  await expect(publishMigration(stage)).rejects.toThrow('Source changed');
  await writeFile(file, original);
  const result = await publishMigration(stage);
  expect(await readFile(path.join(result.backup, 'canvases/catalog.json'), 'utf8')).toBe(original);
  expect(await prepareMigration(source, path.join(root, 'second'))).toEqual({ alreadyMigrated: true });
});

it('fails on missing ancestry instead of guessing identity', () => {
  const old = oldHistory(), child: any = Object.values(old.diagramRevisions).find((r: any) => r.parentId);
  delete old.diagramRevisions[child.parentId];
  const m = new IdentityMigration(); m.collect(old);
  expect(() => m.upgradeHistory(old)).toThrow('Missing revision parent');
});
