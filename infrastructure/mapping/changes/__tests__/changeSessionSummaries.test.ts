import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { RevisionedDiagramService } from '../../../../domain/core/diagrams/diagramService';

it('lists metadata without restoring bodies, refreshes after external atomic writes, and drops deleted entries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'change-summary-'));
  try {
    const directory = path.join(root, 'mapping-change-sessions/project');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'change-test.json');
    const session = { schemaVersion: 1, id: 'change-test', projectId: 'project', title: 'Before', description: '',
      status: 'draft', version: 0, createdAt: '2026-09-26', updatedAt: '2026-09-26', changes: [],
      documents: [{ id: 'doc', name: 'Canvas', version: 0, proposed: { document: { $diagramRecord: 'diagram', id: 'missing' } } }],
      receipts: { huge: { signature: '', result: 'x'.repeat(100000) } } };
    await writeFile(file, JSON.stringify(session));
    const diagrams = new RevisionedDiagramService();
    const restore = vi.spyOn(diagrams, 'restore').mockRejectedValue(new Error('Full document restore'));
    const store = new DiagramChangeSessionStore(root, diagrams);
    const first = await store.listSummaries('project');
    expect(first[0]).toMatchObject({ title: 'Before', documents: [{ id: 'doc', name: 'Canvas', version: 0 }] });
    expect(first[0]).not.toHaveProperty('receipts');
    expect(first[0].documents[0]).not.toHaveProperty('proposed');
    expect(restore).not.toHaveBeenCalled();
    first[0].title = 'Caller mutation';
    expect((await store.listSummaries('project'))[0].title).toBe('Before');
    await writeFile(`${file}.tmp`, JSON.stringify({ ...session, title: 'After!', version: 1 }));
    await rename(`${file}.tmp`, file);
    expect((await store.listSummaries('project'))[0]).toMatchObject({ title: 'After!', version: 1 });
    // Listing a broken body must not silently bypass validation when it is opened.
    await expect(store.read('project', 'change-test')).rejects.toThrow('Invalid change-session document');
    await rm(file);
    expect(await store.listSummaries('project')).toEqual([]);
    await writeFile(file, JSON.stringify({ ...session, projectId: 'another-project' }));
    await expect(store.listSummaries('project')).rejects.toThrow('identity mismatch');
    expect(JSON.parse(await readFile(file, 'utf8')).projectId).toBe('another-project');
  } finally { await rm(root, { recursive: true, force: true }); }
});
