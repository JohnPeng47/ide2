import { appendFile, copyFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { DefaultResourceLoader, SettingsManager, getAgentDir, createBashTool } from '@earendil-works/pi-coding-agent';
import { PiAgentRuntime } from '../../../infrastructure/core/agents/agentRuntime';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { EVAL_GENERATION_TIMEOUT_MS } from '../../../domain/mapping/evals/evalLimits';

const save = async (file: string, value: unknown) => {
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
};
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
/** Shell inspection can write scratch files, but cannot modify the shared pinned checkout. */
export function readOnlyBash(cwd: string) {
  return { ...createBashTool(cwd, { spawnHook: context => ({ ...context,
    command: 'exec ' + ['bwrap', '--die-with-parent', '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev',
      '--proc', '/proc', '--bind', '/tmp', '/tmp', '--ro-bind', cwd, cwd, '--chdir', cwd,
      '/bin/bash', '--noprofile', '--norc', '-c', context.command].map(quote).join(' ')
  }) }), label: 'Read-only bash' };
}

/** One pool per sample; children have no delegation or validation tools. */
export class MappingSubagents extends PiAgentRuntime {
  readonly records: any[] = [];
  private active = new Set<Promise<any>>();
  private controllers = new Set<AbortController>();
  private tail: Promise<void> = Promise.resolve();
  private permits = 0;
  private waiting: (() => void)[] = [];
  private stopped = false;
  constructor(private options: { cwd: string; context: AgentContext; prompt: string; directory: string;
    model: string; effort: 'medium'; concurrency: number; onFailure?: (error: unknown) => void }) {
    super(true);
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw Error('Invalid child concurrency');
  }
  private async acquire(signal: AbortSignal) {
    while (this.permits >= this.options.concurrency) {
      await new Promise<void>(resolve => {
        const wake = () => { signal.removeEventListener('abort', wake); this.waiting = this.waiting.filter(w => w !== wake); resolve(); };
        this.waiting.push(wake); signal.addEventListener('abort', wake, { once: true });
        if (signal.aborted) wake();
      });
      signal.throwIfAborted();
    }
    signal.throwIfAborted(); this.permits++;
    return () => { this.permits--; this.waiting.shift()?.(); };
  }
  tool() { return {
    name: 'delegate_subagents', label: 'Delegate subtrees',
    description: 'Run independent source-mapping assignments in parallel. Each child receives the same pinned diagrams, repository, and prompt, plus your assignment. Children have read/bash only and return text; you combine, complete, validate and submit. Submit several assignments in one call for parallel execution. The configured concurrency limit queues excess assignments.',
    parameters: Type.Object({ assignments: Type.Array(Type.Object({ name: Type.String({ minLength: 1 }), assignment: Type.String({ minLength: 1 }) }), { minItems: 1 }) }),
    execute: async (_id: string, args: { assignments: { name: string; assignment: string }[] }, signal?: AbortSignal) => {
      if (this.stopped) throw Error('Subagent pool is closed');
      const results = await Promise.allSettled(args.assignments.map(assignment => this.start(assignment, signal)));
      const failed = results.find(r => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const values = results.map(r => (r as PromiseFulfilledResult<any>).value);
      return { content: [{ type: 'text' as const, text: JSON.stringify(values) }], details: { count: values.length } };
    }
  }; }
  private start(assignment: { name: string; assignment: string }, parentSignal?: AbortSignal) {
    const controller = new AbortController(); this.controllers.add(controller);
    const abort = () => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener('abort', abort, { once: true }); if (parentSignal?.aborted) abort();
    const record: any = { id: `child-${this.records.length + 1}`, ...assignment, model: this.options.model,
      effort: this.options.effort, status: 'queued', queuedAt: new Date().toISOString(), usage: {}, cost: {} };
    this.records.push(record);
    const task = this.runChild(record, controller.signal).catch(error => {
      if (record.status !== 'failed') record.status = controller.signal.aborted ? 'cancelled' : 'failed';
      record.error ??= String(error); throw error;
    }).finally(async () => {
      parentSignal?.removeEventListener('abort', abort); this.controllers.delete(controller);
      record.completedAt = new Date().toISOString();
      this.tail = this.tail.then(async () => {
        await mkdir(this.options.directory, { recursive: true });
        await save(path.join(this.options.directory, 'subagents.json'), this.records);
      });
      await this.tail;
    });
    this.active.add(task); void task.finally(() => this.active.delete(task)).catch(() => {}); return task;
  }
  private async runChild(record: any, signal: AbortSignal) {
    const release = await this.acquire(signal);
    const directory = path.join(this.options.directory, record.id);
    let session: any, unsubscribe: (() => void) | undefined, pending = Promise.resolve();
    const abort = () => { if (session) void session.abort().catch(() => {}); };
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort(); }, EVAL_GENERATION_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    try {
      await mkdir(directory, { recursive: true });
      record.status = 'generating'; record.startedAt = new Date().toISOString();
      const configured = await this.model(this.options.model);
      const settingsManager = SettingsManager.inMemory({ defaultProvider: configured.provider, defaultModel: configured.modelId,
        defaultThinkingLevel: this.options.effort, compaction: { enabled: false }, retry: { enabled: false }, transport: 'sse' });
      const resourceLoader = new DefaultResourceLoader({ cwd: this.options.cwd, agentDir: getAgentDir(), settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: 'You are a helpful assistant.' });
      await resourceLoader.reload(); signal.throwIfAborted();
      ({ session } = await this.createSession({ cwd: this.options.cwd, modelRuntime: configured.runtime, model: configured.model,
        thinkingLevel: this.options.effort, tools: ['read', 'bash'], customTools: [readOnlyBash(this.options.cwd)], settingsManager, resourceLoader }, this.options.context));
      record.sessionId = session.sessionId; record.transcript = session.sessionFile;
      await save(path.join(directory, 'session.json'), { ...record, cwd: this.options.cwd, tools: session.getActiveToolNames() });
      let text: string | undefined, failure: string | undefined;
      unsubscribe = session.subscribe((event: any) => {
        if (['tool_execution_start', 'tool_execution_end', 'message_end'].includes(event.type))
          pending = pending.then(() => appendFile(path.join(directory, 'events.jsonl'), JSON.stringify(event) + '\n'));
        if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
        const message = event.message;
        for (const [key, value] of Object.entries(message.usage ?? {})) if (typeof value === 'number') record.usage[key] = (record.usage[key] ?? 0) + value;
        for (const [key, value] of Object.entries(message.usage?.cost ?? {})) if (typeof value === 'number') record.cost[key] = (record.cost[key] ?? 0) + value;
        if (message.stopReason === 'error' || message.stopReason === 'aborted') failure = message.errorMessage || message.stopReason;
        text = message.content.flatMap((b: any) => b.type === 'text' ? [b.text] : []).join('');
      });
      // Role instructions live in the visible versioned prompt, not in a hidden system message.
      const prompt = this.options.prompt + '\n\nSubagent assignment (' + record.name + '):\n' + record.assignment;
      await save(path.join(directory, 'request.json'), { prompt, contextHash: this.options.context.contentHash, model: record.model, effort: record.effort });
      signal.throwIfAborted(); if (timedOut) throw Error('Subagent timed out');
      await session.prompt(prompt); signal.throwIfAborted();
      if (timedOut) throw Error('Subagent timed out');
      if (failure || !text?.trim()) throw Error(failure || 'Subagent returned no text');
      record.status = 'finished'; record.text = text;
      await save(path.join(directory, 'response.json'), { text, usage: record.usage, cost: record.cost });
      return { id: record.id, name: record.name, text };
    } catch (error) {
      // Stop queued work before releasing this slot. A tool error must not silently
      // become another child or another lead turn inside the same paid sample.
      if (!signal.aborted) {
        record.status = 'failed'; record.error = String(error); this.stopped = true;
        for (const controller of this.controllers) controller.abort(error);
        this.options.onFailure?.(error);
      }
      throw error;
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      unsubscribe?.();
      try { await pending; if (session?.sessionFile) await copyFile(session.sessionFile, path.join(directory, 'transcript.jsonl')); }
      finally { session?.dispose(); if (session) this.sessions.delete(session); release(); }
    }
  }
  async close() {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.active]); await this.tail;
    this.dispose();
  }
  assertHealthy() {
    const failed = this.records.find(r => r.status !== 'finished');
    if (failed) throw Error(`Subagent ${failed.id} ${failed.status}: ${failed.error ?? 'incomplete'}`);
  }
}
