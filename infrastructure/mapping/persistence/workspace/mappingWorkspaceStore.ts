import { RevisionedDiagramService, type DiagramService } from '../../../../domain/core/diagrams/diagramService';
import { DiagramRevisionStore } from '../../../core/persistence/diagramRevisionStore';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { deserializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';
/** Separate from representation revisions: UI changes do not create diagram revisions. */
export class MappingWorkspaceStore {
  constructor(private readonly root: string, private readonly diagrams: DiagramService = new RevisionedDiagramService(new DiagramRevisionStore(root))) {}
  async load(projectId: string): Promise<MappingWorkspaceSnapshot | null> {
    let json: string;
    try { json = await readFile(path.join(this.root, 'mapping-workspace.json'), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    // A missing referenced diagram is corruption, not a missing workspace.
    const snapshot = deserializeWorkspace(await this.diagrams.restore(JSON.parse(json)));
    if (snapshot.projectId !== projectId) throw new Error('Workspace belongs to another project');
    return snapshot;
  }

  async save(projectId: string, input: unknown): Promise<void> {
    const snapshot = deserializeWorkspace(input);
    if (snapshot.projectId !== projectId) throw new Error('Workspace belongs to another project');
    const json = JSON.stringify(await this.diagrams.persist(snapshot));
    await mkdir(this.root, { recursive: true });
    const temp = path.join(this.root, `.mapping-workspace-${randomUUID()}.tmp`);
    try { await writeFile(temp, json, 'utf8'); await rename(temp, path.join(this.root, 'mapping-workspace.json')); }
    finally { await rm(temp, { force: true }); }
  }
}
