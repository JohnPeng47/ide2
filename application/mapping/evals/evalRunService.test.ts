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
import { documentRecords, recordDocument, type WorkspaceIndex, workspaceRecords } from '../../../domain/mapping/workspace/workspaceRecords';
import { compareWorkspaceFixture } from '../../../tests/support/compareWorkspace';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
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
  canvases.snapshot = (id, checkpoint) => service.outputSnapshot(id, checkpoint);
  const sources = (await comparisons.candidates()).filter(c => c.viewId).map(({ documentId, viewId, checkpointId }) => ({ documentId, viewId, checkpointId }));
  const strict = await prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Strict', stages: { r2: 'Strict r2 for {{child}} pass {{pass}}', g2: 'Strict g2 into {{parent}}' } });
  const rollUp = (extra = {}) => ({ requestId: crypto.randomUUID(), workflow: 'roll-up', inputs: { child: sources[0], parent: sources[1] }, passes: 2,
    prompts: [{ promptId: 'builtin-roll-up', version: 1 }, { promptId: strict.id, version: 1 }], ...extra });
  return { root, service, prompts, comparisons, catalogs, contexts, runtime, records, sources, strict, rollUp, projects, workspace, canvases };
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
  expect(result.status).toBe('partial');
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

it('retains generated metadata after Open in Mapping and pins previews/comparisons after edits or deletion', async () => {
  const f = await fixture(), started = await f.service.start(f.rollUp({ passes: 1 })); await settle(f, started.id);
  const run = await f.service.read(started.id), cell = run.cells[0], original = await f.service.canvas(cell.canvasId!);
  const base = recordDocument(f.records, f.sources[0].documentId);
  Object.assign(f.records, documentRecords({ ...base, representationId: original.id, name: original.name, type: 'generated',
    history: original.history, document: documentFromHistory(original.history), canvas: initialCanvasState() }));
  (f.records.workspace as WorkspaceIndex).documentIds.push(original.id);
  expect((await f.comparisons.candidates()).find(c => c.documentId === original.id)?.generated).toEqual(original.generated);
  // Opening generated canvases must preserve their ordinary saved-view choices too.
  const opened = recordDocument(f.records, original.id);
  const viewId = 'opened-view';
  opened.history!.canvasViews = { saved: { [viewId]: { id: viewId, name: 'Saved generated view', createdAt: run.createdAt, savedAt: run.createdAt,
    startCheckpointId: original.history.headId, finalCheckpointId: original.history.headId, checkpointIds: [original.history.headId] } } };
  Object.assign(f.records, documentRecords(opened));
  const candidate = (await f.comparisons.candidates()).find(c => c.documentId === original.id && c.viewId === viewId)!;
  expect(candidate.generated).toEqual(original.generated);
  expect((await f.comparisons.capture([candidate])).canvases[0].generated).toEqual(original.generated);
  const controller = new MappingDocumentController(documentFromHistory(original.history), initialCanvasState(), 0, undefined, undefined, original.history);
  controller.applyUpdate(0, [{ method: 'diagram-create', id: 'later', ascii: 'Later edit', position: { column: 150, row: 0 } }]);
  const changed = controller.exportHistory(), document = documentFromHistory(changed);
  await f.catalogs.saveMappingDiagram(run.projectId, { representationId: original.id, expectedRevisionId: (await f.catalogs.loadRepresentationCatalog(run.projectId)).representations[original.id].currentRevisionId, name: original.name, type: 'generated', history: changed,
    scene: document.scene, edges: document.edges, generated: original.generated });
  expect((await f.service.canvas(original.id)).history.headId).not.toBe(cell.checkpointId);
  expect((await f.service.canvas(original.id, cell.checkpointId)).history).toEqual(run.outputSnapshots![original.id].history);
  const source = { documentId: original.id, checkpointId: cell.checkpointId! };
  const session = await f.comparisons.create({ requestId: crypto.randomUUID(), title: 'Pinned', pairs: [{ A: source, B: source }] });
  expect(session.canvases[0].generated?.promptStages).toEqual(run.prompts[0].stages);
  await f.service.deleteCanvas(original.id);
  expect((await f.comparisons.candidates()).some(candidate => candidate.documentId === original.id)).toBe(false);
  expect((await f.comparisons.capture([source])).canvases[0].history.headId).toBe(cell.checkpointId);
  expect((await f.comparisons.read(session.id)).canvases).toEqual(session.canvases);
});

it('reruns durable source copies after a view is saved again or the source is deleted, including reruns of reruns', async () => {
  const f = await fixture(), request = f.rollUp({ passes: 1 });
  const started = await f.service.start(request); await settle(f, started.id);
  const original = await f.service.read(started.id), doc = recordDocument(f.records, f.sources[0].documentId);
  doc.history!.canvasViews!.saved[f.sources[0].viewId!].finalCheckpointId = f.sources[1].checkpointId;
  doc.history!.canvasViews!.saved[f.sources[0].viewId!].checkpointIds.push(f.sources[1].checkpointId);
  Object.assign(f.records, documentRecords(doc));
  await expect(f.comparisons.capture([f.sources[0]])).rejects.toThrow('selected view changed');
  const rerun = await f.service.start({ ...request, requestId: crypto.randomUUID(), parentRunId: original.id }); await settle(f, rerun.id);
  expect((await f.service.read(rerun.id)).inputs).toEqual(original.inputs);
  (f.records.workspace as WorkspaceIndex).documentIds = [];
  const again = await f.service.start({ ...request, requestId: crypto.randomUUID(), parentRunId: rerun.id }); await settle(f, again.id);
  expect((await f.service.read(again.id)).inputs).toEqual(original.inputs);
});

it('pins earlier alternatives across deletion and rejects unrelated workflow/context inputs', async () => {
  const f = await fixture(), ctx = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'One', context: 'Context' });
  const input = { workflow: 'alternatives', inputs: { context: { agentContextId: ctx.agentContextId } }, task: 'Task', passes: 1, prompts: [{ promptId: 'builtin-alternatives', version: 1 }] };
  const first = await f.service.start({ ...input, requestId: crypto.randomUUID() }); await settle(f, first.id);
  const id = (await f.service.read(first.id)).cells[0].canvasId!;
  const follow = await f.service.start({ ...input, requestId: crypto.randomUUID(), previous: [id] }); await settle(f, follow.id);
  const captured = (await f.service.read(follow.id)).previous;
  const other = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'One', context: 'Other context' });
  await expect(f.service.start({ ...input, requestId: crypto.randomUUID(), inputs: { context: { agentContextId: other.agentContextId } }, previous: [id] })).rejects.toThrow('selected AgentContext');
  const roll = await f.service.start(f.rollUp({ passes: 1 })); await settle(f, roll.id);
  await expect(f.service.start({ ...input, requestId: crypto.randomUUID(), previous: [(await f.service.read(roll.id)).cells[0].canvasId] })).rejects.toThrow('Alternatives workflow');
  await f.service.deleteCanvas(id);
  const rerun = await f.service.start({ ...input, requestId: crypto.randomUUID(), previous: [id], parentRunId: follow.id }); await settle(f, rerun.id);
  expect((await f.service.read(rerun.id)).previous).toEqual(captured);
  expect(rerun.previousInputs?.[0].source.documentId).toBe(id);
});

it('imports failed and cancelled legacy views as run cells without selectable parent placeholders', async () => {
  const f = await fixture(), doc = recordDocument(f.records, f.sources[0].documentId);
  const views = Object.values(doc.history!.canvasViews!.saved);
  views[0].generation!.status = 'failed'; views[1].generation!.status = 'cancelled';
  Object.assign(f.records, documentRecords(doc));
  expect(await f.service.migrate()).toEqual({ migrated: 0 });
  expect(await f.service.generated()).toEqual([]);
  const [run] = await f.service.list();
  expect(run.cells.map(cell => cell.status)).toEqual(['failed', 'cancelled']);
  expect(run.cells.map(cell => cell.candidateName)).toEqual(views.map(view => view.name));
  expect(run.prompts).toEqual([]); expect(run.cells.every(cell => !cell.canvasId)).toBe(true);
  expect((await f.comparisons.candidates()).filter(c => c.viewId)).toEqual([]);
  await f.service.migrate(); expect(await f.service.list()).toHaveLength(1);
});

it('keeps run numbers after deletion and exposes roll-up defaults with four outputs for two passes', async () => {
  const f = await fixture(), input = { requestId: crypto.randomUUID(), child: f.sources[0], parent: f.sources[1] };
  const one = await f.service.startRollUp(input); await settle(f, one.id);
  expect(one.request.passes).toBe(1); expect((await f.service.read(one.id)).cells).toHaveLength(2);
  const two = await f.service.startRollUp({ ...input, requestId: crypto.randomUUID(), passes: 2 }); await settle(f, two.id);
  expect((await f.service.read(two.id)).cells.filter(c => c.status === 'finished')).toHaveLength(4);
  await f.service.deleteRun(one.id);
  expect((await f.service.list())[0].number).toBe(two.number);
  const three = await f.service.startRollUp({ ...input, requestId: crypto.randomUUID() }); await settle(f, three.id);
  expect(three.number).toBe(two.number! + 1);
});

it('recovers interrupted historical roll-ups without inventing prompt versions or losing completed cells', async () => {
  const f = await fixture(), started = await f.service.start(f.rollUp({ passes: 1 })); await settle(f, started.id);
  const run = await f.service.read(started.id), legacy = new FileRollUpRunStore(f.root), id = crypto.randomUUID();
  await legacy.save({ id, requestHash: 'original', request: { requestId: id, child: f.sources[0], parent: f.sources[1], passes: 2, model: 'old-model', effort: 'high' },
    projectId: run.projectId, agentContextId: run.agentContextId, contextName: run.contextName, child: run.inputs.child, parent: run.inputs.parent,
    createdAt: run.createdAt, status: 'generating', outputs: [{ pass: 1, stage: 'r2', canvasId: run.cells[0].canvasId!, explanation: 'Finished before restart' }] });
  const restarted = new EvalRunService(f.comparisons, f.workspace, f.projects, f.contexts, f.prompts, f.canvases,
    new JsonDirectoryStore<EvalRun>(f.root, 'eval-runs'), f.runtime, legacy);
  const recovered = await restarted.read(id);
  expect(recovered.status).toBe('partial'); expect(recovered.prompts).toEqual([]); expect(recovered.request.prompts).toEqual([]);
  expect(recovered.cells.map(cell => cell.status)).toEqual(['finished', 'failed', 'failed', 'failed']);
  expect(recovered.cells[1].error).toContain('restarted'); expect(recovered.cells[0].canvasId).toBe(run.cells[0].canvasId);
  expect((await restarted.read(run.id)).number).toBe(run.number);
});

it('does not resurrect archived migration outputs or import their keys a second time', async () => {
  const f = await fixture(); await f.service.migrate();
  const generated = await f.service.generated();
  for (const canvas of generated) await f.service.deleteCanvas(canvas.id);
  // Simulate an existing pre-adapter catalog with no Evals record yet.
  await new JsonDirectoryStore<EvalRun>(f.root, 'eval-runs').delete('legacy-run');
  expect(await f.service.migrate()).toEqual({ migrated: 0 }); expect(await f.service.generated()).toEqual([]);
  const run = (await f.service.list())[0]; expect(run.cells.every(cell => cell.deleted)).toBe(true);
  expect(new Set(run.cells.map(cell => cell.canvasId))).toEqual(new Set(generated.map(canvas => canvas.id)));
});
