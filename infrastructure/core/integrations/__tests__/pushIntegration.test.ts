import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { PushIntegrationService } from '../../../../application/core/integrations/pushIntegrationService';
import { decodeArtifactsPush } from '../../../../application/core/integrations/artifactsPush';
import { repositoryConnectionSchema } from '../../../../domain/core/integrations/pushIntegration';
import type { PushSource, PushWorkflow } from '../../../../application/core/integrations/ports';
import { FilePushIntegrationStore } from '../pushIntegrationStore';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const accountId = 'a'.repeat(32), a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const connection = repositoryConnectionSchema.parse({ id: 'test', repositoryId: 'repo-local',
  external: { provider: 'artifacts', accountId, namespace: 'default', repoName: 'example' },
  remoteUrl: `https://${accountId}.artifacts.cloudflare.net/git/default/example.git` });
const event = { eventId: 'push-1', ref: 'refs/heads/main', before: a, after: c };
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'push-integration-')); roots.push(root);
  const store = new FilePushIntegrationStore(root);
  const source: PushSource = { validateConnection: vi.fn(async () => {}),
    resolve: vi.fn(async () => ({ kind: 'update' as const, commits: [b, c], hasChanges: true })) };
  const workflow: PushWorkflow = { start: vi.fn(async () => ({ id: 'workflow', status: 'running' as const })),
    get: vi.fn(async () => ({ id: 'workflow', status: 'completed' as const, changeSessionId: 'proposal' })) };
  const service = new PushIntegrationService(store, source, workflow, true);
  await service.connect(connection);
  return { root, store, source, workflow, service };
}
it('creates exactly one workflow for concurrent/repeated deliveries, with all commits and pinned push endpoints', async () => {
  const f = await setup();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.service.receive('test', event)));
  expect(new Set(results.map(result => result.id)).size).toBe(1);
  expect(f.workflow.start).toHaveBeenCalledTimes(1);
  expect(f.workflow.start).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: 'repo-local', commits: [b, c], comparisonBase: a, head: c }));
  expect(await f.service.get(results[0].id)).toMatchObject({ status: 'completed', changeSessionId: 'proposal' });
  const reopened = new PushIntegrationService(new FilePushIntegrationStore(f.root), f.source, f.workflow, true);
  expect(await reopened.receive('test', event)).toMatchObject({ id: results[0].id, changeSessionId: 'proposal' });
  expect(f.workflow.start).toHaveBeenCalledTimes(1);
  await expect(reopened.receive('test', { ...event, after: b })).rejects.toThrow('PUSH_EVENT_ID_CONFLICT');
  expect(await f.service.generations('test')).toHaveLength(1);
});
it('atomically claims an event across independent service instances', async () => {
  const f = await setup();
  const other = new PushIntegrationService(new FilePushIntegrationStore(f.root), f.source, f.workflow, true);
  await Promise.all([f.service.receive('test', event), other.receive('test', event)]);
  expect(f.workflow.start).toHaveBeenCalledTimes(1);
});
it('does not conflate distinct pushes that happen to have the same endpoints', async () => {
  const f = await setup();
  const first = await f.service.receive('test', event);
  const second = await f.service.receive('test', { ...event, eventId: 'another-push' });
  expect(first.id).not.toBe(second.id);
  expect(f.workflow.start).toHaveBeenCalledTimes(2);
});
it('normalizes Artifacts identity, ignores truncated commit hints, and rejects a foreign repository', async () => {
  const raw = { type: 'cf.artifacts.repo.pushed', source: { type: 'artifacts.repo', namespace: 'default', repoName: 'example' },
    payload: { ref: event.ref, before: a, after: c, commits: [{ id: c }], commitsTruncated: true, totalCommitsCount: 2 },
    metadata: { accountId, eventSchemaVersion: 1, eventTimestamp: '2026-10-14T01:02:03Z', eventSubscriptionId: 'one' } };
  const f = await setup();
  const first = await f.service.receive('test', raw, 'artifacts');
  const second = await f.service.receive('test', { ...raw, metadata: { ...raw.metadata, eventSubscriptionId: 'two' } }, 'artifacts');
  expect(first.id).toBe(second.id);
  expect(first.commits).toEqual([b, c]);
  expect(() => decodeArtifactsPush(connection, { ...raw, source: { ...raw.source, repoName: 'foreign' } })).toThrow('does not belong');
  expect(() => decodeArtifactsPush(connection, { ...raw, metadata: { ...raw.metadata, eventSchemaVersion: 2 } })).toThrow();
});
it('skips branch deletion, unchanged refs, tags and net-empty pushes without calling the model', async () => {
  const f = await setup();
  expect(await f.service.receive('test', { ...event, after: '0'.repeat(40) })).toMatchObject({ kind: 'delete', status: 'skipped' });
  expect(await f.service.receive('test', { ...event, eventId: 'same', after: a })).toMatchObject({ status: 'skipped', kind: 'unchanged' });
  expect(await f.service.receive('test', { ...event, eventId: 'tag', ref: 'refs/tags/v1' })).toMatchObject({ status: 'skipped' });
  vi.mocked(f.source.resolve).mockResolvedValue({ kind: 'update' as const, commits: [b, c], hasChanges: false });
  expect(await f.service.receive('test', { ...event, eventId: 'empty' })).toMatchObject({ status: 'skipped', reason: 'Push has no net content changes' });
  expect(f.workflow.start).not.toHaveBeenCalled();
});
it('starts a rollback comparison even when no commits are newly reachable', async () => {
  const f = await setup();
  vi.mocked(f.source.resolve).mockResolvedValue({ kind: 'force-push', commits: [], hasChanges: true });
  expect(await f.service.receive('test', { ...event, before: c, after: a })).toMatchObject({ kind: 'force-push', commits: [], status: 'running' });
  expect(f.workflow.start).toHaveBeenCalledWith(expect.objectContaining({ comparisonBase: c, head: a, commits: [] }));
});
it('stores visible failures, and validates connection identity, secrets and enabled state', async () => {
  const f = await setup();
  vi.mocked(f.source.resolve).mockRejectedValue(Error('Missing commit'));
  expect(await f.service.receive('test', event)).toMatchObject({ status: 'failed', error: 'Missing commit' });
  await expect(f.service.connect({ ...connection, repositoryId: 'other' })).rejects.toThrow('immutable');
  expect(() => repositoryConnectionSchema.parse({ ...connection, remoteUrl: 'https://token:secret@example.com/repo.git' })).toThrow();
  expect(() => repositoryConnectionSchema.parse({ ...connection, remoteUrl: 'https://example.com/repo.git' })).toThrow();
  await f.service.connect({ ...connection, enabled: false });
  await expect(f.service.receive('test', { ...event, eventId: 'disabled' })).rejects.toThrow('disabled');
});
