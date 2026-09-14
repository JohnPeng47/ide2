import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { deserializeWorkspace, serializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';
/** Separate from representation revisions: UI changes do not create diagram revisions. */
export class MappingWorkspaceStore {
  constructor(private readonly root: string) { }
  async load(projectId: string): Promise<MappingWorkspaceSnapshot | null> {
    try {
      const snapshot = deserializeWorkspace(await readFile(path.join(this.root, 'mapping-workspace.json'), 'utf8'));
      if (snapshot.projectId !== projectId) throw new Error('Workspace belongs to another project');
      return snapshot;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async save(projectId: string, input: unknown): Promise<void> {
    const snapshot = deserializeWorkspace(input);
    if (snapshot.projectId !== projectId) throw new Error('Workspace belongs to another project');
    const json = serializeWorkspace(snapshot);
    await mkdir(this.root, { recursive: true });
    const temp = path.join(this.root, `.mapping-workspace-${randomUUID()}.tmp`);
    try { await writeFile(temp, json, 'utf8'); await rename(temp, path.join(this.root, 'mapping-workspace.json')); }
    finally { await rm(temp, { force: true }); }
  }
}
