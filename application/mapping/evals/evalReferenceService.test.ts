import { describe, expect, it } from 'vitest';
import type { EvalReference, EvalReferenceGroup } from '../../../domain/mapping/evals/evalReference';
import { EvalReferenceService } from './evalReferenceService';

const memory = <T extends { id: string }>() => {
  const records = new Map<string, T>();
  return { records, list: async () => [...records.values()], read: async (id: string) => records.get(id) ?? null, save: async (item: T) => { records.set(item.id, item); }, delete: async (id: string) => { records.delete(id); } };
};
const setup = () => {
  const references = memory<EvalReference>(), groups = memory<EvalReferenceGroup>();
  return { references, groups, service: new EvalReferenceService(references, { loadProject: async () => ({ id: 'project' }) }, groups) };
};
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const input = (name: string, extra = {}) => ({ requestId: uuid(), name, ascii: name, source: { documentId: 'd', checkpointId: 'c' }, sourceName: 's', canvasName: 'canvas', ...extra });

describe('reference groups', () => {
  it('creates idempotently and rejects references into an unknown group', async () => {
    const { service } = setup(), requestId = uuid();
    const group = await service.createGroup({ requestId, name: 'Trees' });
    expect(await service.createGroup({ requestId, name: 'Trees' })).toEqual(group);
    expect(group.id).toBe('trees');
    expect((await service.create(input('A', { groupId: group.id }))).groupId).toBe(group.id);
    await expect(service.create(input('B', { groupId: 'missing' }))).rejects.toThrow('not found');
  });
  it('moves references in and out of groups', async () => {
    const { service } = setup(), group = await service.createGroup({ requestId: uuid(), name: 'Trees' }), reference = await service.create(input('A'));
    expect((await service.update(reference.id, { groupId: group.id })).groupId).toBe(group.id);
    expect((await service.update(reference.id, { groupId: null })).groupId).toBeUndefined();
    await expect(service.update(reference.id, { groupId: 'missing' })).rejects.toThrow('not found');
  });
  it('deleting a group keeps its references, archived ones included', async () => {
    const { service, groups } = setup(), group = await service.createGroup({ requestId: uuid(), name: 'Trees' });
    const live = await service.create(input('A', { groupId: group.id })), archived = await service.create(input('B', { groupId: group.id }));
    await service.update(archived.id, { archived: true });
    await service.deleteGroup(group.id);
    expect(groups.records.size).toBe(0);
    expect((await service.read(live.id)).groupId).toBeUndefined();
    const restored = await service.read(archived.id);
    expect(restored.groupId).toBeUndefined(); expect(restored.archivedAt).toBeTruthy();
  });
  it('renames without changing the ID', async () => {
    const { service } = setup(), group = await service.createGroup({ requestId: uuid(), name: 'Trees' });
    expect(await service.updateGroup(group.id, { name: 'Forests' })).toMatchObject({ id: 'trees', name: 'Forests' });
  });
});

describe('reference comments', () => {
  it('stores an optional trimmed comment, edits it, and removes it when emptied', async () => {
    const { service } = setup();
    expect((await service.create(input('Bare'))).comment).toBeUndefined();
    const reference = await service.create(input('Noted', { comment: '  Follow this nesting.  ' }));
    expect(reference.comment).toBe('Follow this nesting.');
    expect((await service.update(reference.id, { comment: 'Changed' })).comment).toBe('Changed');
    expect((await service.update(reference.id, { name: 'Renamed' })).comment).toBe('Changed');
    expect((await service.update(reference.id, { comment: '  ' })).comment).toBeUndefined();
  });
});
