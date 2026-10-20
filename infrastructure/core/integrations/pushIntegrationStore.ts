import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { connectionIdSchema, repositoryConnectionSchema, type PushGeneration, type RepositoryConnection } from '../../../domain/core/integrations/pushIntegration';
import type { PushIntegrationStore } from '../../../application/core/integrations/ports';
import { publishJson } from '../persistence/immutableRecords';

export class FilePushIntegrationStore implements PushIntegrationStore {
  private readonly root: string;
  constructor(storeRoot: string) { this.root = path.join(storeRoot, 'push-integrations'); }
  private connectionFile(id: string) { return path.join(this.root, 'connections', `${connectionIdSchema.parse(id)}.json`); }
  private generationFile(id: string) {
    if (!/^push-[a-f0-9]{32}$/.test(id)) throw Error('Invalid push generation ID');
    return path.join(this.root, 'generations', `${id}.json`);
  }
  private async read<T>(file: string): Promise<T | undefined> {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  private async files(directory: string) {
    try { return (await readdir(directory)).filter(name => name.endsWith('.json')).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async connections() {
    const names = await this.files(path.join(this.root, 'connections'));
    return Promise.all(names.map(async name => repositoryConnectionSchema.parse(await this.read(path.join(this.root, 'connections', name)))));
  }
  async connection(id: string) {
    const value = await this.read(this.connectionFile(id));
    return value ? repositoryConnectionSchema.parse(value) : undefined;
  }
  saveConnection(connection: RepositoryConnection) { return publishJson(this.connectionFile(connection.id), repositoryConnectionSchema.parse(connection)); }
  async generations(connectionId?: string) {
    const names = await this.files(path.join(this.root, 'generations'));
    const values = await Promise.all(names.map(name => this.read<PushGeneration>(path.join(this.root, 'generations', name))));
    return values.filter((value): value is PushGeneration => !!value && (!connectionId || value.connectionId === connectionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  generation(id: string) { return this.read<PushGeneration>(this.generationFile(id)); }
  async createGeneration(generation: PushGeneration) {
    const file = this.generationFile(generation.id);
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.claim`;
    try {
      await publishJson(temp, generation);
      // Atomic create-if-absent: readers never see a half-written claim, including
      // when two server processes receive the same event concurrently.
      await link(temp, file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    } finally { await rm(temp, { force: true }); }
  }
  saveGeneration(generation: PushGeneration) { return publishJson(this.generationFile(generation.id), generation); }
}
