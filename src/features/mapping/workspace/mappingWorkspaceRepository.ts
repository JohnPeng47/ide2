import type { MappingWorkspaceSnapshot } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { deserializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';
import { runWorkspaceTask } from './runWorkspaceTask';
export interface MappingWorkspaceRepository {
  load(): Promise<MappingWorkspaceSnapshot | null>;
  save(snapshot: MappingWorkspaceSnapshot): Promise<void>;
}
const endpoint = () => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/mapping/workspace`;
let writes: Promise<void> = Promise.resolve();
export const mappingWorkspaceRepository: MappingWorkspaceRepository = {
  async load() {
    await writes.catch(() => {});
    const response = await fetch(endpoint(), { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not load workspace');
    return result ? deserializeWorkspace(result) : null;
  },
  save(snapshot) {
    // Reserve the write's place before asynchronous validation so older autosaves
    // cannot arrive after a transfer has been published.
    const next = writes.catch(() => {}).then(async () => {
      const body = await runWorkspaceTask({ type: 'serialize', snapshot });
      const response = await fetch(endpoint(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Could not save workspace');
    });
    writes = next;
    return next;
  }
};
