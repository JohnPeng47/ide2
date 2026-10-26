import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareAlternativeMigration, verifyAlternativeMigration, publishAlternativeMigration } from '../../../../scripts/migrations/migrate-diagram-alternatives';
import { fingerprint } from '../../../../scripts/migrations/migrate-diagram-identities';
import { CanvasHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { DiagramPersistence } from '../../../../domain/core/diagrams/diagramPersistence';
import { DiagramRevisionStore } from '../diagramRevisionStore';

it('stages and verifies new immutable records, preserves exact revisions, and publishes with a backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'alternative-migration-')), source = path.join(root, 'source'), stage = path.join(root, 'stage');
  try {
    await mkdir(path.join(source, 'canvases'), { recursive: true });
    await writeFile(path.join(source, 'project.json'), JSON.stringify({ id: 'project' }));
    const scene = singleDiagramScene('Root'), history = new CanvasHistory({ scene, edges: [], sections: {} }, {}).export();
    const base = scene.contents.overview, revision = revisionFixture().revise(base.revisionId, { kind: 'replace', input: { ascii: 'Candidate', structureKind: base.content.structure.kind } }).revision;
    history.diagramRevisions[revision.id] = revision;
    history.snapshots[history.headId].document.revisionReviews = { candidate: { id: 'candidate', name: 'Candidate', diagramId: base.diagramId, contentId: base.id, ownerNodeId: 'root',
      baseRevisionId: base.revisionId, headRevisionId: revision.id, revisionIds: [revision.id], decisions: {} } };
    const persistence = new DiagramPersistence(new DiagramRevisionStore(source));
    const raw = await persistence.persist({ revisions: { saved: { content: { kind: 'canvas-history', history } } } });
    await writeFile(path.join(source, 'canvases/catalog.json'), JSON.stringify(raw));
    const before = await fingerprint(source);
    await prepareAlternativeMigration(source, stage);
    expect(await fingerprint(source)).toBe(before);
    await expect(publishAlternativeMigration(stage)).rejects.toThrow('verification');
    expect((await verifyAlternativeMigration(stage)).checkpoints).toBe(1);
    const result = await publishAlternativeMigration(stage);
    expect(await fingerprint(result.backup)).toBe(before);
    const migrated: any = await new DiagramPersistence(new DiagramRevisionStore(source)).restore(JSON.parse(await readFile(path.join(source, 'canvases/catalog.json'), 'utf8')));
    const after = migrated.revisions.saved.content.history;
    expect(after.diagramRevisions).toEqual(history.diagramRevisions);
    expect(Object.values(after.snapshots[history.headId].document.alternatives.items)).toMatchObject([{ name: 'Candidate', reviewId: 'candidate' }]);
    // Reading an old content-addressed root still works in the staged copy.
    const original: any = await new DiagramPersistence(new DiagramRevisionStore(source)).restore(raw);
    expect(original.revisions.saved.content.history.snapshots[history.headId].document.alternatives).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
