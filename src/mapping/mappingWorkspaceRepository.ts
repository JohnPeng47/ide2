import type { MappingWorkspaceSnapshot } from './mappingWorkspace';
import { deserializeWorkspace, serializeWorkspace } from './mappingWorkspaceCodec';
export interface MappingWorkspaceRepository {
  load(): Promise<MappingWorkspaceSnapshot | null>;
  save(snapshot: MappingWorkspaceSnapshot): Promise<void>;
}
const endpoint = () => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/mapping/workspace`;
export const mappingWorkspaceRepository: MappingWorkspaceRepository = {
  async load() {
    const response = await fetch(endpoint(), { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not load workspace');
    return result ? deserializeWorkspace(result) : null;
  },
  async save(snapshot) {
    const response = await fetch(endpoint(), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: serializeWorkspace(snapshot) });
    if (!response.ok) throw new Error((await response.json()).error ?? 'Could not save workspace');
  }
};
