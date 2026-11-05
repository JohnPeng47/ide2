import { expect, it } from 'vitest';
import { EvalPromptService, promptContentHash } from './evalPromptService';
import type { EvalPrompt, PromptDerivation } from '../../../domain/mapping/evals/evalPrompt';

function fixture() {
  const records = new Map<string, EvalPrompt>();
  const store = { list: async () => structuredClone([...records.values()]), read: async (id: string) => structuredClone(records.get(id) ?? null), save: async (p: EvalPrompt) => { records.set(p.id, structuredClone(p)); } };
  const service = new EvalPromptService(store, { loadProject: async () => ({ id: 'project' }) });
  const create = (name = 'Baseline', derivation?: PromptDerivation) => service.save({ requestId: crypto.randomUUID(), name, workflow: 'alternatives', stages: { alternative: 'Read context.json. Generate ASCII trees.' }, ...(derivation ? { derivation } : {}) });
  return { service, create, records, store };
}
it('pins variation ancestry and content while parents are edited, renamed, and archived', async () => {
  const f = fixture(), baseline = await f.create();
  const derivation: PromptDerivation = { parent: { promptId: baseline.id, version: 1 }, kind: 'variation', dimension: { id: 'expression', name: 'Expression', value: 'Code' } };
  const child = await f.create('Code', derivation);
  const before = await f.service.resolve(child.id, 1, 'alternatives');
  const edited = await f.service.save({ requestId: crypto.randomUUID(), promptId: baseline.id, baseVersion: 1, workflow: 'alternatives', name: 'Renamed baseline', stages: { alternative: 'New instructions' } });
  expect(edited.versions[1].derivation).toEqual({ parent: { promptId: baseline.id, version: 1 }, kind: 'revision' });
  await f.service.setArchived(baseline.id, true);
  expect(await f.service.resolve(child.id, 1, 'alternatives')).toEqual(before);
  expect(before.derivation).toEqual(derivation); expect(before.contentHash).toEqual(promptContentHash(before.stages));
  expect((await f.service.resolve(baseline.id, 1, 'alternatives')).stages).toEqual(baseline.versions[0].stages);
});
it('serializes competing revisions so one edit cannot silently overwrite another', async () => {
  const f = fixture(), baseline = await f.create();
  const results = await Promise.allSettled(['First', 'Second'].map(text => f.service.save({ requestId: crypto.randomUUID(), promptId: baseline.id, baseVersion: 1, workflow: 'alternatives', name: 'Baseline', stages: { alternative: text } })));
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  expect((await f.service.read(baseline.id)).versions).toHaveLength(2);
});
it('rejects unknown, foreign-project, and incompatible workflow parents', async () => {
  const f = fixture(), baseline = await f.create();
  for (const parent of [{ promptId: 'missing', version: 1 }, { promptId: baseline.id, version: 99 }, { promptId: 'builtin-roll-up', version: 1 }])
    await expect(f.create('Child', { parent, kind: 'variation' })).rejects.toThrow();
  f.records.set('foreign', { ...baseline, id: 'foreign', projectId: 'other-project' });
  await expect(f.create('Child', { parent: { promptId: 'foreign', version: 1 }, kind: 'variation' })).rejects.toThrow();
});
it('backfills legacy provenance once, verifies text, and prevents cycles even across concurrent requests', async () => {
  const f = fixture(), a = await f.create('A'), b = await f.create('B');
  const track = (child: EvalPrompt, parent: EvalPrompt, expectedContentHash = promptContentHash(child.versions[0].stages)) => f.service.trackLineage(child.id, { requestId: crypto.randomUUID(), version: 1, expectedContentHash, derivation: { parent: { promptId: parent.id, version: 1 }, kind: 'variation' } });
  await expect(track(a, b, '0'.repeat(64))).rejects.toThrow('text');
  const results = await Promise.allSettled([track(a, b), track(b, a)]);
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected']);
  const saved = await f.service.read(a.id);
  expect(saved.versions[0].stages).toEqual(a.versions[0].stages);
  expect(saved.versions[0].lineageRecordedAt).toBeTruthy();
  expect(await track(a, b)).toEqual(saved);
  await expect(track(a, a)).rejects.toThrow('immutable lineage');
});
it('records relaunch parent versions durably and rejects reuse with a different source', async () => {
  const f = fixture(), baseline = await f.create(), other = await f.create('Other');
  const source = await f.service.resolve(baseline.id, 1, 'alternatives'), requestId = crypto.randomUUID(), stages = { alternative: 'Edited' };
  const fork = await f.service.forkForAttempt(requestId, 'alternatives', source, stages);
  expect(fork.versions[0].derivation).toEqual({ parent: { promptId: baseline.id, version: 1 }, kind: 'relaunch' });
  const restarted = new EvalPromptService(f.store, { loadProject: async () => ({ id: 'project' }) });
  expect(await restarted.forkForAttempt(requestId, 'alternatives', source, stages)).toEqual(fork);
  await expect(restarted.forkForAttempt(requestId, 'alternatives', { ...source, promptId: other.id }, stages)).rejects.toThrow('different prompt');
});

it('forks exact content, stays independent, records merge parents and rejects unsupported tags', async () => {
  const f = fixture(), source = await f.create();
  const fork = await f.service.fork(source.id, 1, crypto.randomUUID(), 'Fork');
  expect(fork.versions[0].stages).toEqual(source.versions[0].stages);
  expect(fork.versions[0].parents).toEqual([{ promptId: source.id, version: 1, relation: 'fork' }]);
  await f.service.save({ requestId: crypto.randomUUID(), promptId: source.id, baseVersion: 1, workflow: 'alternatives', name: source.name, stages: { alternative: '<task>Changed</task>' } });
  expect((await f.service.read(fork.id)).versions[0].stages).toEqual(source.versions[0].stages);
  const merged = await f.service.save({ requestId: crypto.randomUUID(), promptId: fork.id, baseVersion: 1, workflow: 'alternatives', name: fork.name, stages: { alternative: '<task>Merged</task>' }, parents: [{ promptId: fork.id, version: 1, relation: 'merge' }, { promptId: source.id, version: 2, relation: 'merge' }] });
  expect(merged.versions[1].parents).toHaveLength(2);
  await expect(f.service.save({ requestId: crypto.randomUUID(), workflow: 'alternatives', name: 'Invalid', stages: { alternative: '<unsupported>Oops</unsupported>' } })).rejects.toThrow('Unsupported tag');
});

it('persists a project snapshot and keeps its exact prompt versions after later edits', async () => {
 const f = fixture(); const snapshots = new Map<string, import('../../../domain/mapping/evals/evalPrompt').PromptProjectSnapshot>();
 const store = { save: async (s: import('../../../domain/mapping/evals/evalPrompt').PromptProjectSnapshot) => { snapshots.set(s.id, structuredClone(s)); }, read: async (id: string) => structuredClone(snapshots.get(id) ?? null), list: async () => structuredClone([...snapshots.values()]) };
 const service = new EvalPromptService(f.store, { loadProject: async () => ({ id: 'project' }) }, undefined, store);
 const source = await f.create(), id = crypto.randomUUID(), snapshot = await service.snapshot(id, 'Before edits');
 await f.service.save({ requestId: crypto.randomUUID(), promptId: source.id, baseVersion: 1, workflow: 'alternatives', name: source.name, stages: { alternative: '<task>New version</task>' } });
 expect(await service.snapshot(id, 'Before edits')).toEqual(snapshot);
 const restarted = new EvalPromptService(f.store, { loadProject: async () => ({ id: 'project' }) }, undefined, store);
 expect((await restarted.listSnapshots())[0].prompts.find(p => p.id === source.id)?.versions).toHaveLength(1);
});
