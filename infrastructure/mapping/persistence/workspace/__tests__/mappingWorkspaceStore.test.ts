import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { MappingWorkspaceStore } from '../mappingWorkspaceStore';
it('atomically saves validated project-scoped workspaces without disturbing the last good snapshot', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'workspace-test-'));
  try {
    const store = new MappingWorkspaceStore(dir);
    expect(await store.load('project')).toBeNull();
    const snapshot = { schemaVersion: 3 as const, projectId: 'project', documents: [] };
    await store.save('project', snapshot); expect(await store.load('project')).toEqual(snapshot);
    await expect(store.save('other', snapshot)).rejects.toThrow('another project');
    await expect(store.save('project', { ...snapshot, schemaVersion: 99 })).rejects.toThrow('version');
    expect(await store.load('project')).toEqual(snapshot);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
