import { diagramChangeProposalSchema } from '../../../domain/mapping/evals/diagramChangeTree';
import type { AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import { executeFewShot, fewShotCells, firstTarget } from './fewShotRefinement';
import { LegacyGenerationAdapter, legacyEvalRunId } from './legacyGenerationAdapter';
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
import { attachOutputSchema, canvasContext, rollUpRequestSchema, rollUpOutputSchema, type RollUpRun } from '../../../domain/mapping/rollup/rollUp';
import { alternativeOutputSchema } from '../../../domain/mapping/evals/alternatives';
import { composePrompt, evalWorkflows, promptHasErrors, validatePromptStages, type EvalWorkflowId } from '../../../domain/mapping/evals/evalWorkflows';
import { referenceKey, templateReferences } from '../../../domain/mapping/evals/promptTemplate';
import { renderReference, renderReferences } from '../../../domain/mapping/evals/evalReference';
import type { CompareSource } from '../../../domain/mapping/compare/comparePageSession';
import { cellKey, evalRunRequestSchema, legacyRollUpRun, runStatus, summarizeEvalRun, type EvalRun, type EvalRunCell, type EvalRunContext, type EvalRunPrompt } from '../../../domain/mapping/evals/evalRun';
import { materializeAttachment, materializeRollUp } from '../rollup/rollUpMaterializer';
import { materializeAlternative, materializeTemplateAlternative } from './alternativeMaterializer';
import type { LayoutTemplateService } from './layoutTemplateService';
import type { LayoutPlacement } from '../../../domain/core/diagrams/layoutTemplate';
import { templateOutputSchema } from '../../../domain/mapping/evals/layoutTemplate';
import type { EvalPromptService } from './evalPromptService';
import type { GeneratedCanvasSource } from './generatedCanvasCatalog';

export interface EvalRunStore { list(): Promise<EvalRun[]>; read(id: string): Promise<EvalRun | null>; save(run: EvalRun): Promise<void>; delete(id: string): Promise<void> }
export interface LegacyRollUpStore { list(): Promise<RollUpRun[]>; read(id: string): Promise<RollUpRun | null>; delete(id: string): Promise<void> }
export interface EvalRuntime {
  dispose?(): void;
  generate(input: { workflow: EvalWorkflowId; stage: string; prompt: string; schema: z.ZodType; files: Record<string, unknown>; agentContext?: AgentContextSnapshot; model: string; effort: string; signal: AbortSignal }): Promise<{ output: unknown; usage?: Record<string, number>; execution?: EvalRunCell['execution'] }>;
}
type Generation = Omit<Parameters<EvalRuntime['generate']>[0], 'prompt'> & { body: string; values: Record<string, string>; templateBase?: import('../../../domain/mapping/evals/promptTemplateBase').PromptTemplateBase };

export class EvalRunService {
  experiments?: import('./experimentService').ExperimentService;
  judgements?: import('./judgementService').JudgementService;
  layoutTemplates?: LayoutTemplateService;
  referenceGenerations?: import('./referenceGenerationService').ReferenceGenerationService;
  private ready: Promise<void>;
  readonly legacyGenerations: LegacyGenerationAdapter;
  deleteContextComparisons?: (id: string, workflow: EvalWorkflowId) => Promise<void>;
  replayLegacy?: (run: EvalRun, requestId: string) => Promise<string>;
  cancelLegacy?: (chatId: string) => Promise<void>;
  private nextNumber = 1;
  private starts = new Map<string, Promise<EvalRun>>();
  private preparedLaunches = new Map<string, Promise<EvalRun>>();
  private running = new Map<string, AbortController>();
  private saves = new Map<string, Promise<void>>();
  /** Runs deleted while still executing must not be written back. */
  private deleted = new Set<string>();
  /** Executing runs, so a rename is not overwritten by the next progress save. */
  private live = new Map<string, EvalRun>();
  private migration?: Promise<{ migrated: number }>;
  constructor(private comparisons: CompareSessionService, private workspace: Pick<MappingWorkspaceService, 'loadRecords'> & Partial<Pick<MappingWorkspaceService, 'loadViewHeaders'>>,
    private projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>, private contexts: AgentContextLibrary,
    private prompts: EvalPromptService, private canvases: GeneratedCanvasSource, private store: EvalRunStore, private runtime: EvalRuntime,
    private legacy?: LegacyRollUpStore, private concurrency = 3) {
    this.legacyGenerations = new LegacyGenerationAdapter(store, projects, contexts, this.deleted, () => this.nextNumber++);
    this.ready = store.list().then(async saved => {
      const imported = (await legacy?.list() ?? []).filter(old => !saved.some(run => run.id === old.id)).map(legacyRollUpRun);
      const runs = [...saved, ...imported].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      this.nextNumber = Math.max(0, ...runs.map(run => run.number ?? 0)) + 1;
      for (const run of runs) {
        const before = [run.number, run.status, run.completedAt];
        const interrupted = run.status === 'queued' || run.status === 'generating';
        run.number ??= this.nextNumber++;
        if (run.deletedAt) this.deleted.add(run.id);
        if (run.status === 'queued' || run.status === 'generating') {
          for (const cell of run.cells) if (cell.status === 'queued' || cell.status === 'generating')
            Object.assign(cell, { status: 'failed', error: 'Server restarted during generation. Completed canvases are retained.' });
          run.status = runStatus(run.cells); run.completedAt = new Date().toISOString();
        }
        run.status = runStatus(run.cells);
        if (imported.includes(run) || interrupted || before.some((value, index) => value !== [run.number, run.status, run.completedAt][index])) await store.save(run);
      }
    });
    void this.ready.catch(() => {});
  }
  async outputSnapshot(id: string, checkpointId: string) {
    await this.ready;
    for (const run of await this.store.list()) {
      const output = run.outputSnapshots?.[id];
      if (output?.history.headId === checkpointId) return structuredClone(output);
    }
    return null;
  }
  async recordLegacy(children: import('../../../domain/mapping/agent-chat/agentChat').ChatSession[], parent?: import('../../../domain/mapping/agent-chat/agentChat').ChatSession, historical = false) {
    await this.ready;
    return this.legacyGenerations.update(children, parent, historical);
  }
  generated() { return this.canvases.list(); }
  /** A read-only copy of any canvas or view, e.g. to select an excerpt from it. */
  async captureCanvas(source: CompareSource) {
    const captured = await this.comparisons.capture([source]);
    return captured.canvases[0];
  }
  listContexts(query = '', offset = 0) { return this.contexts.list({ query, offset, limit: 100 }); }
  async canvas(id: string, checkpointId?: string) {
    const canvas = await this.canvases.read(id, checkpointId);
    if (!canvas) throw new ApplicationError('invalid-input', 'Generated canvas not found.');
    return canvas;
  }
  async list() {
    await this.ready;
    const runs = (await this.store.list()).filter(run => !run.deletedAt);
    const live = new Set((await this.canvases.list()).map(canvas => canvas.id));
    const judgements = await this.judgements?.list() ?? [];
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(run => {
      const summary = summarizeEvalRun(run);
      const attached = judgements.filter(item => item.runIds.includes(run.id));
      return { ...summary, ...(attached.length ? { judgements: attached } : {}), cells: summary.cells.map(cell => cell.canvasId && !live.has(cell.canvasId) ? { ...cell, deleted: true } : cell) };
    });
  }
  async read(id: string) {
    await this.ready;
    const run = await this.store.read(id) ?? await this.legacy?.read(id).then(run => run && legacyRollUpRun(run)).catch(() => null);
    if (!run || run.deletedAt) throw new ApplicationError('invalid-input', 'Run not found.');
    return run;
  }
  /** Additive exposure of the retained child/parent contract; old tool schemas are unchanged. */
  async startRollUp(raw: unknown) {
    const input = rollUpRequestSchema.parse(raw);
    return this.startRequest({ requestId: input.requestId, workflow: 'roll-up', inputs: { child: input.child, parent: input.parent },
      prompts: [{ promptId: 'builtin-roll-up', version: 1 }], passes: input.passes, model: input.model, effort: input.effort as EvalRun['request']['effort'] });
  }
  async rerunLegacy(id: string, requestId: string) {
    const run = await this.read(id);
    if (!run.compatibility || !this.replayLegacy) throw new ApplicationError('invalid-input', 'This run has no retained chat executor.');
    return summarizeEvalRun(await this.read(await this.replayLegacy(run, requestId)));
  }
  async start(raw: unknown) { return this.startRequest(evalRunRequestSchema.parse(raw)); }
  async editedPrompt(run: EvalRun, key: string, stages: Record<string, string>) {
    const cell = run.cells.find(c => c.key === key), source = run.prompts.find(p => p.promptId === cell?.promptId);
    if (!cell || !source || run.compatibility || run.legacy) throw new ApplicationError('invalid-input', 'This output has no replayable pinned generation prompt.');
    const references = { ...source.references };
    for (const id of [...new Set(Object.values(stages).flatMap(templateReferences))]) {
      if (references[id]) continue;
      const ref = await this.prompts.references?.read(id).catch(() => undefined);
      if (!ref) throw new ApplicationError('invalid-input', `Reference ${id} is unavailable.`);
      references[id] = { name: ref.name, ascii: ref.ascii, ...(ref.comment ? { comment: ref.comment } : {}) };
    }
    const workflow = evalWorkflows[run.workflow];
    if (Object.keys(stages).some(key => !workflow.stages.some(s => s.id === key)) || promptHasErrors(validatePromptStages(workflow, stages, new Set(Object.keys(references)))))
      throw new ApplicationError('invalid-input', 'Fix the edited prompt before relaunching. All workflow stages and valid template variables are required.');
    if (run.workflow === 'alternatives' && stages.alternative.includes('layout-template.json') !== !!run.layoutTemplate)
      throw new ApplicationError('invalid-input', 'Keep the original layout-template.json input contract in the edited prompt.');
    return { ...source, stages, references };
  }
  async launchEdited(runId: string, key: string, stages: Record<string, string>, requestId: string) {
    const source = await this.read(runId), edited = await this.editedPrompt(source, key, stages);
    const fork = await this.prompts.forkForAttempt(requestId, source.workflow, edited, stages);
    const snapshot = { ...edited, promptId: fork.id, version: 1, name: fork.name, contentHash: fork.versions[0].contentHash, derivation: fork.versions[0].derivation };
    const request = evalRunRequestSchema.parse({ ...source.request, requestId, parentRunId: source.id, prompts: [{ promptId: fork.id, version: 1 }], passes: source.workflow === 'few-shot-refinement' ? 3 : 1 });
    return this.startRequest(request, [snapshot]);
  }
  private async startRequest(request: EvalRun['request'], pinnedPrompts?: EvalRunPrompt[]) {
    await this.ready;
    const hash = sha256(JSON.stringify(request));
    let pending = this.starts.get(request.requestId);
    if (!pending) {
      pending = (async () => (await this.store.read(request.requestId)) ?? this.prepare(request, hash, pinnedPrompts))();
      this.starts.set(request.requestId, pending);
    }
    try {
      const run = await pending;
      if (run.deletedAt) throw new ApplicationError('conflict', 'This run was deleted. Use a new request ID.');
      if (run.requestHash !== hash) throw new ApplicationError('conflict', 'Request ID already used for another run.');
      return summarizeEvalRun(run);
    } finally { if (this.starts.get(request.requestId) === pending) this.starts.delete(request.requestId); }
  }
  /** An empty name restores the default label. */
  async rename(id: string, name: string) {
    await this.ready;
    const run = this.live.get(id) ?? await this.store.read(id);
    if (!run || run.deletedAt) throw new ApplicationError('invalid-input', (await this.legacy?.read(id).catch(() => null)) ? 'Legacy runs cannot be renamed.' : 'Run not found.');
    if (run.compatibility) { await this.legacyGenerations.rename(id, name); return summarizeEvalRun(await this.read(id)); }
    if (name) run.name = name; else delete run.name;
    await this.persist(run);
    return summarizeEvalRun(run);
  }
  async cancel(id: string) {
    const run = await this.read(id);
    if (run.compatibility && this.cancelLegacy) { await Promise.all(run.compatibility.candidates.map(c => this.cancelLegacy!(c.chatId))); return; }
    const abort = this.running.get(id);
    if (!abort) throw new ApplicationError('invalid-input', 'This run is not running.');
    abort.abort();
  }
  private async prepare(request: ReturnType<typeof evalRunRequestSchema.parse>, requestHash: string, pinnedPrompts?: EvalRunPrompt[], reviewOnly = false) {
    const workflow = evalWorkflows[request.workflow];
    // A rerun of a rerun is filed under the same original run.
    const rerun = request.parentRunId ? await this.read(request.parentRunId) : undefined;
    if (request.layoutTemplateId && !['alternatives', 'few-shot-refinement'].includes(request.workflow)) throw new ApplicationError('invalid-input', 'This workflow does not support layout templates.');
    let layoutTemplate = request.layoutTemplateId ? structuredClone(rerun?.layoutTemplate?.id === request.layoutTemplateId
      ? rerun.layoutTemplate : await this.layoutTemplates?.read(request.layoutTemplateId)) : undefined;
    if (request.layoutTemplateId && !layoutTemplate) throw new ApplicationError('invalid-input', 'Layout templates are unavailable.');
    if (rerun?.compatibility) throw new ApplicationError('invalid-input', 'Rerun this generation through its original chat executor.');
    const parent = request.parentRunId ? await this.read(request.parentRunId).then(run => run.parentRunId ? this.read(run.parentRunId) : run) : undefined;
    if (parent && parent.workflow !== request.workflow) throw new ApplicationError('invalid-input', 'A rerun must use the same workflow as its run.');
    const prompts = pinnedPrompts ?? await Promise.all(request.prompts.map(item => Promise.resolve(rerun?.prompts.find(p => p.promptId === item.promptId && p.version === item.version) ?? this.prompts.resolve(item.promptId, item.version, request.workflow))));
    const references = await Promise.all((request.referenceIds ?? []).map(async id => {
      const pinned = rerun?.references?.find(item => item.id === id);
      if (pinned) return pinned;
      const reference = await this.prompts.references?.read(id);
      if (!reference) throw new ApplicationError('invalid-input', `Reference ${id} not found.`);
      return reference;
    }));
    if (references.length && prompts.some(prompt => !Object.values(prompt.stages).some(body => /\{\{\s*references\s*\}\}/.test(body))))
      throw new ApplicationError('invalid-input', 'Add {{references}} to each selected prompt to use the selected references.');
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
    if (request.workflow === 'alternatives') {
      for (const prompt of prompts) {
        const mentionsLayout = prompt.stages.alternative.includes('layout-template.json');
        if (!!layoutTemplate !== mentionsLayout) throw new ApplicationError('invalid-input', layoutTemplate
          ? 'Choose a template prompt that explicitly describes layout-template.json, or edit the prompt first.'
          : 'This prompt requires a layout template. Select one before starting.');
      }
    }
    const contexts: Record<string, EvalRunContext> = {};
    for (const input of contextInputs) {
      const value = request.inputs[input.name];
      if (!('agentContextId' in value)) throw new ApplicationError('invalid-input', `Choose an AgentContext for ${input.name}.`);
      const context = await this.contexts.read(value.agentContextId, false).catch(() => { throw new ApplicationError('invalid-input', 'That AgentContext is no longer available.'); });
      contexts[input.name] = { agentContextId: context.agentContextId, name: context.name, contentHash: context.contentHash };
    }
    const previousIds = [...new Set(request.previous ?? [])];
    if (previousIds.length && request.workflow !== 'alternatives') throw new ApplicationError('invalid-input', 'Only Alternatives runs take earlier alternatives.');
    const previous = await Promise.all(previousIds.map(async id => {
      const pinned = rerun?.previous?.find(copy => copy.source.documentId === id);
      if (pinned) return structuredClone(pinned);
      const canvas = await this.canvases.read(id);
      if (!canvas) throw new ApplicationError('invalid-input', 'An earlier alternative is no longer available.');
      if (generatedWorkflow(canvas.generated) !== 'alternatives' || canvas.generated.agentContextId !== contexts.context?.agentContextId)
        throw new ApplicationError('invalid-input', 'Earlier alternatives must belong to the selected AgentContext and Alternatives workflow.');
      return (await this.comparisons.capture([{ documentId: id, checkpointId: canvas.history.headId }])).canvases[0];
    }));
    const captured = { projectId: (await this.projects.loadProject())?.id, canvases: await Promise.all(canvasInputs.map(async input => {
      const source = canvasSource(input.name);
      const pinned = Object.values(rerun?.inputs ?? {}).find(copy => JSON.stringify(copy.source) === JSON.stringify(source));
      return pinned ? structuredClone(pinned) : (await this.comparisons.capture([source])).canvases[0];
    })) };
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
        prompts: prompts.map(({ name, version, stages }) => ({ name, version, stages })) }) })).agentContextId;
    if (request.workflow === 'few-shot-refinement') {
      if (prompts.length !== 1 || request.passes !== 3 || request.previous?.length) throw new ApplicationError('invalid-input', 'Few-shot refinement uses one prompt, three alternatives per round and three rounds.');
      if (!this.judgements || !this.layoutTemplates) throw new ApplicationError('invalid-input', 'Few-shot services are unavailable.');
      const target = firstTarget({ inputs });
      if (!layoutTemplate) layoutTemplate = await this.layoutTemplates.save({ requestId: request.requestId, name: `First diagram · ${inputs.target.view.name}`.slice(0, 120),
        capture: { source: inputs.target.source, geometry: { format: 'layout-template-v1', placement: { version: 2, gap: 3 }, slots: [{ id: 'slot-1',
          title: target.ascii!.split('\n').find(line => line.trim())!.trim().slice(0, 160), position: { column: 0, row: 0 },
          size: { columns: target.position.columns, rows: target.position.rows } }] } } });
      if (layoutTemplate.geometry.slots.length !== 1 || !layoutTemplate.geometry.slots[0].title) throw new ApplicationError('invalid-input', 'Select a single-diagram template with a title, or leave the template empty to capture the first target diagram.');
      // This experiment uses titles and dimensions only, even if an older template has descriptions.
      layoutTemplate.geometry.slots = layoutTemplate.geometry.slots.map(({ description: _, ...slot }) => slot);
    }
    const cells: EvalRunCell[] = request.workflow === 'few-shot-refinement' ? fewShotCells(prompts[0]) : prompts.flatMap(prompt => Array.from({ length: request.passes }, (_, i) => workflow.stages.map(stage => ({
      key: cellKey(prompt.promptId, i + 1, stage.id), promptId: prompt.promptId, promptVersion: prompt.version, promptName: prompt.name,
      pass: i + 1, stage: stage.id, status: 'queued' as const })))).flat();
    const run: EvalRun = { schemaVersion: 1, ...(reviewOnly ? {} : { number: this.nextNumber++ }), id: request.requestId, requestHash, request, references, projectId: captured.projectId, workflow: workflow.id,
      ...(layoutTemplate ? { layoutTemplate } : {}),
      agentContextId, contextName, prompts, inputs, ...(contextInputs.length ? { contexts } : {}), ...(previous.length ? { previous } : {}), status: 'queued', createdAt: new Date().toISOString(), cells,
      ...(parent ? { parentRunId: parent.id } : {}) };
    if (reviewOnly) return run;
    return this.launchPrepared(run);
  }
  /** Capture prompts and inputs without storing a runnable job or calling the model. */
  async prepareForReview(raw: unknown) {
    const request = evalRunRequestSchema.parse(raw);
    return this.prepare(request, sha256(JSON.stringify(request)), undefined, true);
  }
  async launchPrepared(prepared: EvalRun): Promise<EvalRun> {
    const active = this.preparedLaunches.get(prepared.id);
    if (active) return active;
    const pending = this.launchPreparedOnce(prepared);
    this.preparedLaunches.set(prepared.id, pending);
    try { return await pending; } finally { this.preparedLaunches.delete(prepared.id); }
  }
  private async launchPreparedOnce(prepared: EvalRun) {
    await this.ready;
    const existing = await this.store.read(prepared.id);
    if (existing) {
      if (existing.deletedAt) throw new ApplicationError('conflict', 'Planned run was deleted. Create a new experiment.');
      if (existing.requestHash !== prepared.requestHash) throw new ApplicationError('conflict', 'Run ID already used for another request.');
      return existing;
    }
    const run = structuredClone(prepared); run.number ??= this.nextNumber++; run.createdAt = new Date().toISOString();
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
    if (run.workflow === 'few-shot-refinement') {
      const context = run.contexts!.context;
      try {
        const saved = await this.contexts.read(context.agentContextId);
        if (saved.contentHash !== context.contentHash) throw Error('The AgentContext changed after the run started.');
        const contextFile = { name: saved.name, snapshot: saved.resolvedSnapshot ?? saved.snapshot };
        await executeFewShot({ run, runtime: this.runtime, judgements: this.judgements!, signal, context: contextFile, referenceLibrary: this.prompts.references, persist: () => this.persist(run),
          generate: async (cell, round, alternative, references) => {
            const prompt = run.prompts[0];
            await this.step(run, cell, signal, { workflow: run.workflow, stage: 'alternative', model: run.request.model, effort: run.request.effort,
              signal, body: prompt.stages.alternative, values: { context: saved.name, round: String(round), pass: '1', passes: '1', references: renderReferences(references.map(item => ({ name: item.title, ascii: item.ascii }))), previous: 'none' },
              schema: templateOutputSchema,
              files: { 'context.json': contextFile, 'layout-template.json': run.layoutTemplate!.geometry, 'few-shot.json': references.map(({ rationale: _, ...reference }) => reference) } },
              output => materializeTemplateAlternative(output, run.layoutTemplate!.geometry), `Round ${round} · alternative ${alternative}`, {
                prompt: { id: prompt.promptId, version: prompt.version, name: prompt.name }, promptStages: { ...prompt.stages, references: JSON.stringify(references) }
              }, repositoryId);
          } });
      } catch (error) {
        run.error = error instanceof Error ? error.message : String(error);
        for (const cell of run.cells) if (cell.status === 'queued' || cell.status === 'generating') Object.assign(cell, { status: signal.aborted ? 'cancelled' : 'failed', error: run.error });
      }
      run.completedAt = new Date().toISOString(); await this.persist(run); return;
    }
    let preparedContext: AgentContextSnapshot | undefined;
    if (run.request.contextDelivery === 'session') {
      try {
        const context = run.contexts!.context;
        const saved = await this.contexts.read(context.agentContextId);
        if (saved.contentHash !== context.contentHash) throw Error('The AgentContext changed after the run started.');
        preparedContext = saved.resolvedSnapshot ?? saved.snapshot;
      } catch (error) {
        run.error = String(error);
        for (const cell of run.cells) Object.assign(cell, { status: signal.aborted ? 'cancelled' : 'failed', error: run.error });
        run.completedAt = new Date().toISOString(); await this.persist(run); return;
      }
    }
    const chains = run.prompts.flatMap(prompt => Array.from({ length: run.request.passes }, (_, i) => () => this.chain(run, prompt, i + 1, repositoryId, signal, preparedContext)));
    let next = 0;
    const worker = async () => { while (next < chains.length) await chains[next++]().catch(() => {}); };
    // Finish the first sample before sending the same prefix again. Different cases remain independent.
    await Promise.all(Array.from({ length: Math.min(preparedContext ? 1 : this.concurrency, chains.length) }, worker));
    run.completedAt = new Date().toISOString();
    if (signal.aborted) run.error = 'Run cancelled.';
    await this.persist(run);
  }
  private cell(run: EvalRun, prompt: EvalRunPrompt, pass: number, stage: string) {
    return run.cells.find(cell => cell.key === cellKey(prompt.promptId, pass, stage))!;
  }
  private async step<T extends { history: CanvasHistoryRecord; output: { explanation: string }; viewId?: string; layoutPlacements?: LayoutPlacement[] }>(run: EvalRun, cell: EvalRunCell, signal: AbortSignal,
    generation: Generation, validate: (output: unknown) => T, name: string, generated: Omit<GeneratedCanvas, 'key' | 'agentContextId' | 'contextName' | 'runId' | 'pass' | 'stage'>, repositoryId?: string) {
    Object.assign(cell, { status: 'generating', startedAt: new Date().toISOString() }); await this.persist(run);
    try {
      signal.throwIfAborted();
      const { result, usage, execution } = await this.generateValidated(generation, validate);
      signal.throwIfAborted();
      const document = documentFromHistory(result.history);
      const saved = await this.projects.projectCatalogs.saveMappingDiagram(run.projectId, { name: name.slice(0, 120), type: 'generated', history: result.history,
        scene: document.scene, edges: document.edges, repositoryId, generated: { ...generated, key: cell.key + ':' + run.id, agentContextId: run.agentContextId,
          contextName: run.contextName, runId: run.id, pass: cell.pass, stage: cell.stage as GeneratedCanvas['stage'], workflow: run.workflow,
          ...(run.layoutTemplate ? { layoutTemplate: run.layoutTemplate, layoutPlacements: result.layoutPlacements } : {}),
          ...(result.viewId ? { storageViewId: result.viewId } : {}) } });
      if (this.deleted.has(run.id)) { await this.projects.projectCatalogs.archiveRepresentation(run.projectId, saved.representation.id); signal.throwIfAborted(); }
      (run.outputSnapshots ??= {})[saved.representation.id] = { id: saved.representation.id, name, generated: saved.representation.generated!, history: copyCompareHistory(result.history, result.history.headId) };
      Object.assign(cell, { status: 'finished', canvasId: saved.representation.id, checkpointId: result.history.headId,
        ...(result.layoutPlacements ? { layoutPlacements: result.layoutPlacements } : {}),
        explanation: result.output.explanation, usage, execution, completedAt: new Date().toISOString() });
      await this.persist(run);
      return result;
    } catch (error) {
      Object.assign(cell, { status: signal.aborted ? 'cancelled' : 'failed', error: signal.aborted ? 'Cancelled.' : error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
      await this.persist(run);
      throw error;
    }
  }
  private async chain(run: EvalRun, prompt: EvalRunPrompt, pass: number, repositoryId: string | undefined, signal: AbortSignal, preparedContext?: AgentContextSnapshot) {
    const label = (copy: CompareCanvasCopy) => JSON.stringify(copy.view.name);
    const values = { ...Object.fromEntries(Object.entries(run.inputs).map(([name, copy]) => [name, label(copy)])),
      ...Object.fromEntries(Object.entries(run.contexts ?? {}).map(([name, context]) => [name, JSON.stringify(context.name)])),
      pass: '1', passes: '1', references: renderReferences(run.references ?? []),
      previous: run.previous?.length ? run.previous.map((copy, i) => `previous-${i + 1}.json (${JSON.stringify(copy.view.name)})`).join(', ') : 'none',
      ...Object.fromEntries(Object.entries(prompt.references ?? {}).map(([id, reference]) => [referenceKey(id), renderReference(reference.ascii, reference.comment)])) };
    const common = { workflow: run.workflow, model: run.request.model, effort: run.request.effort, signal, values, templateBase: prompt.templateBase };
    const provenance = { prompt: { id: prompt.promptId, version: prompt.version, name: prompt.name }, promptStages: structuredClone(prompt.stages) };
    const title = `${prompt.name} v${prompt.version} · sample ${pass}`;
    if (run.workflow === 'alternatives' || run.workflow === 'diagram-change-proposal') {
      const proposal = run.workflow === 'diagram-change-proposal';
      const stage = proposal ? 'proposal' : 'alternative';
      const context = run.contexts!.context, cell = this.cell(run, prompt, pass, stage);
      let saved;
      try {
        if (!preparedContext) {
          saved = await this.contexts.read(context.agentContextId);
          if (saved.contentHash !== context.contentHash) throw Error('The AgentContext changed after the run started.');
        }
      } catch (error) {
        Object.assign(cell, { status: 'failed', error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() });
        await this.persist(run); throw error;
      }
      await this.step(run, cell, signal,
        { ...common, stage, body: prompt.stages[stage],
          schema: proposal ? diagramChangeProposalSchema : run.layoutTemplate ? templateOutputSchema : alternativeOutputSchema,
          ...(preparedContext ? { agentContext: preparedContext } : {}),
          files: { ...(!preparedContext && saved ? { 'context.json': { name: saved.name, description: saved.description, snapshot: saved.resolvedSnapshot ?? saved.snapshot } } : {}),
            ...(run.layoutTemplate ? { 'layout-template.json': run.layoutTemplate.geometry } : {}),
            ...Object.fromEntries((run.previous ?? []).map((copy, i) => [`previous-${i + 1}.json`, canvasContext(copy, false)])) } },
        output => {
          if (proposal) {
            const { tree } = diagramChangeProposalSchema.parse(output);
            // Preserve syntax errors for the deterministic judge; never repair them during generation.
            cell.proposalTree = tree;
            return materializeAlternative({ explanation: 'Proposed diagram changes', diagrams: [{ id: 'proposal', ascii: tree, position: { column: 0, row: 0 } }], edges: [] });
          }
          return run.layoutTemplate ? materializeTemplateAlternative(output, run.layoutTemplate.geometry) : materializeAlternative(output);
        }, title, provenance, repositoryId);
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
  private async generateValidated<T>({ body, values, templateBase, ...input }: Generation, validate: (output: unknown) => T) {
    const workflow = evalWorkflows[input.workflow];
    const prompt = composePrompt(workflow, input.stage, body, values, templateBase);
    let files = input.files;
    const usage: Record<string, number> = {};
    for (let attempt = 0; ; attempt++) {
      const response = await this.runtime.generate({ ...input, prompt, files }); input.signal.throwIfAborted();
      for (const [key, value] of Object.entries(response.usage ?? {})) usage[key] = (usage[key] ?? 0) + value;
      try { return { result: validate(response.output), usage, execution: response.execution }; }
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
    const project = await this.projects.loadProject(); if (!project) return { migrated: 0 };
    const catalog = await (this.projects.projectCatalogs.loadCurrentRepresentationCatalog?.(project.id, []) ?? this.projects.projectCatalogs.loadRepresentationCatalog(project.id));
    // Archived keys also count: promotion must not resurrect a deleted output.
    const existing = new Set(Object.values(catalog.representations).map(c => c.generated?.key));
    for (const canvas of Object.values(catalog.representations)) if (canvas.status === 'settled' && canvas.generated?.generation && canvas.generated.generation.status !== 'finished')
      await this.projects.projectCatalogs.archiveRepresentation(project.id, canvas.id, { includeHistory: false });
    const headers = await this.workspace.loadViewHeaders?.();
    if (headers) {
      const views = headers.filter(header => header.type !== 'generated').flatMap(header =>
        Object.values(header.canvasViews?.saved ?? {}).filter(view => !view.archivedAt).map(view => ({ documentId: header.documentId, view })));
      const runIds = [...new Set(views.flatMap(({ view }) => view.generation ? [view.generation.runId] : []))];
      const recorded = new Set((await Promise.all(runIds.map(async id => await this.store.read(legacyEvalRunId(id)) ? id : undefined))).filter(Boolean));
      const pending = views.some(({ documentId, view }) => view.generation
        ? !recorded.has(view.generation.runId) && !['queued', 'generating'].includes(view.generation.status)
        : view.alternativeGroupId && view.finalCheckpointId && !existing.has(`legacy:${documentId}:${view.id}`));
      if (!pending) return { migrated: 0 };
    }
    const { records } = await this.workspace.loadRecords('current'), index = records.workspace as WorkspaceIndex | undefined;
    if (!index) return { migrated: 0 };
    let migrated = 0;
    for (const documentId of index.documentIds) {
      const metadata = records[documentPrefix(documentId) + 'metadata'] as MappingDocumentSnapshot;
      if (metadata.type === 'generated') continue;
      const history = recordHistory(records, documentId);
      const generatedViews = Object.values(history.canvasViews?.saved ?? {}).filter(view => view.generation && !view.archivedAt);
      for (const runId of new Set(generatedViews.map(view => view.generation!.runId))) {
        // Chat lifecycle records win; migration must never overwrite their pinned source or prompt text.
        if (await this.store.read(legacyEvalRunId(runId))) continue;
        // The chat observer owns active generations, including the interval before its first save.
        if (generatedViews.some(view => view.generation!.runId === runId && ['queued', 'generating'].includes(view.generation!.status))) continue;
        const children = generatedViews.filter(view => view.generation!.runId === runId).map(view => ({
          id: view.generation!.chatId, title: view.name,
          generation: { metadata: view.generation!, viewId: view.id, parentViewId: view.parentViewId ?? '', source: { documentId, workspaceInstanceId: 'migration' },
            ...(view.finalCheckpointId ? { history: { ...structuredClone(history), headId: view.finalCheckpointId, baselineId: view.forkCheckpointId ?? view.startCheckpointId } } : {}) }
        } as import('../../../domain/mapping/agent-chat/agentChat').ChatSession));
        await this.recordLegacy(children, undefined, true);
        migrated += children.filter(child => child.generation!.metadata.status === 'finished' && child.generation!.history && !existing.has(`legacy:${documentId}:${child.generation!.viewId}`)).length;
      }
      for (const view of Object.values(history.canvasViews?.saved ?? {})) {
        const key = `legacy:${documentId}:${view.id}`;
        if (view.generation) continue;
        if (!view.alternativeGroupId || view.archivedAt || !view.finalCheckpointId || existing.has(key)) continue;
        const group = view.alternativeGroupId;
        const hex = sha256(`${documentId}:${group}`).slice(0, 32);
        const requestId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;
        const contextName = `Migrated generation · ${metadata.name}`.slice(0,120);
        const { agentContextId } = await this.contexts.create({ requestId, name: contextName,
          context: JSON.stringify({ sourceDocumentId: documentId, generationRunId: group }) });
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
    if (!(await this.canvases.list()).some(canvas => canvas.id === id)) throw new ApplicationError('invalid-input', 'Generated canvas not found.');
    const project = await this.projects.loadProject();
    if (!project) throw new ApplicationError('invalid-input', 'Open a project first.');
    await this.projects.projectCatalogs.archiveRepresentation(project.id, id, { includeHistory: false });
  }
  /** Cancels the run if needed, archives its canvases and removes the record, along with its reruns. */
  async deleteRun(id: string) {
    await this.read(id);
    for (const rerun of await this.store.list()) if (!rerun.deletedAt && rerun.parentRunId === id) await this.deleteRun(rerun.id);
    await this.deleteSingleRun(id);
  }
  /** Deletes exactly the selected runs; reruns in other navigation groups are kept. */
  async deleteRuns(ids: string[]) {
    const selected = new Set(ids);
    for (const run of await this.list()) if (selected.has(run.id)) await this.deleteSingleRun(run.id);
  }
  private async deleteSingleRun(id: string) {
    const run = await this.read(id);
    this.deleted.add(id);
    if (run.compatibility && this.cancelLegacy) await Promise.all(run.compatibility.candidates.map(c => this.cancelLegacy!(c.chatId)));
    this.running.get(id)?.abort();
    await this.legacyGenerations.drain();
    await this.saves.get(id);
    const live = new Set((await this.canvases.list()).map(canvas => canvas.id));
    for (const cell of run.cells) if (cell.canvasId && live.has(cell.canvasId)) await this.deleteCanvas(cell.canvasId);
    await this.store.save({ ...run, deletedAt: new Date().toISOString() });
    if (run.legacy) await this.legacy?.delete(id).catch(() => {});
  }
  /** Removes everything one workflow generated from an AgentContext. The context itself is kept. */
  async deleteContextOutputs(agentContextId: string, workflow: EvalWorkflowId) {
    await this.deleteContextComparisons?.(agentContextId, workflow);
    await this.deleteRuns((await this.list()).filter(run => run.agentContextId === agentContextId && run.workflow === workflow).map(run => run.id));
    for (const canvas of await this.canvases.list())
      if (canvas.generated?.agentContextId === agentContextId && generatedWorkflow(canvas.generated) === workflow) await this.deleteCanvas(canvas.id);
    for (const session of await this.comparisons.list())
      if ((await this.comparisons.read(session.id)).canvases.every(copy => copy.generated?.agentContextId === agentContextId && generatedWorkflow(copy.generated) === workflow)) await this.comparisons.delete(session.id);
  }
  dispose() { for (const abort of this.running.values()) abort.abort(); this.runtime.dispose?.(); }
}
