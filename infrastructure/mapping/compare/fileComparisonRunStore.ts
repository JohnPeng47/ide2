import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ComparisonRunStore } from '../../../application/mapping/compare/comparisonGenerationService';
import type { ComparisonRun } from '../../../domain/mapping/compare/comparisonGeneration';

export class FileComparisonRunStore implements ComparisonRunStore {
  private directory: string;
  constructor(root: string) { this.directory = path.join(root, 'comparison-runs'); }
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('Invalid comparison run ID');
    return path.join(this.directory, `${id}.json`);
  }
  async read(id: string): Promise<ComparisonRun | null> {
    try { return JSON.parse(await readFile(this.file(id), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const runs = await Promise.all((await readdir(this.directory)).filter(file => /^[a-f0-9-]{36}\.json$/i.test(file)).map(file => this.read(file.slice(0, -5))));
    return runs.filter((run): run is ComparisonRun => !!run);
  }
  async delete(id: string) { await rm(this.file(id), { force: true }); }
  async save(run: ComparisonRun) {
    await mkdir(this.directory, { recursive: true });
    const temporary = path.join(this.directory, `.${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(run), { mode: 0o600 }); await rename(temporary, this.file(run.id)); }
    finally { await rm(temporary, { force: true }); }
  }
}
