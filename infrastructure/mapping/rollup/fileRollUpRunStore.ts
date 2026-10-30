/** Read-only access to pre-Evals roll-up runs; save remains for fixtures. */
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LegacyRollUpStore } from '../../../application/mapping/evals/evalRunService';
import type { RollUpRun } from '../../../domain/mapping/rollup/rollUp';

export class FileRollUpRunStore implements LegacyRollUpStore {
  private directory: string;
  constructor(root: string) { this.directory = path.join(root, 'rollup-runs'); }
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('Invalid roll-up run ID');
    return path.join(this.directory, `${id}.json`);
  }
  async read(id: string): Promise<RollUpRun | null> {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const runs = await Promise.all((await readdir(this.directory)).filter(file => /^[a-f0-9-]{36}\.json$/i.test(file)).map(file => this.read(file.slice(0, -5))));
    return runs.filter((run): run is RollUpRun => !!run);
  }
  async delete(id: string) { await rm(this.file(id), { force: true }); }
  async save(run: RollUpRun) {
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(run), { mode: 0o600 }); await rename(temporary, this.file(run.id)); }
    finally { await rm(temporary, { force: true }); }
  }
}
