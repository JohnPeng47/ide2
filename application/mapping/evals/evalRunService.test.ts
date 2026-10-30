import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EvalRunService } from './evalRunService';
import { EvalPromptService } from './evalPromptService';
import { GeneratedCanvasCatalog } from './generatedCanvasCatalog';
import { CompareSessionService } from '../compare/compareSessionService';
import { AgentContextLibrary } from '../agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { CanvasCatalogStore } from '../../../infrastructure/core/persistence/canvasCatalogStore';
import { FileCompareSessionStore } from '../../../infrastructure/mapping/compare/fileCompareSessionStore';
import { FileRollUpRunStore } from '../../../infrastructure/mapping/rollup/fileRollUpRunStore';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FakeEvalRuntime } from '../../../infrastructure/mapping/evals/evalRuntime';
import { workspaceRecords } from '../../../domain/mapping/workspace/workspaceRecords';
import { compareWorkspaceFixture } from '../../../tests/support/compareWorkspace';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import type { EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import type { EvalRun } from '../../../domain/mapping/evals/evalRun';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eval-run-test-')); roots.push(root);
  const state = compareWorkspaceFixture('test-project');
  for (const view of Object.values(state.documents[0].history!.canvasViews!.saved)) {
    view.alternativeGroupId = 'legacy-group';
    view.generation = { runId: 'legacy-run', chatId: 'child-chat', parentChatId: 'parent-chat', triggerPrompt: 'Original trigger', prompt: 'Original prompt', model: 'test', effort: 'high', status: 'finished', startedAt: new Date().toISOString() };
  }
  const records = workspaceRecords(state), workspace = { loadRecords: async () => ({ revision: 1, records }) };
  const catalogs = new CanvasCatalogStore(root), contexts = new AgentContextLibrary(new FileAgentContextRepository(root));
  const projects = { loadProject: async () => ({ id: 'test-project', repositories: [] }), projectCatalogs: catalogs } as unknown as ConstructorParameters<typeof EvalRunService>[2];
  const canvases = new GeneratedCanvasCatalog(projects);
  const comparisons = new CompareSessionService(workspace, new FileCompareSessionStore(root), canvases);
  const prompts = new EvalPromptService(new JsonDirectoryStore<EvalPrompt>(root, 'eval-prompts'), projects);
  const runtime = new FakeEvalRuntime();
  const service = new EvalRunService(comparisons, workspace, projects, contexts, prompts, canvases, new JsonDirectoryStore<EvalRun>(root, 'eval-runs'), runtime, new FileRollUpRunStore(root));
  const sources = (await comparisons.candidates()).filter(c => c.viewId).map(({ documentId, viewId, checkpointId }) => ({ documentId, viewId, checkpointId }));
  const strict = await prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Strict', stages: { r2: 'Strict r2 for {{child}} pass {{pass}}', g2: 'Strict g2 into {{parent}}' } });
  const rollUp = (extra = {}) => ({ requestId: crypto.randomUUID(), workflow: 'roll-up', inputs: { child: sources[0], parent: sources[1] }, passes: 2,
    prompts: [{ promptId: 'builtin-roll-up', version: 1 }, { promptId: strict.id, version: 1 }], ...extra });
  return { root, service, prompts, comparisons, catalogs, contexts, runtime, records, sources, strict, rollUp };
}
const settle = (f: Awaited<ReturnType<typeof fixture>>, id: string) => expect.poll(async () => (await f.service.read(id)).status, { timeout: 10000 }).not.toMatch(/queued|generating/);

it('migrates alternatives once under a shared AgentContext and retains original views, diagrams and provenance', async () => {
  const f = await fixture(), before = JSON.stringify(f.records);
  expect(await f.service.migrate()).toEqual({ migrated: 2 });
  expect(await f.service.migrate()).toEqual({ migrated: 0 });
  expect(JSON.stringify(f.records)).toBe(before);
  const generated = await f.service.generated(); expect(generated).toHaveLength(2);
  expect(new Set(generated.map(c => c.generated!.agentContextId)).size).toBe(1);
  expect(generated[0].generated!.generation!.prompt).toBe('Original prompt');
  expect(generated[0].generated!.prompt).toBeUndefined();
  const context = await f.contexts.read(generated[0].generated!.agentContextId);
  expect(JSON.stringify(context.snapshot)).toContain('Original trigger');
});

it('runs every prompt × pass, pins prompt text, deduplicates requests and records provenance', async () => {
  const f = await fixture(), request = f.rollUp(), before = JSON.stringify(f.records);
  const [a, b] = await Promise.all([f.service.start(request), f.service.start(request)]); expect(a.id).toBe(b.id);
  await settle(f, a.id);
  const run = await f.service.read(a.id);
  expect(run.status).toBe('finished');
  expect(run.cells.map(c => `${c.promptName}:${c.pass}:${c.stage}:${c.status}`)).toEqual([
    'Default roll-up:1:r2:finished', 'Default roll-up:1:g2:finished', 'Default roll-up:2:r2:finished', 'Default roll-up:2:g2:finished',
    'Strict:1:r2:finished', 'Strict:1:g2:finished', 'Strict:2:r2:finished', 'Strict:2:g2:finished']);
  expect(JSON.stringify(f.records)).toBe(before);
  await expect(f.service.start({ ...request, passes: 1 })).rejects.toThrow('Request ID already used');
  // Later edits create v2 and leave the run's pinned v1 text intact.
  await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', promptId: f.strict.id, baseVersion: 1, name: 'Strict', stages: { r2: 'Changed {{child}}', g2: 'Changed' } });
  expect((await f.service.read(a.id)).prompts[1].stages.r2).toBe('Strict r2 for {{child}} pass {{pass}}');
  const generated = await f.service.generated(); expect(generated).toHaveLength(8);
  expect(generated.filter(c => c.generated!.prompt?.id === f.strict.id)).toHaveLength(4);
  const catalog = await f.catalogs.loadRepresentationCatalog('test-project');
  for (const canvas of generated.filter(c => c.generated!.stage === 'g2')) {
    const history = catalog.revisions[canvas.currentRevisionId].content!.history;
    expect(history.canvasViews!.saved[canvas.generated!.storageViewId!].forkCheckpointId).toBe(request.inputs.parent.checkpointId);
    expect(documentFromHistory(history).edges).toHaveLength(1);
  }
});

it('renders templates into the locked prompt and isolates failing cells', async () => {
  const f = await fixture(), original = f.runtime.generate.bind(f.runtime), prompts: string[] = []; let attempts = 0;
  f.runtime.generate = async input => {
    prompts.push(input.prompt);
    if (input.stage === 'g2' && input.prompt.includes('Strict')) { attempts++; return { output: {} as never }; }
    return original(input);
  };
  const run = await f.service.start(f.rollUp({ passes: 1 }));
  await settle(f, run.id);
  const result = await f.service.read(run.id);
  expect(result.cells.map(c => c.status)).toEqual(['finished', 'finished', 'finished', 'failed']);
  expect(result.status).toBe('finished');
  expect(attempts).toBe(3);
  const strict = prompts.find(text => text.includes('Strict r2'))!;
  expect(strict).toContain('Strict r2 for "First view" pass 1');
  expect(strict).toMatch(/^<child canvas>/);
  expect(strict).toContain('<output format>');
});

it('generates alternatives from an AgentContext under that context and compares them with provenance', async () => {
  const f = await fixture();
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'Auth flow notes', context: 'Login calls the session service, which issues tokens.' });
  const request = { requestId: crypto.randomUUID(), workflow: 'alternatives', inputs: { context: { agentContextId: context.agentContextId } }, passes: 2, prompts: [{ promptId: 'builtin-alternatives', version: 1 }] };
  await expect(f.service.start(request)).rejects.toThrow('uses {{task}}');
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID(), inputs: { context: f.sources[0] }, task: 'x' })).rejects.toThrow('Choose an AgentContext');
  const run = await f.service.start({ ...request, requestId: crypto.randomUUID(), task: 'Group by layer' });
  expect(run.agentContextId).toBe(context.agentContextId);
  expect(run.contexts).toEqual({ context: { agentContextId: context.agentContextId, name: 'Auth flow notes', contentHash: context.contentHash } });
  await settle(f, run.id);
  const result = await f.service.read(run.id);
  expect(result.cells.map(c => c.status)).toEqual(['finished', 'finished']);
  const canvas = await f.service.canvas(result.cells[0].canvasId!);
  expect(Object.keys(documentFromHistory(canvas.history).scene.contents)).toEqual(expect.arrayContaining(['alt-detail', 'alt-overview']));
  expect(documentFromHistory(canvas.history).edges).toHaveLength(1);
  expect(canvas.generated).toMatchObject({ agentContextId: context.agentContextId, contextName: 'Auth flow notes', stage: 'alternative',
    prompt: { id: 'builtin-alternatives', version: 1, name: 'Default alternative' } });
  // Earlier alternatives become previous-N.json files and fill {{previous}}.
  const original = f.runtime.generate.bind(f.runtime), seen: Parameters<typeof original>[0][] = [];
  f.runtime.generate = async input => { seen.push(input); return original(input); };
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID(), task: 't', previous: [result.cells[0].canvasId!], workflow: 'roll-up', prompts: [{ promptId: 'builtin-roll-up', version: 1 }], inputs: { child: f.sources[0], parent: f.sources[1] } }))
    .rejects.toThrow('Only Alternatives runs');
  const followUp = await f.service.start({ ...request, requestId: crypto.randomUUID(), task: 'Refine', passes: 1, previous: [result.cells[0].canvasId!] });
  expect(followUp.previousNames).toEqual(['Default alternative v1 · pass 1']);
  await settle(f, followUp.id);
  expect(Object.keys(seen[0].files)).toEqual(['context.json', 'previous-1.json']);
  expect(seen[0].prompt).toContain('Earlier alternatives to improve on or differ from: previous-1.json ("Default alternative v1 · pass 1")');
  f.runtime.generate = original;
  const generated = (await f.comparisons.candidates()).filter(c => c.generated && c.generated.runId === run.id);
  expect(generated).toHaveLength(2);
  const pair = generated.map(({ documentId, checkpointId }) => ({ documentId, checkpointId }));
  const session = await f.comparisons.create({ requestId: crypto.randomUUID(), title: 'Generated', pairs: [{ A: pair[0], B: pair[1] }] });
  expect(session.canvases.map(copy => copy.generated?.prompt?.name)).toEqual(['Default alternative', 'Default alternative']);
});

it('adds a valid built-in version when a workflow input is renamed', async () => {
  const f = await fixture(), store = new JsonDirectoryStore<EvalPrompt>(f.root, 'eval-prompts');
  await f.prompts.list();
  const builtin = (await store.read('builtin-alternatives'))!;
  await store.save({ ...builtin, versions: [{ ...builtin.versions[0], stages: { alternative: 'Old {{source}} prompt' } }] });
  const prompts = new EvalPromptService(store, { loadProject: async () => ({ id: 'test-project' }) });
  const migrated = await prompts.read('builtin-alternatives');
  expect(migrated.versions.map(v => v.version)).toEqual([1, 2]);
  expect(migrated.versions[1].stages.alternative).toContain('{{context}}');
  expect((await prompts.read('builtin-alternatives')).versions).toHaveLength(2);
});

it('seeds built-in prompts and versions edits with conflict detection and template validation', async () => {
  const f = await fixture();
  const list = await f.prompts.list();
  expect(list.filter(p => p.builtin).map(p => p.workflow).sort()).toEqual(['alternatives', 'roll-up']);
  await expect(f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Bad', stages: { r2: '{{nope}}', g2: 'ok' } })).rejects.toThrow('Fix the prompt errors');
  const saved = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', promptId: f.strict.id, baseVersion: 1, name: 'Strict 2', stages: { r2: 'New {{pass}}', g2: 'New' } });
  expect(saved.versions.map(v => v.version)).toEqual([1, 2]);
  await expect(f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', promptId: f.strict.id, baseVersion: 1, name: 'Stale', stages: { r2: 'x', g2: 'y' } })).rejects.toThrow('saved as v2');
});

it('deletes outputs, runs and all of a context’s outputs for one workflow', async () => {
  const f = await fixture();
  const run = await f.service.start(f.rollUp({ passes: 1 }));
  await settle(f, run.id);
  const cells = (await f.service.read(run.id)).cells;
  await f.service.deleteCanvas(cells[0].canvasId!);
  expect((await f.service.list()).find(item => item.id === run.id)!.cells.map(cell => !!cell.deleted)).toEqual([true, false, false, false]);
  await f.service.deleteRun(run.id);
  await expect(f.service.read(run.id)).rejects.toThrow('Run not found');
  expect(await f.service.generated()).toHaveLength(0);

  const again = await f.service.start(f.rollUp({ passes: 1 }));
  await settle(f, again.id);
  const pair = (await f.service.read(again.id)).cells.slice(1, 3).map(cell => ({ documentId: cell.canvasId!, checkpointId: cell.checkpointId! }));
  const session = await f.comparisons.create({ requestId: crypto.randomUUID(), title: 'Pair', pairs: [{ A: pair[0], B: pair[1] }] });
  expect((await f.comparisons.list()).find(item => item.id === session.id)!.origins.map(origin => origin.workflow)).toEqual(['roll-up', 'roll-up']);
  await f.service.deleteContextOutputs(again.agentContextId, 'alternatives');
  expect(await f.service.generated()).toHaveLength(4);
  await f.service.deleteContextOutputs(again.agentContextId, 'roll-up');
  expect(await f.service.generated()).toHaveLength(0);
  expect((await f.service.list()).some(item => item.id === again.id)).toBe(false);
  expect((await f.comparisons.list()).some(item => item.id === session.id)).toBe(false);
});

it('files reruns under the original run and its context, and deletes them with it', async () => {
  const f = await fixture();
  const run = await f.service.start(f.rollUp({ passes: 1 }));
  await settle(f, run.id);
  const rerun = await f.service.start(f.rollUp({ passes: 1, prompts: [{ promptId: f.strict.id, version: 1 }], parentRunId: run.id }));
  expect(rerun).toMatchObject({ parentRunId: run.id, agentContextId: run.agentContextId, contextName: run.contextName });
  await settle(f, rerun.id);
  // A rerun of a rerun is filed under the original.
  const again = await f.service.start(f.rollUp({ passes: 1, parentRunId: rerun.id }));
  expect(again.parentRunId).toBe(run.id);
  await settle(f, again.id);
  await expect(f.service.start(f.rollUp({ parentRunId: run.id, workflow: 'alternatives' }))).rejects.toThrow();
  expect((await f.service.rename(rerun.id, 'Strict only')).name).toBe('Strict only');
  expect((await f.service.rename(rerun.id, '')).name).toBeUndefined();
  await f.service.deleteRun(run.id);
  expect(await f.service.list()).toHaveLength(0);
  expect(await f.service.generated()).toHaveLength(0);
});
