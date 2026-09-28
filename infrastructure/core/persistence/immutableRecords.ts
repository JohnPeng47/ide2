import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export async function publishJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
    const directory = await open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temp, { force: true }); }
}

/** Immutable blobs are published before a manifest makes them reachable. */
export class ImmutableRecords {
  private cache = new Map<string, unknown>();
  private sizes = new Map<string, number>();
  private bytes = 0;
  constructor(private readonly directory: string) {}
  private file(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid record reference');
    return path.join(this.directory, id + '.json');
  }
  async put(value: unknown): Promise<string> {
    const json = JSON.stringify(value), id = createHash('sha256').update(json).digest('hex');
    if (this.cache.has(id)) return id;
    try { if (await readFile(this.file(id), 'utf8') !== json) throw Error('Record integrity failure'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await publishJson(this.file(id), value); }
    this.remember(id, JSON.parse(json), Buffer.byteLength(json)); return id;
  }
  private remember(id: string, value: unknown, bytes: number) {
    if (bytes > 32 * 1024 * 1024) return;
    if (this.cache.has(id)) { this.bytes -= this.sizes.get(id)!; this.cache.delete(id); this.sizes.delete(id); }
    while (this.cache.size && (this.cache.size >= 256 || this.bytes + bytes > 32 * 1024 * 1024)) {
      const oldest = this.cache.keys().next().value!;
      this.bytes -= this.sizes.get(oldest)!; this.cache.delete(oldest); this.sizes.delete(oldest);
    }
    this.cache.set(id, value); this.sizes.set(id, bytes); this.bytes += bytes;
  }
  /** Internal callers treat cached records as immutable. */
  async get<T>(id: string): Promise<T> {
    if (this.cache.has(id)) return this.cache.get(id) as T;
    const json = await readFile(this.file(id), 'utf8');
    if (createHash('sha256').update(json).digest('hex') !== id) throw Error('Record integrity failure');
    const value = JSON.parse(json); this.remember(id, value, Buffer.byteLength(json)); return value;
  }
}
