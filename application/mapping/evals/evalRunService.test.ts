import { renderTemplate } from '../../../domain/mapping/evals/promptTemplate';
import { JudgementService } from './judgementService';
import type { Judgement } from '../../../domain/mapping/evals/judgement';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { EvalRunService } from './evalRunService';
import { EvalPromptService } from './evalPromptService';
import { EvalReferenceService } from './evalReferenceService';
import type { EvalReference, EvalReferenceGroup } from '../../../domain/mapping/evals/evalReference';
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
import { getDiagramRevision } from '../../../domain/core/diagrams/diagramRevisionStore';
import type { EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import type { EvalRun } from '../../../domain/mapping/evals/evalRun';
import { LayoutTemplateService, type LayoutTemplateStore } from './layoutTemplateService';

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
  const references = new EvalReferenceService(new JsonDirectoryStore<EvalReference>(root, 'eval-references'), projects, new JsonDirectoryStore<EvalReferenceGroup>(root, 'eval-reference-groups'));
  const prompts = new EvalPromptService(new JsonDirectoryStore<EvalPrompt>(root, 'eval-prompts'), projects, references);
  const runtime = new FakeEvalRuntime();
  const service = new EvalRunService(comparisons, workspace, projects, contexts, prompts, canvases, new JsonDirectoryStore<EvalRun>(root, 'eval-runs'), runtime, new FileRollUpRunStore(root));
  const layouts = new LayoutTemplateService(new JsonDirectoryStore<Awaited<ReturnType<LayoutTemplateStore['list']>>[number]>(root, 'layout-templates'), comparisons, projects);
  service.layoutTemplates = layouts;
  canvases.snapshot = (id, checkpoint) => service.outputSnapshot(id, checkpoint);
  const sources = (await comparisons.candidates()).filter(c => c.viewId).map(({ documentId, viewId, checkpointId }) => ({ documentId, viewId, checkpointId }));
  const strict = await prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Strict', stages: { r2: 'Strict r2 for {{child}} pass {{pass}}', g2: 'Strict g2 into {{parent}}' } });
  const rollUp = (extra = {}) => ({ requestId: crypto.randomUUID(), workflow: 'roll-up', inputs: { child: sources[0], parent: sources[1] }, passes: 2,
    prompts: [{ promptId: 'builtin-roll-up', version: 1 }, { promptId: strict.id, version: 1 }], ...extra });
  return { root, service, prompts, references, comparisons, catalogs, contexts, runtime, records, sources, strict, rollUp, projects, workspace, canvases, layouts };
}
const settle = (f: Awaited<ReturnType<typeof fixture>>, id: string) => expect.poll(async () => (await f.service.read(id)).status, { timeout: 10000 }).not.toMatch(/queued|generating/);

it('pins template geometry and descriptions across source deletion, template edits/deletion, restart and reruns', async () => {
  const f = await fixture(), before = JSON.stringify(f.records);
  const sourceRun = await f.service.start(f.rollUp({ passes: 1, prompts: [{ promptId: 'builtin-roll-up', version: 1 }] }));
  await settle(f, sourceRun.id);
  const sourceCell = (await f.service.read(sourceRun.id)).cells[1];
  const capture = await f.layouts.capture({ documentId: sourceCell.canvasId!, checkpointId: sourceCell.checkpointId! });
  capture.geometry.slots[0].description = 'System overview\nShow the main components.';
  const save = { requestId: crypto.randomUUID(), name: 'Private source layout name', capture };
  // The save persists the preview geometry, even if its source no longer exists.
  await f.service.deleteCanvas(sourceCell.canvasId!);
  const [template, retry] = await Promise.all([f.layouts.save(save), f.layouts.save(save)]);
  expect(retry).toEqual(template);
  await expect(f.layouts.save({ ...save, name: 'Different' })).rejects.toThrow('Request ID');
  expect(template.geometry.slots.length).toBeGreaterThan(1);
  await expect(f.service.start(f.rollUp({ layoutTemplateId: template.id }))).rejects.toThrow('does not support layout templates');
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'New content', context: 'Fresh context for a brand new diagram.' });
  const original = f.runtime.generate.bind(f.runtime), seen: Parameters<typeof original>[0][] = [];
  let bad = true;
  f.runtime.generate = async input => {
    seen.push(input);
    if (bad) { bad = false; return { output: { format: 'template-slots-v1', explanation: 'Missing slots', diagrams: [] } as never }; }
    return original(input);
  };
  const request = { requestId: crypto.randomUUID(), workflow: 'alternatives', passes: 2,
    inputs: { context: { agentContextId: context.agentContextId } }, prompts: [{ promptId: 'builtin-template-alternatives', version: 1 }], layoutTemplateId: template.id };
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID(), prompts: [{ promptId: 'builtin-alternatives', version: 1 }] })).rejects.toThrow('template prompt');
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID(), layoutTemplateId: undefined })).rejects.toThrow('requires a layout template');
  expect(seen).toHaveLength(0);
  const run = await f.service.start(request);
  await settle(f, run.id);
  const result = await f.service.read(run.id);
  expect(result.status).toBe('finished');
  expect(result.cells).toHaveLength(2);
  expect(result.layoutTemplate).toEqual(template);
  expect(seen.some(input => 'validation-error.json' in input.files)).toBe(true);
  for (const input of seen) {
    expect(input.files['layout-template.json']).toEqual(template.geometry);
    expect(JSON.stringify(input.files['layout-template.json'])).not.toContain(template.name);
    expect(input.prompt).toContain('template-slots-v1');
    expect(input.prompt).toBe(renderTemplate(result.prompts[0].stages.alternative, { context: JSON.stringify(context.name), pass: input.prompt.includes('pass 2 of 2') ? '2' : '1', passes: '2' }));
    expect(input.prompt).not.toContain('position:{column,row}');
  }
  const identities: string[] = [];
  for (const cell of result.cells) {
    const output = await f.service.canvas(cell.canvasId!), doc = documentFromHistory(output.history);
    expect(output.generated).toMatchObject({ layoutTemplate: template, layoutPlacements: cell.layoutPlacements });
    expect(cell.layoutPlacements).toHaveLength(template.geometry.slots.length);
    expect(doc.edges).toEqual([]);
    for (const diagram of Object.values(doc.scene.contents)) {
      identities.push(diagram.diagramId, diagram.revisionId, ...Object.values(getDiagramRevision(diagram.revisionId).nodeRefs));
      expect(diagram.content.ascii).toContain('Fresh diagram');
      expect(diagram.sourceContext.mappings).toEqual([]);
    }
  }
  expect(new Set(identities).size).toBe(identities.length);
  await f.layouts.rename(template.id, 'Renamed layout');
  await f.layouts.update(template.id, { descriptions: { 'slot-1': 'Updated overview' } });
  expect((await f.layouts.read(template.id)).geometry.slots[0].description).toBe('Updated overview');
  expect((await f.service.read(run.id)).layoutTemplate!.geometry).toEqual(template.geometry);
  expect((await f.service.read(run.id)).layoutTemplate!.name).toBe(template.name);
  await f.layouts.delete(template.id);
  expect(await f.layouts.list()).toEqual([]);
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID() })).rejects.toThrow('not found');
  // A fresh service must recover the durable pin, without consulting the deleted library entry.
  f.service = new EvalRunService(f.comparisons, f.workspace, f.projects, f.contexts, f.prompts, f.canvases,
    new JsonDirectoryStore<EvalRun>(f.root, 'eval-runs'), f.runtime, new FileRollUpRunStore(f.root));
  f.service.layoutTemplates = f.layouts;
  const rerun = await f.service.start({ ...request, requestId: crypto.randomUUID(), parentRunId: run.id });
  await settle(f, rerun.id);
  expect((await f.service.read(rerun.id)).status).toBe('finished');
  expect((await f.service.read(rerun.id)).layoutTemplate).toEqual(template);
  expect(JSON.stringify(f.records)).toBe(before);
});

it('updates and clears individual slot descriptions without changing geometry or other slots', async () => {
  const f = await fixture(), capture = await f.layouts.capture(f.sources[0]);
  const template = await f.layouts.save({ requestId: crypto.randomUUID(), name: 'Descriptions', capture });
  const id = template.geometry.slots[0].id;
  await f.layouts.update(template.id, { descriptions: { [id]: '  Overview\nMain components  ' } });
  expect((await f.layouts.list())[0].geometry.slots[0].description).toBe('Overview\nMain components');
  await expect(f.layouts.update(template.id, { descriptions: { [id]: 'Changed', 'slot-999': 'Unknown' } })).rejects.toThrow('Unknown layout slot');
  expect((await f.layouts.read(template.id)).geometry.slots[0].description).toBe('Overview\nMain components');
  expect(() => f.layouts.update(template.id, { descriptions: { [id]: 'x'.repeat(2001) } })).toThrow();
  await f.layouts.update(template.id, { descriptions: { [id]: '  ' } });
  expect((await f.layouts.read(template.id)).geometry).toEqual(template.geometry);
});

it('cancels template generations through the existing run lifecycle without creating placeholder outputs', async () => {
  const f = await fixture();
  const capture = await f.layouts.capture(f.sources[0]);
  const template = await f.layouts.save({ requestId: crypto.randomUUID(), name: 'Cancelable layout', capture });
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'Context', context: 'Task context' });
  let started = false;
  f.runtime.generate = async input => {
    started = true;
    await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }));
    throw Error('Unreachable');
  };
  const run = await f.service.start({ requestId: crypto.randomUUID(), workflow: 'alternatives', passes: 1,
    inputs: { context: { agentContextId: context.agentContextId } }, prompts: [{ promptId: 'builtin-template-alternatives', version: 1 }], layoutTemplateId: template.id });
  await expect.poll(() => started).toBe(true);
  await f.service.cancel(run.id); await settle(f, run.id);
  expect((await f.service.read(run.id)).status).toBe('cancelled');
  expect(await f.service.generated()).toEqual([]);
});

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

it('renders only the saved prompt and isolates failing cells', async () => {
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
  expect(strict).toBe('Strict r2 for \"First view\" pass 1');
});

it('generates alternatives from an AgentContext under that context and compares them with provenance', async () => {
  const f = await fixture();
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'Auth flow notes', context: 'Login calls the session service, which issues tokens.' });
  const request = { requestId: crypto.randomUUID(), workflow: 'alternatives', inputs: { context: { agentContextId: context.agentContextId } }, passes: 2, prompts: [{ promptId: 'builtin-alternatives', version: 1 }] };
  await expect(f.service.start({ ...request, task: 'Hidden task' })).rejects.toThrow('task');
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID(), inputs: { context: f.sources[0] } })).rejects.toThrow('Choose an AgentContext');
  const run = await f.service.start({ ...request, requestId: crypto.randomUUID() });
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
  await expect(f.service.start({ ...request, requestId: crypto.randomUUID(), previous: [result.cells[0].canvasId!], workflow: 'roll-up', prompts: [{ promptId: 'builtin-roll-up', version: 1 }], inputs: { child: f.sources[0], parent: f.sources[1] } }))
    .rejects.toThrow('Only Alternatives runs');
  const followUp = await f.service.start({ ...request, requestId: crypto.randomUUID(), passes: 1, previous: [result.cells[0].canvasId!] });
  expect(followUp.previousNames).toEqual(['Default alternative v1 · sample 1']);
  await settle(f, followUp.id);
  expect(Object.keys(seen[0].files)).toEqual(['context.json', 'previous-1.json']);
  expect(seen[0].prompt).toContain('Earlier alternatives to improve on or differ from: previous-1.json ("Default alternative v1 · sample 1")');
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
  expect(list.filter(p => p.builtin).map(p => p.workflow).sort()).toEqual(['alternatives', 'alternatives', 'few-shot-refinement', 'roll-up']);
  await expect(f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Bad', stages: { r2: '{{nope}}', g2: 'ok' } })).rejects.toThrow('Fix the prompt errors');
  const saved = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', promptId: f.strict.id, baseVersion: 1, name: 'Strict 2', stages: { r2: 'New {{pass}}', g2: 'New' } });
  expect(saved.versions.map(v => v.version)).toEqual([1, 2]);
  await expect(f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', promptId: f.strict.id, baseVersion: 1, name: 'Stale', stages: { r2: 'x', g2: 'y' } })).rejects.toThrow('saved as v2');
});

it('deletes an exact group of runs without cascading to reruns in other groups, and supports retry', async () => {
  const f = await fixture();
  const original = await f.service.start(f.rollUp({ passes: 1 }));
  await settle(f, original.id);
  const rerun = await f.service.start(f.rollUp({ passes: 1, parentRunId: original.id }));
  await settle(f, rerun.id);
  const keptOutputs = (await f.service.read(rerun.id)).cells.map(cell => cell.canvasId).sort();
  await f.service.deleteRuns([original.id, original.id]);
  await f.service.deleteRuns([original.id]);
  expect((await f.service.list()).map(run => run.id)).toEqual([rerun.id]);
  expect((await f.service.generated()).map(canvas => canvas.id).sort()).toEqual(keptOutputs);
  // A retained rerun remains independently deletable after its original is gone.
  await f.service.deleteContextOutputs(rerun.agentContextId, rerun.workflow);
  expect(await f.service.list()).toEqual([]);
  expect(await f.service.generated()).toEqual([]);
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
  const input = { workflow: 'alternatives', inputs: { context: { agentContextId: ctx.agentContextId } }, passes: 1, prompts: [{ promptId: 'builtin-alternatives', version: 1 }] };
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

it('cites saved references in prompts and freezes their text into runs', async () => {
  const f = await fixture();
  const requestId = crypto.randomUUID(), body = { requestId, name: 'Session store', ascii: '+-- store\n|   `-- tokens', source: f.sources[0], sourceName: 'View', canvasName: 'Canvas' };
  const reference = await f.references.create(body);
  expect(reference.id).toBe('session-store');
  expect((await f.references.create(body)).id).toBe('session-store');
  expect((await f.references.create({ ...body, requestId: crypto.randomUUID() })).id).toBe('session-store-2');
  await expect(f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Bad', stages: { r2: 'See {{ref:nope}}', g2: 'ok' } })).rejects.toThrow('Fix the prompt errors');
  const prompt = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Cites', stages: { r2: 'Match this shape:\n{{ref:session-store}}', g2: 'ok' } });
  // Renaming or archiving keeps the token and its text resolvable.
  await f.references.update('session-store', { name: 'Renamed', archived: true });
  expect((await f.references.list()).map(item => item.id)).toEqual(['session-store-2']);
  const original = f.runtime.generate.bind(f.runtime), seen: string[] = [];
  f.runtime.generate = async input => { seen.push(input.prompt); return original(input); };
  const run = await f.service.start(f.rollUp({ passes: 1, prompts: [{ promptId: prompt.id, version: 1 }] }));
  expect(run.prompts[0].references).toEqual({ 'session-store': { name: 'Renamed', ascii: '+-- store\n|   `-- tokens' } });
  await settle(f, run.id);
  expect(seen[0]).toContain('Match this shape:\n```text\n+-- store\n|   `-- tokens\n```');
});

it('imports a reference comment into the prompt and pins it, so later edits reach only later runs', async () => {
  const f = await fixture();
  const reference = await f.references.create({ requestId: crypto.randomUUID(), name: 'Noted', ascii: 'Root\n`-- leaf', comment: 'Keep this nesting.', source: f.sources[0], sourceName: 'View', canvasName: 'Canvas' });
  const prompt = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Cites', stages: { r2: `Match:\n{{ref:${reference.id}}}`, g2: 'ok' } });
  const original = f.runtime.generate.bind(f.runtime), seen: string[] = [];
  f.runtime.generate = async input => { seen.push(input.prompt); return original(input); };
  const first = await f.service.start(f.rollUp({ passes: 1, prompts: [{ promptId: prompt.id, version: 1 }] }));
  await f.references.update(reference.id, { comment: 'Changed after the run started.' });
  await settle(f, first.id);
  expect(first.prompts[0].references?.[reference.id].comment).toBe('Keep this nesting.');
  expect(seen[0]).toContain('Match:\n```text\nRoot\n`-- leaf\n```\nKeep this nesting.');
  const second = await f.service.start(f.rollUp({ passes: 1, prompts: [{ promptId: prompt.id, version: 1 }] }));
  expect(second.prompts[0].references?.[reference.id].comment).toBe('Changed after the run started.');
  await settle(f, second.id);
});


it('skips checkpoint hydration when view headers show that migration is already complete', async () => {
  const f = await fixture();
  await f.service.migrate();
  const index = f.records.workspace as WorkspaceIndex;
  Object.assign(f.workspace, { loadViewHeaders: async () => index.documentIds.map(documentId => {
    const prefix = `document/${encodeURIComponent(documentId)}/`;
    const header = f.records[prefix + 'history'] as import('../../../domain/core/diagrams/canvasHistory').CanvasHistoryRecord;
    return { documentId, canvasViews: header.canvasViews };
  }) });
  const read = vi.spyOn(f.workspace, 'loadRecords').mockRejectedValue(Error('Must not hydrate checkpoints'));
  try { expect(await f.service.migrate()).toEqual({ migrated: 0 }); expect(read).not.toHaveBeenCalled(); }
  finally { read.mockRestore(); }
});

it('deletes an output through metadata without reading its canvas history or rewriting immutable records', async () => {
  const f = await fixture(); await f.service.migrate();
  const canvas = (await f.service.generated())[0];
  const { readFile } = await import('node:fs/promises');
  const file = join(f.root, 'canvases/catalog.json');
  const before = JSON.parse(await readFile(file, 'utf8'));
  const read = vi.spyOn(f.canvases, 'read').mockRejectedValue(Error('Must not load output history'));
  const { DiagramPersistence } = await import('../../../domain/core/diagrams/diagramPersistence');
  const restore = vi.spyOn(DiagramPersistence.prototype, 'restore');
  const persist = vi.spyOn(DiagramPersistence.prototype, 'persist');
  try {
    await f.service.deleteCanvas(canvas.id);
    expect(read).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
    const after = JSON.parse(await readFile(file, 'utf8'));
    expect(after.revisions).toEqual(before.revisions);
    expect(after.representations[canvas.id].status).toBe('archived');
  } finally { read.mockRestore(); restore.mockRestore(); persist.mockRestore(); }
});


it('lists comparison metadata without hydrating the Mapping workspace', async () => {
  const f = await fixture();
  const service = new CompareSessionService(f.workspace, new FileCompareSessionStore(f.root), f.canvases, f.projects);
  const read = vi.spyOn(f.workspace, 'loadRecords').mockRejectedValue(Error('Must not load workspace histories'));
  try { expect(await service.list()).toEqual([]); expect(read).not.toHaveBeenCalled(); }
  finally { read.mockRestore(); }
});

async function refinementFixture() {
  const f = await fixture();
  const judgements = new JudgementService(new JsonDirectoryStore<Judgement>(f.root, 'judgements'), f.comparisons,
    { list: async () => [], read: async () => null, save: async () => {}, delete: async () => {} }, {} as never,
    new JsonDirectoryStore<EvalRun>(f.root, 'eval-runs'));
  f.service.judgements = judgements;
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'Canvas domain source', context: 'Pinned source, with no target diagram.' });
  const request = { requestId: crypto.randomUUID(), workflow: 'few-shot-refinement', prompts: [{ promptId: 'builtin-few-shot-refinement', version: 1 }],
    passes: 3, model: 'gpt-6-astra', effort: 'high', inputs: { context: { agentContextId: context.agentContextId }, target: f.sources[0] } };
  return { ...f, judgements, request };
}
it('refines five slots through three judged rounds, keeping target content out of all nine generation calls', async () => {
  const f = await refinementFixture(), seen: Parameters<typeof f.runtime.generate>[0][] = [];
  const original = f.runtime.generate.bind(f.runtime);
  vi.spyOn(f.runtime, 'generate').mockImplementation(async input => { seen.push({ ...input, files: structuredClone(input.files) }); return original(input); });
  const started = await f.service.start(f.request); await settle(f, started.id);
  const run = await f.service.read(started.id);
  expect(run.status).toBe('finished'); expect(run.cells).toHaveLength(13);
  expect(run.cells.filter(c => c.canvasId)).toHaveLength(9);
  expect(seen.map(i => i.stage)).toEqual(['seed', 'alternative', 'alternative', 'alternative', 'judge', 'alternative', 'alternative', 'alternative', 'judge', 'alternative', 'alternative', 'alternative', 'judge']);
  const generated = seen.filter(i => i.stage === 'alternative');
  for (const input of generated) {
    expect(input.model).toBe('gpt-6-astra'); expect(input.effort).toBe('high');
    expect(Object.keys(input.files).sort()).toEqual(['context.json', 'few-shot.json', 'layout-template.json']);
    expect(input.files['few-shot.json']).toHaveLength(5);
    expect(JSON.stringify(input.files['few-shot.json'])).not.toContain('rationale');
    expect(JSON.stringify(input.files['layout-template.json'])).not.toContain('description');
  }
  const report = await f.judgements.read(`${started.id}-progress`);
  expect(report.kind).toBe('few-shot-progress');
  if (report.kind !== 'few-shot-progress') throw Error('wrong kind');
  expect(await f.references.list()).toHaveLength(20);
  expect(report.data!.initialReferences.every(item => item.referenceId)).toBe(true);
  expect(report.data!.rounds).toHaveLength(3); expect(report.subjects).toHaveLength(9);
  expect(report.data!.rounds[1].references).toEqual(report.data!.rounds[0].nextReferences);
  expect((await f.judgements.list(started.id))[0].status).toBe('finished');
  await f.judgements.delete(report.id); expect(await f.judgements.list()).toEqual([]);
  await f.judgements.saveProgress(report); expect(await f.judgements.list()).toEqual([]);
});
it('stops after a failed judgement and retains generated evidence without starting later rounds', async () => {
  const f = await refinementFixture(), original = f.runtime.generate.bind(f.runtime);
  vi.spyOn(f.runtime, 'generate').mockImplementation(input => { if (input.stage === 'judge') throw Error('Evaluator unavailable'); return original(input); });
  const started = await f.service.start(f.request); await settle(f, started.id);
  const run = await f.service.read(started.id), report = await f.judgements.read(`${started.id}-progress`);
  expect(run.status).toBe('partial'); expect(run.cells.filter(c => c.canvasId)).toHaveLength(3);
  expect(run.cells.filter(c => c.stage === 'alternative' && c.status === 'skipped')).toHaveLength(6);
  expect(report.status).toBe('failed'); expect(report.error).toContain('Evaluator unavailable');
  expect(run.outputSnapshots && Object.keys(run.outputSnapshots)).toHaveLength(3);
});
it('cancels refinement during seeding without starting alternatives', async () => {
  const f = await refinementFixture();
  const generation = vi.spyOn(f.runtime, 'generate').mockImplementation(input => new Promise((_, reject) => {
    input.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
  }));
  const started = await f.service.start(f.request);
  await expect.poll(() => generation.mock.calls.length).toBe(1);
  await f.service.cancel(started.id); await settle(f, started.id);
  expect((await f.service.read(started.id)).status).toBe('cancelled');
  expect((await f.judgements.read(`${started.id}-progress`)).error).toContain('cancelled');
});


it('generates five independent samples with identical prompts and pinned selected references', async () => {
  const f = await fixture();
  const reference = await f.references.create({ requestId: crypto.randomUUID(), name: 'Synthetic tree', ascii: 'Root\n`-- leaf', source: f.sources[0], sourceName: 'Synthetic', canvasName: 'Target' });
  const prompt = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'roll-up', name: 'Referenced', stages: { r2: '{{references}}\n{{pass}}/{{passes}}', g2: '{{references}}\n{{pass}}/{{passes}}' } });
  const original = f.runtime.generate.bind(f.runtime), seen: string[] = [];
  f.runtime.generate = async input => { seen.push(input.prompt); return original(input); };
  const run = await f.service.start(f.rollUp({ passes: 5, referenceIds: [reference.id], prompts: [{ promptId: prompt.id, version: 1 }] }));
  await f.references.update(reference.id, { name: 'Changed later', archived: true });
  await settle(f, run.id);
  expect(seen).toHaveLength(10);
  expect(new Set(seen).size).toBe(1);
  expect(seen[0]).toBe('### Synthetic tree\n```text\nRoot\n`-- leaf\n```\n1/1');
  expect(run.references?.[0].name).toBe('Synthetic tree');
  expect((await f.service.read(run.id)).cells).toHaveLength(10);
});

it('relaunches one selected generation with edited text while preserving pins and original prompt versions', async () => {
  const f = await fixture();
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'Attempt context', context: 'Pinned code evidence' });
  const upstream = await f.service.start({ requestId: crypto.randomUUID(), workflow: 'alternatives', prompts: [{ promptId: 'builtin-alternatives', version: 1 }], inputs: { context: { agentContextId: context.agentContextId } }, passes: 1 });
  await settle(f, upstream.id);
  const upstreamCell = (await f.service.read(upstream.id)).cells[0];
  const reference = await f.references.create({ requestId: crypto.randomUUID(), name: 'Pinned reference', ascii: 'Root\n`-- Leaf', source: f.sources[0], sourceName: 'Source', canvasName: 'Canvas' });
  const template = await f.layouts.save({ requestId: crypto.randomUUID(), name: 'Pinned layout', capture: await f.layouts.capture(f.sources[0]) });
  const text = `Read context.json, layout-template.json and previous-1.json. {{references}} {{ref:${reference.id}}}`;
  const prompt = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'alternatives', name: 'Original', stages: { alternative: text } });
  const source = await f.service.start({ requestId: crypto.randomUUID(), workflow: 'alternatives', prompts: [{ promptId: prompt.id, version: 1 }], inputs: { context: { agentContextId: context.agentContextId } }, previous: [upstreamCell.canvasId], layoutTemplateId: template.id, referenceIds: [reference.id], passes: 3, model: 'test-model', effort: 'high' });
  await settle(f, source.id);
  const before = await f.service.read(source.id);
  await f.references.update(reference.id, { name: 'Changed library name', archived: true });
  await f.layouts.delete(template.id);
  await f.service.deleteCanvas(upstreamCell.canvasId!);
  const stages = { alternative: text + '\nShow ownership explicitly.' }, requestId = crypto.randomUUID();
  const results = await Promise.all([f.service.launchEdited(source.id, before.cells[2].key, stages, requestId), f.service.launchEdited(source.id, before.cells[2].key, stages, requestId)]);
  expect(results[0].id).toBe(results[1].id);
  await settle(f, results[0].id);
  const after = await f.service.read(requestId);
  expect(after.status).toBe('finished'); expect(after.cells).toHaveLength(1);
  expect(after.request).toMatchObject({ passes: 1, model: 'test-model', effort: 'high', parentRunId: source.id });
  expect(after.prompts[0].stages).toEqual(stages);
  expect(after.prompts[0].references).toEqual(before.prompts[0].references);
  expect(after.references).toEqual(before.references); expect(after.previous).toEqual(before.previous); expect(after.layoutTemplate).toEqual(before.layoutTemplate);
  expect(after.contexts).toEqual(before.contexts); expect(after.inputs).toEqual(before.inputs);
  expect(await f.service.read(source.id)).toEqual(before);
  expect((await f.prompts.read(prompt.id)).versions).toHaveLength(1);
  expect(after.prompts[0].promptId).not.toBe(prompt.id);
  await expect(f.service.launchEdited(source.id, before.cells[2].key, { alternative: text + 'different' }, requestId)).rejects.toThrow('request ID');
  await expect(f.service.launchEdited(source.id, before.cells[2].key, { alternative: '{{unknown}} layout-template.json' }, crypto.randomUUID())).rejects.toThrow('edited prompt');
});

it('prepares proposal trees without execution and retains invalid tree syntax as immutable judgement evidence', async () => {
  const f = await fixture();
  const context = await f.contexts.create({ requestId: crypto.randomUUID(), name: 'Pinned changes', context: 'Before: local storage. After: shared persistence.' });
  const prompt = await f.prompts.save({ requestId: crypto.randomUUID(), workflow: 'diagram-change-proposal', name: 'Proposal baseline', stages: { proposal: 'Read context.json and return {tree}, an ASCII proposal tree.' } });
  const tree = 'Proposed diagram changes\n  `-- Core                              existing canvas\n      `-- [9] An unknown strategy';
  const generate = vi.spyOn(f.runtime, 'generate').mockResolvedValue({ output: { tree } } as never);
  const prepared = await f.service.prepareForReview({ requestId: crypto.randomUUID(), workflow: 'diagram-change-proposal', prompts: [{ promptId: prompt.id, version: 1 }], inputs: { context: { agentContextId: context.agentContextId } }, passes: 1, model: 'test', effort: 'high' });
  expect(generate).not.toHaveBeenCalled(); expect(await f.service.list()).toHaveLength(0);
  const run = await f.service.launchPrepared(prepared); await settle(f, run.id);
  const result = await f.service.read(run.id);
  expect(result.status).toBe('finished'); expect(result.cells[0].proposalTree).toBe(tree);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(Object.keys(generate.mock.calls[0][0].files)).toEqual(['context.json']);
});
