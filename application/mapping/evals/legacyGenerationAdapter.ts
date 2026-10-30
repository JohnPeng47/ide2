import { randomUUID } from 'node:crypto';
import type { ChatSession } from '../../../domain/mapping/agent-chat/agentChat';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import type { EvalRun, EvalRunCell } from '../../../domain/mapping/evals/evalRun';
import { runStatus } from '../../../domain/mapping/evals/evalRun';
import { sha256 } from '../../../domain/core/sha256';
import { copyCompareHistory } from '../compare/compareSessionService';
import type { EvalRunStore } from './evalRunService';
import type { AgentContextLibrary } from '../agent/agentContextLibrary';
import type { DiagramRepository } from '../../core/ports/diagramRepository';

export const legacyEvalRunId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id) ? id : sha256(id);

/** Observes the original executor. Never parses an old request as an EvalRunRequest or launches a different runtime. */
export class LegacyGenerationAdapter {
  private queue: Promise<void> = Promise.resolve();
  constructor(private store: EvalRunStore, private projects: Pick<DiagramRepository, 'loadProject' | 'projectCatalogs'>,
    private contexts: AgentContextLibrary, private deleted: Set<string>, private number: () => number) {}
  async drain() { await this.queue; }
  rename(id: string, name: string) {
    const next = this.queue.then(async () => {
      const run = await this.store.read(id);
      if (!run || run.deletedAt || this.deleted.has(id)) throw Error('Run not found.');
      if (name) run.name = name; else delete run.name;
      await this.store.save(run);
    });
    this.queue = next.catch(() => {}); return next;
  }
  update(children: ChatSession[], parent?: ChatSession, historical = false) {
    const snapshot = structuredClone({ children, parent });
    const next = this.queue.then(() => this.write(snapshot.children, snapshot.parent, historical));
    this.queue = next.catch(() => {});
    return next;
  }
  private async write(children: ChatSession[], parent: ChatSession | undefined, historical: boolean) {
    if (!children.length) return;
    const first = children[0].generation!, metadata = first.metadata;
    const id = legacyEvalRunId(metadata.runId);
    if (this.deleted.has(id)) return;
    let run = await this.store.read(id);
    if (run?.deletedAt) return;
    const project = await this.projects.loadProject(); if (!project) return;
    if (!run) {
      const receipt = parent?.generationRequests?.find(item => item.runId === metadata.runId);
      const catalog = await (this.projects.projectCatalogs.loadCurrentRepresentationCatalog?.(project.id, []) ?? this.projects.projectCatalogs.loadRepresentationCatalog(project.id));
      const existing = Object.values(catalog.representations).find(canvas => canvas.generated?.key === `legacy:${first.source.documentId}:${first.viewId}`)?.generated;
      const digest = sha256(`legacy-context:${first.source.documentId}:${metadata.runId}`);
      const contextRequestId = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
      const retained = await this.contexts.read(`saved-agent-context-${contextRequestId}`, false).catch(() => undefined);
      const contextId = first.evalAgentContextId ?? metadata.agentContextId ?? existing?.agentContextId ?? retained?.agentContextId;
      const captured = JSON.stringify({ parentChatId: metadata.parentChatId, ...(historical ? {} : { items: parent?.items, canvasContext: parent?.canvasContext,
        settings: parent?.settings, tools: parent?.toolDefinitions }), triggerPrompt: metadata.triggerPrompt, taskPrompt: metadata.taskPrompt });
      const blocks = Array.from({ length: Math.ceil(captured.length / 1_000_000) }, (_, i) => ({ type: 'text', text: captured.slice(i * 1_000_000, (i + 1) * 1_000_000) }));
      const context = contextId ? await this.contexts.read(contextId, false).catch(() => ({ agentContextId: contextId, name: existing?.contextName ?? 'Unavailable AgentContext' })) : await this.contexts.create({
        requestId: contextRequestId, name: `Generation · ${parent?.title ?? children[0].title}`.slice(0, 120),
        // Internal provenance only: launchGeneration still forks the original conversation and inherits its tools.
        context: blocks
      });
      const inputHistory = first.inputHistory ?? first.history;
      const checkpointId = first.inputHistory?.headId ?? first.history?.baselineId;
      const inputs: EvalRun['inputs'] = {};
      if (checkpointId && inputHistory && first.parentViewId) {
        const source = { documentId: first.source.documentId, viewId: first.parentViewId, checkpointId };
        inputs.source = { id: randomUUID(), source, canvasName: parent?.title ?? 'Source canvas', history: copyCompareHistory(inputHistory, checkpointId),
          view: { id: first.parentViewId, name: 'Saved source view', createdAt: metadata.startedAt, savedAt: metadata.startedAt,
            startCheckpointId: checkpointId, finalCheckpointId: checkpointId, checkpointIds: [checkpointId] } };
      }
      const prompts = historical ? [] : children.map(child => ({ promptId: child.id, name: child.title,
        stages: { shared: child.generation!.metadata.taskPrompt ?? '', alternative: child.generation!.metadata.prompt } }));
      run = { schemaVersion: 1, number: this.number(), id, projectId: project.id, requestHash: sha256(receipt?.signature ?? JSON.stringify(metadata)), workflow: 'alternatives',
        agentContextId: context.agentContextId, contextName: context.name, prompts, inputs, ...(first.evalParentRunId ? { parentRunId: first.evalParentRunId } : {}), status: 'queued', createdAt: metadata.startedAt, cells: [],
        ...(historical ? { legacy: true } : { compatibility: { kind: 'chat-alternatives', requestId: receipt?.requestId, parentChatId: metadata.parentChatId,
          candidates: children.map(child => ({ viewId: child.generation!.viewId, chatId: child.id, name: child.title })) } as const }),
        request: { requestId: receipt?.requestId ?? metadata.runId, workflow: 'alternatives', prompts: [],
          inputs: Object.fromEntries(Object.entries(inputs).map(([name, copy]) => [name, copy.source])), task: metadata.taskPrompt, passes: 1,
          model: metadata.model, effort: metadata.effort as EvalRun['request']['effort'] } };
    }
    for (const child of children) {
      if (this.deleted.has(id)) return;
      const generation = child.generation!, meta = generation.metadata, prior = run.cells.find(cell => cell.key === generation.viewId);
      const cell: EvalRunCell = { ...prior, key: generation.viewId, candidateName: child.title, pass: 1, stage: 'alternative', status: meta.status,
        ...(run.prompts.some(prompt => prompt.promptId === child.id) ? { promptId: child.id, promptName: child.title } : {}),
        explanation: child.items?.filter(item => item.kind === 'assistant').map(item => item.text).join('\n') || prior?.explanation,
        startedAt: meta.startedAt, completedAt: meta.completedAt, error: meta.error, usage: meta.usage };
      if (meta.status === 'finished' && generation.history && !prior?.canvasId) {
        const history = copyCompareHistory(generation.history, generation.history.headId), document = documentFromHistory(history);
        const prompt = run.prompts.find(p => p.promptId === child.id);
        const saved = await this.projects.projectCatalogs.saveMappingDiagram(project.id, { name: child.title.slice(0,120), type: 'generated', history,
          scene: document.scene, edges: document.edges, repositoryId: project.repositories?.length === 1 ? project.repositories[0].id : undefined,
          generated: { key: `legacy:${generation.source.documentId}:${generation.viewId}`, agentContextId: run.agentContextId, contextName: run.contextName,
            stage: 'alternative', workflow: 'alternatives', runId: run.id, pass: 1, source: run.inputs.source?.source, generation: structuredClone(meta),
            ...(prompt ? { prompt: { id: prompt.promptId, name: prompt.name }, promptStages: prompt.stages } : {}) } });
        if (this.deleted.has(id)) { await this.projects.projectCatalogs.archiveRepresentation(project.id, saved.representation.id); return; }
        cell.canvasId = saved.representation.id; cell.checkpointId = history.headId;
        (run.outputSnapshots ??= {})[cell.canvasId] = { id: cell.canvasId, name: child.title, history, generated: saved.representation.generated! };
      }
      run.cells = [...run.cells.filter(c => c.key !== cell.key), cell];
    }
    run.request.model = metadata.model; run.request.effort = metadata.effort as EvalRun['request']['effort'];
    run.status = runStatus(run.cells);
    if (!['queued', 'generating'].includes(run.status)) run.completedAt = children.map(child => child.generation!.metadata.completedAt).filter(Boolean).sort().at(-1) ?? new Date().toISOString();
    if (!this.deleted.has(id)) await this.store.save(run);
  }
}
