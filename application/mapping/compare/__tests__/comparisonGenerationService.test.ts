import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CompareSessionService } from '../compareSessionService';
import { ComparisonGenerationService, type ComparisonRuntime } from '../comparisonGenerationService';
import { FileCompareSessionStore } from '../../../../infrastructure/mapping/compare/fileCompareSessionStore';
import { FileComparisonRunStore } from '../../../../infrastructure/mapping/compare/fileComparisonRunStore';
import { comparisonPrompt, type GeneratedComparisons } from '../../../../domain/mapping/compare/comparisonGeneration';
import { workspaceRecords } from '../../../../domain/mapping/workspace/workspaceRecords';
import { compareWorkspaceFixture } from '../../../../tests/support/compareWorkspace';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'comparison-generation-test-')); roots.push(root);
  let records = workspaceRecords(compareWorkspaceFixture('test-project'));
  const comparisons = new CompareSessionService({ loadRecords: async () => ({ revision: 1, records }) }, new FileCompareSessionStore(root));
  const store = new FileComparisonRunStore(root);
  let resolve!: (value: { output: unknown }) => void, calls = 0;
  let received: Parameters<ComparisonRuntime['generate']>[0] | undefined;
  const runtime: ComparisonRuntime = { generate: input => { received = input; calls++; return new Promise(done => { resolve = done; }); } };
  const service = new ComparisonGenerationService(comparisons, store, runtime);
  const sources = (await comparisons.candidates()).filter(c => c.viewId).map(({ documentId, viewId, checkpointId }) => ({ documentId, viewId, checkpointId }));
  const request = { requestId: crypto.randomUUID(), title: 'ASCII comparisons', sources };
  const finish = async (change?: (output: GeneratedComparisons) => void) => {
    await expect.poll(() => calls).toBe(1);
    const output: GeneratedComparisons = { comparisons: [{ title: 'Shared concept', explanation: 'Common concepts arranged differently.',
      A: { diagram: 'D1', ranges: [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }] },
      B: { diagram: 'D4', ranges: [{ startLine: 2, endLine: 3 }] } }] };
    change?.(output); resolve({ output });
    await expect.poll(async () => (await service.read(request.requestId)).status).not.toBe('generating');
    return service.read(request.requestId);
  };
  return { service, store, comparisons, request, finish, runtime, get calls() { return calls; }, get received() { return received; },
    deleteSources: () => { records = workspaceRecords({ schemaVersion: 3, projectId: 'test-project', documents: [] }); } };
}

it('pins inputs, deduplicates concurrent/retried starts and publishes disconnected slices after source deletion', async () => {
  const f = await fixture();
  const results = await Promise.all([f.service.start(f.request), f.service.start(f.request)]);
  expect(results[0].id).toBe(results[1].id);
  await expect.poll(() => f.calls).toBe(1);
  expect(f.received).toMatchObject({ model: 'gpt-6-sol', effort: 'high' });
  const prompt = comparisonPrompt(f.received!.diagrams);
  expect(prompt).toContain('[ASCII](./D1.txt)');
  expect(prompt).not.toContain('First implementation');
  expect(prompt).not.toContain('sourceMappings');
  f.deleteSources();
  const run = await f.finish(); expect(run.status).toBe('finished');
  const session = await f.comparisons.read(run.sessionId!);
  expect(session.compares[0].A).toMatchObject({ kind: 'diagram', ranges: [{ startLine: 1, endLine: 1 }, { startLine: 3, endLine: 3 }] });
  expect(session.compares[0].explanation).toBe('Common concepts arranged differently.');
  expect((await f.service.start(f.request)).sessionId).toBe(session.id); expect(f.calls).toBe(1);
  await expect(f.service.start({ ...f.request, title: 'Different' })).rejects.toThrow('Request ID already used');
  const restarted = new ComparisonGenerationService(f.comparisons, f.store, f.runtime);
  expect((await restarted.read(run.id)).status).toBe('finished');
});

it.each(['bounds', 'overlap', 'unknown', 'same-view', 'missing-view'] as const)('rejects invalid generated references: %s', async kind => {
  const f = await fixture(); await f.service.start(f.request);
  const run = await f.finish(output => {
    const pair = output.comparisons[0];
    if (kind === 'bounds') pair.A.ranges = [{ startLine: 1, endLine: 999 }];
    if (kind === 'overlap') pair.A.ranges = [{ startLine: 1, endLine: 3 }, { startLine: 2, endLine: 3 }];
    if (kind === 'unknown') pair.A.diagram = 'D99';
    if (kind === 'same-view' || kind === 'missing-view') pair.B.diagram = 'D2';
  });
  expect(run.status).toBe('failed'); expect(run.error).toBeTruthy(); expect(await f.comparisons.list()).toEqual([]);
});

it('marks interrupted runs failed on restart and retains their input snapshots', async () => {
  const f = await fixture(); await f.service.start(f.request); await expect.poll(() => f.calls).toBe(1);
  const restarted = new ComparisonGenerationService(f.comparisons, f.store, f.runtime);
  const run = await restarted.read(f.request.requestId);
  expect(run.status).toBe('failed'); expect(run.error).toContain('restarted'); expect(run.diagrams).toHaveLength(6);
  f.service.dispose();
});
