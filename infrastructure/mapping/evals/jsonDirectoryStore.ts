import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
/** One atomically replaced JSON file per record. */
export class JsonDirectoryStore<T extends { id: string }> {
  private directory: string;
  constructor(root: string, name: string) { this.directory = path.join(root, name); }
  private file(id: string) {
    if (!validId.test(id)) throw Error('Invalid record ID');
    return path.join(this.directory, `${id}.json`);
  }
  async read(id: string): Promise<T | null> {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async list(): Promise<T[]> {
    await mkdir(this.directory, { recursive: true });
    const ids = (await readdir(this.directory)).filter(file => file.endsWith('.json') && validId.test(file.slice(0, -5))).map(file => file.slice(0, -5));
    return (await Promise.all(ids.map(id => this.read(id)))).filter((item): item is Awaited<T> => !!item);
  }
  async delete(id: string) { await rm(this.file(id), { force: true }); }
  async save(item: T) {
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(item), { mode: 0o600 }); await rename(temporary, this.file(item.id)); }
    finally { await rm(temporary, { force: true }); }
  }
}
