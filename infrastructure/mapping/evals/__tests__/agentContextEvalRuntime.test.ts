import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import type { EvalRuntime } from '../../../../application/mapping/evals/evalRunService';

const harness = vi.hoisted(() => ({
  chats: [] as any[], loaders: [] as any[], settings: [] as any[], streams: [] as any[],
  reply: '{"tree":"Proposed diagram changes"}', block: false,
  legacy: vi.fn(async () => ({ output: { legacy: true } }))
}));
vi.mock('../evalRuntime', () => ({ CodexEvalRuntime: class { generate = harness.legacy; } }));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: async () => ({ getModel: (_: string, id: string) => ({ id }), hasConfiguredAuth: () => true }) },
  DefaultResourceLoader: class { constructor(options: unknown) { harness.loaders.push(options); } async reload() {} },
  getAgentDir: () => '/tmp',
  SettingsManager: { inMemory: (settings: unknown) => { harness.settings.push(settings); return settings; } },
  SessionManager: { create: () => ({ messages: [] as unknown[], appendMessage(message: unknown) { this.messages.push(structuredClone(message)); } }) },
  createAgentSession: async (options: any) => {
    let emit: (event: any) => void = () => {}, finish: () => void = () => {};
    const chat = { options, history: structuredClone(options.sessionManager.messages), prompts: [] as string[],
      sessionId: crypto.randomUUID(), systemPrompt: 'Stable system prompt',
      agent: { streamFunction: async (model: unknown, history: unknown, options: unknown) => { harness.streams.push({ model, history, options }); } },
      subscribe: (listener: typeof emit) => { emit = listener; return vi.fn(); },
      abort: vi.fn(async () => finish()), dispose: vi.fn(),
      prompt: async (prompt: string) => {
        chat.prompts.push(prompt);
        await chat.agent.streamFunction(options.model, [...chat.history, { role: 'user', content: prompt }], { sessionId: chat.sessionId });
        if (harness.block) await new Promise<void>(resolve => { finish = resolve; });
        emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: harness.reply }],
          usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 0, totalTokens: 200 } } });
        chat.history.push({ role: 'assistant', content: harness.reply });
      }
    };
    harness.chats.push(chat); return { session: chat };
  }
}));
import { AgentContextEvalRuntime } from '../agentContextEvalRuntime';

afterEach(() => {
  harness.chats.length = harness.streams.length = harness.loaders.length = harness.settings.length = 0;
  harness.reply = '{"tree":"Proposed diagram changes"}'; harness.block = false; harness.legacy.mockClear(); vi.useRealTimers();
});
const input = (): Parameters<EvalRuntime['generate']>[0] => ({ workflow: 'diagram-change-proposal', stage: 'proposal',
  model: 'gpt-6-sol', effort: 'high', prompt: 'Use the supplied history. Return JSON.', schema: z.object({ tree: z.string() }), files: {},
  agentContext: AgentContext.fromMessages('shared', [{ role: 'user', content: [{ type: 'text', text: 'Pinned source and diagrams' }], timestamp: 0 }]).toSnapshot(),
  signal: new AbortController().signal });

it('shares an exact history prefix and routing key while keeping sample sessions independent', async () => {
  const runtime = new AgentContextEvalRuntime('/stable/project', true), request = input(), original = structuredClone(request.agentContext);
  const first = await runtime.generate(request), second = await runtime.generate({ ...request, prompt: 'Another task after the same context.' });
  expect(first.execution?.sessionId).not.toBe(second.execution?.sessionId);
  expect(first.execution?.cacheKey).toBe(second.execution?.cacheKey);
  expect(harness.streams[0].history[0]).toEqual(harness.streams[1].history[0]);
  expect(harness.streams[1].history).toHaveLength(2); // No earlier sample answer.
  expect(harness.streams[0].options).toMatchObject({ sessionId: first.execution?.cacheKey, transport: 'sse' });
  expect(request.agentContext).toEqual(original);
  expect(first.usage).toMatchObject({ cacheRead: 80, input: 100, output: 20 });
  expect(harness.chats.every(chat => chat.dispose.mock.calls.length === 1)).toBe(true);
  expect(harness.chats[0].options).toMatchObject({ tools: [], thinkingLevel: 'high', model: { id: 'gpt-6-sol' } });
  expect(harness.settings[0]).toMatchObject({ compaction: { enabled: false }, retry: { enabled: false } });
  expect(harness.loaders[0]).toMatchObject({ noContextFiles: true, noSkills: true, noExtensions: true });
  const changed = await runtime.generate({ ...request, effort: 'low' });
  expect(changed.execution?.cacheKey).not.toBe(first.execution?.cacheKey);
  runtime.dispose();
});

it('preserves raw invalid output for bounded validation retries and supplies feedback after the history', async () => {
  const runtime = new AgentContextEvalRuntime('/stable/project', true), request = input();
  harness.reply = 'not JSON';
  expect((await runtime.generate(request)).output).toBe('not JSON');
  const files = { 'previous-output.json': 'not JSON', 'validation-error.json': { error: 'Expected object' } };
  await runtime.generate({ ...request, files });
  expect(harness.chats[1].prompts[0]).toBe(request.prompt + '\n\n' + JSON.stringify(files));
  expect(harness.streams[1].history[0]).toEqual(harness.streams[0].history[0]);
});

it('keeps historical file-based execution and rejects disabled or already cancelled session runs', async () => {
  const runtime = new AgentContextEvalRuntime('/stable/project', true), request = input();
  const { agentContext: _, ...legacy } = request;
  await runtime.generate(legacy); expect(harness.legacy).toHaveBeenCalledWith(legacy); expect(harness.chats).toHaveLength(0);
  await expect(new AgentContextEvalRuntime('/stable/project', false).generate(request)).rejects.toThrow();
  await expect(runtime.generate({ ...request, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(harness.chats).toHaveLength(0);
});

it('aborts and disposes an active session on cancellation', async () => {
  harness.block = true;
  const runtime = new AgentContextEvalRuntime('/stable/project', true), controller = new AbortController();
  const pending = runtime.generate({ ...input(), signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(harness.streams).toHaveLength(1)); controller.abort();
  await rejected;
  expect(harness.chats[0].abort).toHaveBeenCalledOnce(); expect(harness.chats[0].dispose).toHaveBeenCalledOnce();
});

it('times out without accepting a late answer', async () => {
  vi.useFakeTimers(); harness.block = true;
  const pending = new AgentContextEvalRuntime('/stable/project', true).generate(input());
  const rejected = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(15 * 60_000); await rejected;
  expect(harness.chats[0].dispose).toHaveBeenCalledOnce();
});
