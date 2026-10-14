import { afterEach, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ create: vi.fn(), model: vi.fn(), actions: [] as ((options: any, session: any) => Promise<void>)[] }));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: async () => ({ getModel: (provider: string, id: string) => { harness.model(provider, id); return { id }; }, hasConfiguredAuth: () => true }) },
  DefaultResourceLoader: class { async reload() {} }, getAgentDir: () => '/tmp',
  SessionManager: { inMemory: () => ({}) }, SettingsManager: { inMemory: () => ({}) }, defineTool: (tool: unknown) => tool,
  createAgentSession: async (options: any) => {
    const session = { sessionId: 'one-conversation', messages: [] as any[], abort: vi.fn(async () => {}), dispose: vi.fn(),
      activeNames: [] as string[], getActiveToolNames: () => session.activeNames,
      setActiveToolsByName: vi.fn((names: string[]) => { session.activeNames = names.filter(name => options.tools.includes(name)); }), prompt: async (prompt: string) => {
        session.messages.push({ role: 'user', content: prompt });
        await harness.actions.shift()?.(options, session);
      } };
    harness.create(options, session); return { session };
  }
}));
import { PiDiffSessionRuntime } from '../diffSessionRuntime';
import { createDiffSessionWorkflow } from '../../../../../application/mapping/changes/diffSessionWorkflow';
import { runAgentWorkflow } from '../../../../../application/core/agents/agentWorkflow';
import type { ChangeSessionCapture } from '../../../../../application/mapping/changes/changeSessionService';
afterEach(() => { vi.clearAllMocks(); harness.actions.length = 0; });
const capture = { documents: [], hunks: [] } as unknown as ChangeSessionCapture;
const context = () => ({ sourceRoot: '/tmp', signal: new AbortController().signal, onProgress: vi.fn(),
  tools: (step: string) => step === 'analyze' ? [] : [{ name: 'complete_diff_session', description: 'complete', schema: { type: 'object', properties: {} },
    execute: async () => ({ changeSessionId: 'new-proposal' }) }] });

it('uses astra-high and sends two separate user messages in one session, retaining the first response', async () => {
  const runtime = new PiDiffSessionRuntime(true), session = await runtime.openSession(context());
  harness.actions.push(async (options, chat) => {
    await expect(options.customTools[0].execute('early', {})).rejects.toThrow('unavailable');
    chat.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Analysis with complete diagrams' }], stopReason: 'stop' });
  }, async (options, chat) => {
    expect(chat.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(chat.messages[1].content[0].text).toContain('complete diagrams');
    await options.customTools[0].execute('finish', {});
  });
  try {
    const result = await runAgentWorkflow(createDiffSessionWorkflow({ analyze: 'Analyze', materialize: 'Create it' }, capture), request => session.runStep(request));
    expect(result.changeSessionId).toBe('new-proposal');
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.model).toHaveBeenCalledWith('openai-codex', 'gpt-6-astra');
    expect(harness.create.mock.calls[0][0].thinkingLevel).toBe('high');
  } finally { session.dispose(); runtime.dispose(); }
});

it('does not materialize after analysis failure or cancellation', async () => {
  const runtime = new PiDiffSessionRuntime(true), config = context(), session = await runtime.openSession(config);
  harness.actions.push(async (_options, chat) => { chat.messages.push({ role: 'assistant', content: [], stopReason: 'error', errorMessage: 'model failed' }); });
  await expect(runAgentWorkflow(createDiffSessionWorkflow({ analyze: 'Analyze', materialize: 'Create' }, capture), request => session.runStep(request))).rejects.toThrow('model failed');
  expect((session.transcript() as any[]).filter(m => m.role === 'user')).toHaveLength(1);
  session.dispose(); runtime.dispose();
});

it('requires AI enablement before opening a session', async () => {
  const runtime = new PiDiffSessionRuntime();
  await expect(runtime.openSession(context())).rejects.toMatchObject({ code: 'ai-disabled' });
  expect(harness.create).not.toHaveBeenCalled();
});
