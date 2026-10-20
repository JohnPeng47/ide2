import type { DiffSessionRun } from '../../../domain/mapping/changes/diffSessionWorkflow';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireAiEnabled } from '../../core/errors';
import { runAgentWorkflow } from '../../core/agents/agentWorkflow';
import type { AgentDiagrammingSessionService } from '../agent/sessionService';
import type { ChangeSessionCapture, ChangeSessionService } from './changeSessionService';
import { DiffSessionTools, type DiffSessionSourceReader } from './diffSessionTools';
import { createDiffSessionWorkflow, DIFF_SESSION_MODEL, type DiffSessionAgentSession, type DiffSessionMetric, type DiffSessionPrompts, type DiffSessionRuntime } from './diffSessionWorkflow';

export const diffSessionRequestSchema = z.object({
  requestId: z.string().min(1).max(200), title: z.string().trim().min(1).max(200),
  baselineChangeSessionId: z.string().min(1).max(200).optional(), repositoryId: z.string().min(1).max(200).optional(),
  commits: z.array(z.string().min(1).max(200)).max(2000).optional(),
  comparisonBase: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).nullable().optional(), head: z.string().min(1).max(200).optional(),
  canvasId: z.string().min(1).max(200).optional()
}).strict().refine(input => input.baselineChangeSessionId ? !input.repositoryId && !input.commits && !input.head && !input.canvasId && input.comparisonBase === undefined
  : !!input.repositoryId && (!!input.commits?.length || input.comparisonBase !== undefined && !!input.head && !!input.commits), 'Specify a baseline ChangeSession OR a repository and commits');
export type DiffSessionRequest = z.infer<typeof diffSessionRequestSchema>;
export type { DiffSessionRun } from '../../../domain/mapping/changes/diffSessionWorkflow';
export interface DiffSessionRunStore {
  create(run: DiffSessionRun): Promise<boolean>;
  read(id: string): Promise<DiffSessionRun | undefined>;
  save(run: DiffSessionRun): Promise<void>;
  artifact(id: string, name: string, data: unknown): Promise<void>;
}

export class DiffSessionWorkflowService {
  private active = new Map<string, AbortController>();
  private live = new Map<string, DiffSessionRun>();
  private starts = new Map<string, Promise<DiffSessionRun>>();
  constructor(private readonly changes: ChangeSessionService, private readonly agent: AgentDiagrammingSessionService,
    private readonly runtime: DiffSessionRuntime, private readonly store: DiffSessionRunStore,
    private readonly options: { enabled: boolean; sourceRoot: string; loadPrompts(): Promise<DiffSessionPrompts>;
      sourceReader(capture: ChangeSessionCapture): Promise<DiffSessionSourceReader> }) {}

  async start(raw: unknown): Promise<DiffSessionRun> {
    requireAiEnabled(this.options.enabled);
    const request = diffSessionRequestSchema.parse(raw);
    const id = `diff-run-${createHash('sha256').update(request.requestId).digest('hex').slice(0, 32)}`;
    const pending = this.starts.get(id);
    if (pending) {
      const run = await pending;
      if (JSON.stringify(run.request) !== JSON.stringify(request)) throw Error('REQUEST_ID_CONFLICT');
      return run;
    }
    const start = this.begin(id, request); this.starts.set(id, start);
    try { return await start; } finally { this.starts.delete(id); }
  }
  private async begin(id: string, request: DiffSessionRequest) {
    const now = new Date().toISOString();
    const run: DiffSessionRun = { id, request, workflowId: 'diff-session-create', status: 'running', stage: 'capture',
      model: DIFF_SESSION_MODEL, createdAt: now, updatedAt: now };
    if (!await this.store.create(run)) {
      const existing = await this.get(id);
      if (!existing || JSON.stringify(existing.request) !== JSON.stringify(request)) throw Error('REQUEST_ID_CONFLICT');
      return existing;
    }
    const abort = new AbortController(); this.active.set(id, abort); this.live.set(id, run);
    void this.execute(run, abort.signal).catch(() => {}).finally(() => { this.active.delete(id); this.live.delete(id); });
    return structuredClone(run);
  }
  private async execute(run: DiffSessionRun, signal: AbortSignal) {
    let session: DiffSessionAgentSession | undefined;
    const metrics: DiffSessionMetric[] = [];
    const save = () => { run.updatedAt = new Date().toISOString(); return this.store.save(run); };
    try {
      const capture = await this.changes.capture(run.request);
      if (!capture.context || !capture.hunks.length) throw Error('The workflow requires pinned commits with captured hunks');
      signal.throwIfAborted();
      await this.store.artifact(run.id, 'context', capture);
      const prompts = await this.options.loadPrompts();
      await this.store.artifact(run.id, 'prompts', prompts);
      const tools = new DiffSessionTools(capture, this.changes, this.agent, await this.options.sourceReader(capture),
        run.id, run.request.title, async id => { run.changeSessionId = id; await save(); });
      session = await this.runtime.openSession({ sourceRoot: this.options.sourceRoot, signal, tools: step => tools.tools(step),
        onProgress: message => { run.message = message; }, onMetric: metric => { metrics.push(metric); } });
      run.agentSessionId = session.sessionId; await save();
      const result = await runAgentWorkflow(createDiffSessionWorkflow(prompts, capture), async request => {
        run.stage = request.stepId as 'analyze' | 'materialize'; run.message = `Running ${request.stepId}`;
        await this.store.artifact(run.id, `${request.stepId}-request`, { role: 'user', content: request.prompt }); await save();
        const output = await session!.runStep(request);
        await this.store.artifact(run.id, `${request.stepId}-response`, output);
        await this.store.artifact(run.id, 'conversation', session!.transcript());
        await this.store.artifact(run.id, 'performance', metrics);
        return output;
      }, { signal });
      run.stage = 'validate'; await save();
      const proposal = await this.changes.get(result.changeSessionId!);
      if (proposal.id !== tools.changeSessionId || proposal.status !== 'ready') throw Error('Workflow did not produce its own ready proposal');
      run.changeSessionId = proposal.id; run.status = 'completed'; run.message = 'ChangeSession ready for review';
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed';
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      try {
        if (session) await this.store.artifact(run.id, 'conversation', session.transcript());
        await this.store.artifact(run.id, 'performance', metrics);
      } finally { session?.dispose(); await save(); }
    }
  }
  async get(id: string) {
    const run = this.live.has(id) ? structuredClone(this.live.get(id)!) : await this.store.read(id);
    if (run?.status === 'running' && !this.active.has(id) && !this.starts.has(id)) run.status = 'interrupted';
    return run;
  }
  async cancel(id: string) { this.active.get(id)?.abort(new Error('Workflow cancelled')); return this.get(id); }
  dispose() { for (const abort of this.active.values()) abort.abort(new Error('Server shutting down')); this.runtime.dispose(); }
}
