import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DiagramRecordKind, DiagramRecordStore } from '../../../domain/core/diagrams/diagramPersistence';

/** Diagram data is immutable; canvases publish references only after these writes finish. */
export class DiagramRevisionStore implements DiagramRecordStore {
  constructor(private readonly root: string) {}
  private file(kind: DiagramRecordKind, id: string) {
    if (!['diagram', 'revision', 'history', 'workspace'].includes(kind) || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid diagram record identity');
    if (kind === 'workspace') return path.join(this.root, 'workspace-records', `${id}.json`);
    return path.join(this.root, 'diagrams', kind, `${id}.json`);
  }
  async put(kind: DiagramRecordKind, data: unknown) {
    const json = JSON.stringify(data);
    const id = createHash('sha256').update(json).digest('hex'), target = this.file(kind, id);
    try {
      const existing = await readFile(target, 'utf8');
      if (existing !== json) throw new Error('Diagram record integrity failure');
      return id;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp, json, 'utf8'); await rename(temp, target); }
    finally { await rm(temp, { force: true }); }
    return id;
  }
  async get(kind: DiagramRecordKind, id: string) {
    const json = await readFile(this.file(kind, id), 'utf8');
    if (createHash('sha256').update(json).digest('hex') !== id) throw new Error('Diagram record integrity failure');
    return JSON.parse(json) as unknown;
  }
}
