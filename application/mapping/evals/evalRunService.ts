import type { z } from 'zod';
import { sha256 } from '../../../domain/core/sha256';
import { documentFromHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { documentPrefix, recordHistory, type WorkspaceIndex } from '../../../domain/mapping/workspace/workspaceRecords';
import type { MappingDocumentSnapshot } from '../../../domain/mapping/workspace/mappingWorkspace';
import { generatedWorkflow, type GeneratedCanvas } from '../../../domain/core/diagrams/generatedCanvas';
import type { CompareCanvasCopy } from '../../../domain/mapping/compare/comparePageSession';
import type { DiagramRepository } from '../../core/ports/diagramRepository';
import type { MappingWorkspaceService } from '../workspace/workspaceService';
import type { AgentContextLibrary } from '../agent/agentContextLibrary';
import { ApplicationError } from '../../core/errors';
import { copyCompareHistory, type CompareSessionService } from '../compare/compareSessionService';
import { attachOutputSchema, canvasContext, rollUpOutputSchema, type RollUpRun } from '../../../domain/mapping/rollup/rollUp';
import { alternativeOutputSchema } from '../../../domain/mapping/evals/alternatives';
import { composePrompt, evalWorkflows, promptHasErrors, validatePromptStages, type EvalWorkflowId } from '../../../domain/mapping/evals/evalWorkflows';
import { templateVariables } from '../../../domain/mapping/evals/promptTemplate';
import { cellKey, evalRunRequestSchema, legacyRollUpRun, runStatus, summarizeEvalRun, type EvalRun, type EvalRunCell, type EvalRunContext, type EvalRunPrompt } from '../../../domain/mapping/evals/evalRun';
import { materializeAttachment, materializeRollUp } from '../rollup/rollUpMaterializer';
import { materializeAlternative } from './alternativeMaterializer';
import type { EvalPromptService } from './evalPromptService';
import type { GeneratedCanvasSource } from './generatedCanvasCatalog';

export interface EvalRunStore { list(): Promise<EvalRun[]>; read(id: string): Promise<EvalRun | null>; save(run: EvalRun): Promise<void>; delete(id: string): Promise<void> }
export interface LegacyRollUpStore { list(): Promise<RollUpRun[]>; read(id: string): Promise<RollUpRun | null>; delete(id: string): Promise<void> }
export interface EvalRuntime {
  generate(input: { workflow: EvalWorkflowId; stage: string; prompt: string; schema: z.ZodType; files: Record<string, unknown>; model: string; effort: string; signal: AbortSignal }): Promise<{ output: unknown; usage?: Record<string, number> }>;
}
type Generation = Omit<Parameters<EvalRuntime['generate']>[0], 'prompt'> & { body: string; values: Record<string, string> };

export class EvalRunService {
  private ready: Promise<void>;
  private starts = new Map<string, Promise<EvalRun>>();
  private running = new Map<string, AbortController>();
  private saves = new Map<string, Promise<void>>();
  /** Runs deleted while still executing must not be written back. */
  private deleted = new Set<string>();
  /** Executing runs, so a rename is not overwritten by the next progress save. */
  private live = new Map<string, EvalRun>();
  private migration?: Promise<{ migrated: number }>;
  constructor(private comparisons: CompareSessionService, private workspace: Pick<MappingWorkspaceService, 'loadRecords'>,
    private projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>, private contexts: AgentContextLibrary,
    private prompts: EvalPromptService, private canvases: GeneratedCanvasSource, private store: EvalRunStore, private runtime: EvalRuntime,
    private legacy?: LegacyRollUpStore, private concurrency = 3) {
    this.ready = store.list().then(async runs => {
      for (const run of runs) if (run.status === 'queued' || run.status === 'generating') {
        for (const cell of run.cells) if (cell.status === 'queued' || cell.status === 'generating')
          Object.assign(cell, { status: 'failed', error: 'Server restarted during generation. Completed canvases are retained.' });
        await store.save({ ...run, status: runStatus(run.cells), completedAt: new Date().toISOString() });
      }
    });
    void this.ready.catch(() => {});
  }
  generated() { return this.canvases.list(); }
  listContexts(query = '') { return this.contexts.list({ query, limit: 100 }); }
  async canvas(id: string) {
    const canvas = await this.canvases.read(id);
    if (!canvas) throw new ApplicationError('invalid-input', 'Generated canvas not found.');
    return canvas;
  }
  async list() {
    await this.ready;
    const runs = [...await this.store.list(), ...(await this.legacy?.list() ?? []).map(legacyRollUpRun)];
    const live = new Set((await this.canvases.list()).map(canvas => canvas.id));
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(run => {
      const summary = summarizeEvalRun(run);
      return { ...summary, cells: summary.cells.map(cell => cell.canvasId && !live.has(cell.canvasId) ? { ...cell, deleted: true } : cell) };
    });
  }
  async read(id: string) {
    await this.ready;
    const run = await this.store.read(id) ?? await this.legacy?.read(id).then(run => run && legacyRollUpRun(run)).catch(() => null);
    if (!run) throw new ApplicationError('invalid-input', 'Run not found.');
    return run;
  }
  async start(raw: unknown) {
    await this.ready;
    const request = evalRunRequestSchema.parse(raw), hash = sha256(JSON.stringify(request));
    let pending = this.starts.get(request.requestId);
    if (!pending) {
      pending = (async () => (await this.store.read(request.requestId)) ?? this.prepare(request, hash))();
      this.starts.set(request.requestId, pending);
    }
    try {
      const run = await pending;
      if (run.requestHash !== hash) throw new ApplicationError('conflict', 'Request ID already used for another run.');
      return summarizeEvalRun(run);
    } finally { if (this.starts.get(request.requestId) === pending) this.starts.delete(request.requestId); }
  }
  /** An empty name restores the default label. */
  async rename(id: string, name: string) {
    await this.ready;
    const run = this.live.get(id) ?? await this.store.read(id);
    if (!run) throw new ApplicationError('invalid-input', (await this.legacy?.read(id).catch(() => null)) ? 'Legacy runs cannot be renamed.' : 'Run not found.');
    if (name) run.name = name; else delete run.name;
    await this.persist(run);
    return summarizeEvalRun(run);
  }
  cancel(id: string) {
    const abort = this.running.get(id);
    if (!abort) throw new ApplicationError('invalid-input', 'This run is not running.');
    abort.abort();
  }
  private async prepare(request: ReturnType<typeof evalRunRequestSchema.parse>, requestHash: string) {
    const workflow = evalWorkflows[request.workflow];
    // A rerun of a rerun is filed under the same original run.
    const parent = request.parentRunId ? await this.read(request.parentRunId).then(run => run.parentRunId ? this.read(run.parentRunId) : run) : undefined;
    if (parent && parent.workflow !== request.workflow) throw new ApplicationError('invalid-input', 'A rerun must use the same workflow as its run.');
    const prompts = await Promise.all(request.prompts.map(item => this.prompts.resolve(item.promptId, item.version, request.workflow)));
    const invalid = prompts.find(prompt => promptHasErrors(validatePromptStages(workflow, prompt.stages)));
    if (invalid) throw new ApplicationError('invalid-input', `${invalid.name} v${invalid.version} has template errors for this workflow. Save a corrected version.`);
    const canvasInputs = workflow.inputs.filter(input => input.type === 'canvas'), contextInputs = workflow.inputs.filter(input => input.type === 'agent-context');
    const bound = [...canvasInputs, ...contextInputs];
    for (const input of bound) if (!request.inputs[input.name]) throw new ApplicationError('invalid-input', `Choose a ${input.label}.`);
    const unknown = Object.keys(request.inputs).find(name => !bound.some(input => input.name === name));
    if (unknown) throw new ApplicationError('invalid-input', `Unknown input ${unknown}.`);
    const canvasSource = (name: string) => {
      const value = request.inputs[name];
      if ('agentContextId' in value) throw new ApplicationError('invalid-input', `Choose a canvas for ${name}.`);
      return { documentId: value.documentId, ...(value.viewId ? { viewId: value.viewId } : {}), checkpointId: value.checkpointId };
    };
    const keys = canvasInputs.map(input => JSON.stringify(canvasSource(input.name)));
    if (new Set(keys).size !== keys.length) throw new ApplicationError('invalid-input', 'Choose distinct canvases for each input.');
    const usesTask = prompts.some(prompt => Object.values(prompt.stages).some(body => templateVariables(body).includes('task')));
    if (usesTask && !request.task?.trim()) throw new ApplicationError('invalid-input', 'A selected prompt uses {{task}}. Describe the task.');
    const contexts: Record<string, EvalRunContext> = {};
    for (const input of contextInputs) {
      const value = request.inputs[input.name];
      if (!('agentContextId' in value)) throw new ApplicationError('invalid-input', `Choose an AgentContext for ${input.name}.`);
      const context = await this.contexts.read(value.agentContextId, false).catch(() => { throw new ApplicationError('invalid-input', 'That AgentContext is no longer available.'); });
      contexts[input.name] = { agentContextId: context.agentContextId, name: context.name, contentHash: context.contentHash };
    }
    const previousIds = [...new Set(request.previous ?? [])];
    if (previousIds.length && request.workflow !== 'alternatives') throw new ApplicationError('invalid-input', 'Only Alternatives runs take earlier alternatives.');
    const previousSources = await Promise.all(previousIds.map(async id => {
      const canvas = await this.canvases.read(id);
      if (!canvas) throw new ApplicationError('invalid-input', 'An earlier alternative is no longer available.');
      return { documentId: id, checkpointId: canvas.history.headId };
    }));
    const previous = previousSources.length ? (await this.comparisons.capture(previousSources)).canvases : [];
    const captured = canvasInputs.length ? await this.comparisons.capture(canvasInputs.map(input => canvasSource(input.name)))
      : { projectId: (await this.projects.loadProject())?.id, canvases: [] as CompareCanvasCopy[] };
    if (!captured.projectId) throw new ApplicationError('invalid-input', 'Open a project first.');
    const inputs = Object.fromEntries(canvasInputs.map(input => [input.name, captured.canvases.find(copy => JSON.stringify(copy.source) === JSON.stringify(canvasSource(input.name)))!]));
    if (Object.values(inputs).some(copy => copy.view.generation && copy.view.generation.status !== 'finished'))
      throw new ApplicationError('invalid-input', 'Wait for input canvases to finish generating.');
    // Outputs are owned by the chosen AgentContext; canvas-only workflows get a new context pinning their inputs.
    // Reruns stay under the original run's context.
    const owner = parent ? { agentContextId: parent.agentContextId, name: parent.contextName } : Object.values(contexts)[0];
    if (parent && contexts.context && contexts.context.agentContextId !== parent.agentContextId)
      throw new ApplicationError('invalid-input', 'A rerun must use the same AgentContext as its run.');
    const contextName = owner ? owner.name : `${workflow.label}: ${inputs[canvasInputs[0].name].view.name}`.slice(0, 120);
    const agentContextId = owner ? owner.agentContextId : (await this.contexts.create({ requestId: request.requestId, name: contextName,
      description: `${prompts.length} prompt${prompts.length === 1 ? '' : 's'} × ${request.passes} pass${request.passes === 1 ? '' : 'es'}`,
      context: JSON.stringify({ workflow: workflow.id, inputs: Object.fromEntries(Object.entries(inputs).map(([name, copy]) => [name, canvasContext(copy, false)])),
        prompts: prompts.map(({ name, version, stages }) => ({ name, version, stages })), task: request.task }) })).agentContextId;
    const cells: EvalRunCell[] = prompts.flatMap(prompt => Array.from({ length: request.passes }, (_, i) => workflow.stages.map(stage => ({
      key: cellKey(prompt.promptId, i + 1, stage.id), promptId: prompt.promptId, promptVersion: prompt.version, promptName: prompt.name,
      pass: i + 1, stage: stage.id, status: 'queued' as const })))).flat();
    const run: EvalRun = { schemaVersion: 1, id: request.requestId, requestHash, request, projectId: captured.projectId, workflow: workflow.id,
      agentContextId, contextName, prompts, inputs, ...(contextInputs.length ? { contexts } : {}), ...(previous.length ? { previous } : {}), status: 'queued', createdAt: new Date().toISOString(), cells,
      ...(parent ? { parentRunId: parent.id } : {}) };
    await this.store.save(run);
    const abort = new AbortController(); this.running.set(run.id, abort);
    const executing = structuredClone(run); this.live.set(run.id, executing);
    void this.execute(executing, abort.signal).finally(() => { this.running.delete(run.id); this.live.delete(run.id); }).catch(() => {});
    return run;
  }
  /** Saves are serialized so an older snapshot never replaces a newer one. */
  private persist(run: EvalRun) {
    if (this.deleted.has(run.id)) return Promise.resolve();
    const snapshot = structuredClone({ ...run, status: runStatus(run.cells) });
    const next = (this.saves.get(run.id) ?? Promise.resolve()).then(() => this.store.save(snapshot));
    this.saves.set(run.id, next.catch(() => {}));
    return next;
  }
  private async execute(run: EvalRun, signal: AbortSignal) {
    const project = await this.projects.loadProject();
    const catalog = await (this.projects.projectCatalogs.loadCurrentRepresentationCatalog?.(run.projectId, []) ?? this.projects.projectCatalogs.loadRepresentationCatalog(run.projectId));
    const anchor = run.inputs.parent ?? Object.values(run.inputs)[0];
    const repositoryId = (anchor && catalog.representations[anchor.source.documentId]?.repositoryId) ?? (project?.repositories?.length === 1 ? project.repositories[0].id : undefined);
    const chains = run.prompts.flatMap(prompt => Array.from({ length: run.request.passes }, (_, i) => () => this.chain(run, prompt, i + 1, repositoryId, signal)));
    let next = 0;
    const worker = async () => { while (next < chains.length) await chains[next++]().catch(() => {}); };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, chains.length) }, worker));
    run.completedAt = new Date().toISOString();
    if (signal.aborted) run.error = 'Run cancelled.';
    await this.persist(run);
  }
  private cell(run: EvalRun, prompt: EvalRunPrompt, pass: number, stage: string) {
    return run.cells.find(cell => cell.key === cellKey(prompt.promptId, pass, stage))!;
  }
  private async step<T extends { history: CanvasHistoryRecord; output: { explanation: string }; viewId?: string }>(run: EvalRun, cell: EvalRunCell, signal: AbortSignal,
    generation: Generation, validate: (output: unknown) => T, name: string, generated: Omit<GeneratedCanvas, 'key' | 'agentContextId' | 'contextName' | 'runId' | 'pass' | 'stage'>, repositoryId?: string) {
    Object.assign(cell, { status: 'generating', startedAt: new Date().toISOString() }); await this.persist(run);
    try {
      signal.throwIfAborted();
      const { result, usage } = await this.generateValidated(generation, validate);
      signal.throwIfAborted();
      const document = documentFromHistory(result.history);
      const saved = await this.projects.projectCatalogs.saveMappingDiagram(run.projectId, { name: name.slice(0, 120), type: 'generated', history: result.history,
        scene: document.scene, edges: document.edges, repositoryId, generated: { ...generated, key: cell.key + ':' + run.id, agentContextId: run.agentContextId,
          contextName: run.contextName, runId: run.id, pass: cell.pass, stage: cell.stage as GeneratedCanvas['stage'], workflow: run.workflow,
          ...(result.viewId ? { storageViewId: result.viewId } : {}) } });
      Object.assign(cell, { status: 'finished', canvasId: saved.representation.id, checkpointId: result.history.headId,
        explanation: result.output.explanation, usage, completedAt: new Date().toISOString() });
      await this.persist(run);
      return result;
    } catch (error) {
      Object.assign(cell, { status: 'failed', error: signal.aborted ? 'Cancelled.' : error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
      await this.persist(run);
      throw error;
    }
  }
  private async chain(run: EvalRun, prompt: EvalRunPrompt, pass: number, repositoryId: string | undefined, signal: AbortSignal) {
    const label = (copy: CompareCanvasCopy) => JSON.stringify(copy.view.name);
    const values = { ...Object.fromEntries(Object.entries(run.inputs).map(([name, copy]) => [name, label(copy)])),
      ...Object.fromEntries(Object.entries(run.contexts ?? {}).map(([name, context]) => [name, JSON.stringify(context.name)])),
      task: run.request.task ?? '', pass: String(pass), passes: String(run.request.passes),
      previous: run.previous?.length ? run.previous.map((copy, i) => `previous-${i + 1}.json (${JSON.stringify(copy.view.name)})`).join(', ') : 'none' };
    const common = { workflow: run.workflow, model: run.request.model, effort: run.request.effort, signal, values };
    const provenance = { prompt: { id: prompt.promptId, version: prompt.version, name: prompt.name } };
    const title = `${prompt.name} v${prompt.version} · pass ${pass}`;
    if (run.workflow === 'alternatives') {
      const context = run.contexts!.context, cell = this.cell(run, prompt, pass, 'alternative');
      let saved;
      try {
        saved = await this.contexts.read(context.agentContextId);
        if (saved.contentHash !== context.contentHash) throw Error('The AgentContext changed after the run started.');
      } catch (error) {
        Object.assign(cell, { status: 'failed', error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
        await this.persist(run); throw error;
      }
      await this.step(run, cell, signal,
        { ...common, stage: 'alternative', body: prompt.stages.alternative, schema: alternativeOutputSchema,
          files: { 'context.json': { name: saved.name, description: saved.description, snapshot: saved.resolvedSnapshot ?? saved.snapshot },
            ...Object.fromEntries((run.previous ?? []).map((copy, i) => [`previous-${i + 1}.json`, canvasContext(copy, false)])) } },
        materializeAlternative, title, provenance, repositoryId);
      return;
    }
    const { child, parent } = run.inputs;
    const files = { 'child.json': canvasContext(child, false), 'parent-minimized.json': canvasContext(parent, true), 'parent-full.json': canvasContext(parent, false) };
    let r2;
    try {
      r2 = await this.step(run, this.cell(run, prompt, pass, 'r2'), signal, { ...common, stage: 'r2', body: prompt.stages.r2, schema: rollUpOutputSchema, files },
        materializeRollUp, `${title} · r2`, { ...provenance, source: child.source }, repositoryId);
    } catch (error) {
      Object.assign(this.cell(run, prompt, pass, 'g2'), { status: 'skipped', error: 'r2 did not finish.' }); await this.persist(run);
      throw error;
    }
    await this.step(run, this.cell(run, prompt, pass, 'g2'), signal,
      { ...common, stage: 'g2', body: prompt.stages.g2, schema: attachOutputSchema, files: { ...files, 'r2.json': r2.output } },
      output => materializeAttachment(parent.history, r2.output, output), `${title} · g2`, { ...provenance, source: parent.source }, repositoryId);
  }
  private async generateValidated<T>({ body, values, ...input }: Generation, validate: (output: unknown) => T) {
    const prompt = composePrompt(evalWorkflows[input.workflow], input.stage, body, values);
    let files = input.files;
    const usage: Record<string, number> = {};
    for (let attempt = 0; ; attempt++) {
      const response = await this.runtime.generate({ ...input, prompt, files }); input.signal.throwIfAborted();
      for (const [key, value] of Object.entries(response.usage ?? {})) usage[key] = (usage[key] ?? 0) + value;
      try { return { result: validate(response.output), usage }; }
      catch (error) {
        if (attempt >= 2) throw error;
        files = { ...input.files, 'previous-output.json': response.output, 'validation-error.json': { error: String(error) } };
      }
    }
  }
  /** Idempotent promotion of pre-Evals generated views. Original checkpoints remain available. */
  async migrate() {
    if (this.migration) return this.migration;
    this.migration = this.migrateLegacy();
    try { return await this.migration; } finally { this.migration = undefined; }
  }
  private async migrateLegacy() {
    const { records } = await this.workspace.loadRecords('current'), index = records.workspace as WorkspaceIndex | undefined;
    if (!index) return { migrated: 0 };
    const existing = new Set((await this.generated()).map(c => c.generated?.key));
    const project = await this.projects.loadProject(); let migrated = 0;
    for (const documentId of index.documentIds) {
      const metadata = records[documentPrefix(documentId) + 'metadata'] as MappingDocumentSnapshot;
      if (metadata.type === 'generated') continue;
      const history = recordHistory(records, documentId);
      for (const view of Object.values(history.canvasViews?.saved ?? {})) {
        const key = `legacy:${documentId}:${view.id}`;
        if ((!view.generation && !view.alternativeGroupId) || view.archivedAt || !view.finalCheckpointId || existing.has(key) ||
          view.generation && ['queued', 'generating'].includes(view.generation.status)) continue;
        let agentContextId = view.generation?.agentContextId, contextName: string;
        if (agentContextId) contextName = (await this.contexts.read(agentContextId, false)).name;
        else {
          // Stable UUID gives every old generation run one durable context root.
          const group = view.generation?.runId ?? view.alternativeGroupId ?? view.id;
          const hex = sha256(`${documentId}:${group}`).slice(0, 32);
          const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;
          contextName = `Migrated generation · ${metadata.name}`.slice(0,120);
          const context = await this.contexts.create({ requestId, name: contextName, context: JSON.stringify({ sourceDocumentId: documentId, generationRunId: group,
            triggerPrompt: view.generation?.triggerPrompt ?? '', taskPrompt: view.generation?.taskPrompt ?? '', parentChatId: view.generation?.parentChatId ?? '' }) });
          agentContextId = context.agentContextId;
        }
        const copy = copyCompareHistory(history, view.finalCheckpointId), document = documentFromHistory(copy);
        await this.projects.projectCatalogs.saveMappingDiagram(index.projectId, { name: view.name.slice(0, 120), type: 'generated', history: copy, scene: document.scene, edges: document.edges,
          repositoryId: metadata.repositoryId ?? (project?.repositories?.length === 1 ? project.repositories[0].id : undefined),
          generated: { key, agentContextId, contextName, stage: 'legacy', source: { documentId, viewId: view.id, checkpointId: view.finalCheckpointId }, generation: view.generation } });
        migrated++;
      }
    }
    return { migrated };
  }
  /** Archives a generated canvas, like deleting it in Mapping. */
  async deleteCanvas(id: string) {
    await this.canvas(id);
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    await this.projects.projectCatalogs.archiveRepresentation(project.id, id);
  }
  /** Cancels the run if needed, archives its canvases and removes the record, along with its reruns. */
  async deleteRun(id: string) {
    const run = await this.read(id);
    for (const rerun of await this.store.list()) if (rerun.parentRunId === id) await this.deleteRun(rerun.id);
    this.deleted.add(id); this.running.get(id)?.abort();
    await this.saves.get(id);
    const live = new Set((await this.canvases.list()).map(canvas => canvas.id));
    for (const cell of run.cells) if (cell.canvasId && live.has(cell.canvasId)) await this.deleteCanvas(cell.canvasId);
    if (run.legacy) await this.legacy?.delete(id); else await this.store.delete(id);
  }
  /** Removes everything one workflow generated from an AgentContext. The context itself is kept. */
  async deleteContextOutputs(agentContextId: string, workflow: EvalWorkflowId) {
    // Reruns go with their original run.
    for (const run of await this.list()) if (run.agentContextId === agentContextId && run.workflow === workflow && !run.parentRunId) await this.deleteRun(run.id);
    for (const canvas of await this.canvases.list())
      if (canvas.generated?.agentContextId === agentContextId && generatedWorkflow(canvas.generated) === workflow) await this.deleteCanvas(canvas.id);
    for (const session of await this.comparisons.list())
      if (session.origins.length && session.origins.every(origin => origin.agentContextId === agentContextId && origin.workflow === workflow)) await this.comparisons.delete(session.id);
  }
  dispose() { for (const abort of this.running.values()) abort.abort(); }
}
