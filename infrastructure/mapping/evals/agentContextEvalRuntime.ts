import { DefaultResourceLoader, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { sha256 } from '../../../domain/core/sha256';
import type { EvalRuntime } from '../../../application/mapping/evals/evalRunService';
import { PiAgentRuntime } from '../../core/agents/agentRuntime';
import { CodexEvalRuntime } from './evalRuntime';

/** Independent persisted sessions share a resolved history prefix, never another sample's answer. */
export class AgentContextEvalRuntime extends PiAgentRuntime implements EvalRuntime {
  private readonly legacy: CodexEvalRuntime;
  constructor(private readonly cwd: string, enabled = false) {
    super(enabled); this.legacy = new CodexEvalRuntime(enabled);
  }
  async generate(input: Parameters<EvalRuntime['generate']>[0]): ReturnType<EvalRuntime['generate']> {
    if (!input.agentContext) return this.legacy.generate(input);
    this.requireEnabled(); input.signal.throwIfAborted();
    const context = AgentContext.fromSnapshot(input.agentContext);
    // Fail before opening a session if collection did not resolve every source reference.
    context.toPiMessages();
    const configured = await this.model(input.model);
    const effort = input.effort as 'low' | 'medium' | 'high' | 'xhigh';
    const settingsManager = SettingsManager.inMemory({ defaultProvider: configured.provider, defaultModel: configured.modelId,
      defaultThinkingLevel: effort, compaction: { enabled: false }, retry: { enabled: false }, transport: 'sse' });
    const resourceLoader = new DefaultResourceLoader({ cwd: this.cwd, agentDir: getAgentDir(), settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: 'You are a helpful assistant.' });
    await resourceLoader.reload(); input.signal.throwIfAborted();
    const { session } = await this.createSession({ cwd: this.cwd, modelRuntime: configured.runtime, model: configured.model,
      thinkingLevel: effort, tools: [], resourceLoader, settingsManager }, context);
    const cacheKey = `eval-${sha256(JSON.stringify([configured.provider, configured.modelId, effort, session.systemPrompt, context.contentHash]))}`;
    // Pi normally uses the unique session ID as its cache key. Keep independent audit IDs,
    // but route identical prefixes together. SSE prevents shared WebSocket conversation state.
    const stream = session.agent.streamFunction;
    session.agent.streamFunction = (model, history, options) => stream(model, history, { ...options, sessionId: cacheKey, transport: 'sse' });
    const usage: Record<string, number> = {};
    let text: string | undefined, failure: string | undefined;
    const unsubscribe = session.subscribe(event => {
      if (event.type !== 'message_end' || event.message.role !== 'assistant') return;
      const message = event.message;
      for (const [key, value] of Object.entries(message.usage)) if (typeof value === 'number') usage[key] = (usage[key] ?? 0) + value;
      if (message.stopReason === 'error' || message.stopReason === 'aborted') failure = message.errorMessage || message.stopReason;
      text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    });
    const abort = () => { void session.abort().catch(() => {}); };
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 15 * 60_000);
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      input.signal.throwIfAborted();
      const supplementary = Object.keys(input.files).length ? `\n\n${JSON.stringify(input.files)}` : '';
      await session.prompt(input.prompt + supplementary);
      input.signal.throwIfAborted();
      if (timedOut) throw Error('Generation timed out.');
      if (failure) throw Error(`Eval agent failed: ${failure}`);
      if (text === undefined) throw Error('Eval agent returned no assistant response');
      // Malformed envelopes go through the existing bounded validation retry, with raw evidence retained.
      let output: unknown = text;
      try { output = JSON.parse(text); } catch { /* The workflow validator reports the envelope error. */ }
      return { output, usage, execution: { runtime: 'pi-agent-context', sessionId: session.sessionId, contextHash: context.contentHash, cacheKey } };
    } finally {
      clearTimeout(timeout); input.signal.removeEventListener('abort', abort);
      unsubscribe(); session.dispose(); this.sessions.delete(session);
    }
  }
}
