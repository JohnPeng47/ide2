import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SessionManager, type ModelRuntime } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, type Model, type AssistantMessage } from '@earendil-works/pi-ai';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { repositoryContextSchema } from '../../../../domain/core/agents/agentContextRepository';
import { AgentContextEvalRuntime } from '../agentContextEvalRuntime';

it.each([false, true])('sends the same resolved prefix through the real Pi SDK and persists separate transcripts (sections=%s)', async sections => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'eval-sdk-'));
  const requests: { history: unknown; options: any }[] = [], managers: SessionManager[] = [];
  const create = SessionManager.create.bind(SessionManager);
  const spy = vi.spyOn(SessionManager, 'create').mockImplementation(root => {
    const manager = create(root, path.join(cwd, 'sessions')); managers.push(manager); return manager;
  });
  const model = { id: 'gpt-6-sol', name: 'Offline test', provider: 'openai-codex', api: 'openai-codex-responses',
    baseUrl: 'http://offline.invalid', reasoning: true, input: ['text'], contextWindow: 272000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<any>;
  const provider = {
    hasConfiguredAuth: () => true, isUsingOAuth: () => false, getModel: () => model, getAvailableSnapshot: () => [model],
    streamSimple: (_model: unknown, history: unknown, options: unknown) => {
      requests.push({ history: structuredClone(history), options });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: [{ type: 'text', text: '{"tree":"Proposed diagram changes"}' }], stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 10, output: 4, cacheRead: 100, cacheWrite: 0, totalTokens: 114, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'done', reason: 'stop', message }); stream.end(message); return stream;
    }
  } as unknown as ModelRuntime;
  class OfflineRuntime extends AgentContextEvalRuntime {
    protected async model() { return { runtime: provider, model, provider: model.provider, modelId: model.id }; }
  }
  const runtime = new OfflineRuntime(cwd, true);
  try {
    const context = AgentContext.fromMessages('source', [{ role: 'user', timestamp: 0, content: sections
      ? [{ type: 'section', name: 'Evidence', content: [{ type: 'text', text: 'Resolved source evidence' }] }]
      : [{ type: 'text', text: 'Resolved source evidence' }] }]);
    const request = { workflow: 'diagram-change-proposal' as const, stage: 'proposal', model: model.id, effort: 'high',
      agentContext: context.toSnapshot(), prompt: 'Return the proposed changes as JSON.', files: {}, schema: z.object({ tree: z.string() }), signal: new AbortController().signal };
    const a = await runtime.generate(request), b = await runtime.generate(request);
    expect(a.output).toEqual({ tree: 'Proposed diagram changes' }); expect(a.usage?.cacheRead).toBe(100);
    expect(requests).toHaveLength(2);
    // Pi records the new task's local timestamp; provider message conversion does not send it.
    const wireContent = (history: unknown) => JSON.stringify(history, (key, value) => key === 'timestamp' ? undefined : value);
    expect(wireContent(requests[0].history)).toBe(wireContent(requests[1].history));
    expect(requests[0].options).toMatchObject({ sessionId: a.execution?.cacheKey, transport: 'sse', reasoning: 'high' });
    expect(requests[1].options.sessionId).toBe(requests[0].options.sessionId);
    expect(a.execution?.sessionId).not.toBe(b.execution?.sessionId);
    const transcripts = await Promise.all(managers.map(manager => readFile(manager.getSessionFile()!, 'utf8')));
    expect(transcripts).toHaveLength(2);
    for (const transcript of transcripts) {
      const messages = transcript.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'message');
      expect(messages.map(entry => entry.message.role)).toEqual(['user', 'user', 'assistant']);
      expect(messages[0].message.content).toEqual(context.toPiMessages()[0].content);
      expect(messages[0].message.content.every((block: { type: string }) => block.type === 'text')).toBe(true);
    }
  } finally { runtime.dispose(); spy.mockRestore(); await rm(cwd, { recursive: true, force: true }); }
});

it('uses normal shell/read tools in the pinned checkout, persists their transcript, and removes the checkout', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'eval-repository-sdk-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  const requests: any[] = [], managers: SessionManager[] = [];
  const create = SessionManager.create.bind(SessionManager);
  const spy = vi.spyOn(SessionManager, 'create').mockImplementation(root => {
    const manager = create(root, path.join(cwd, 'sessions')); managers.push(manager); return manager;
  });
  const model = { id: 'gpt-6-sol', name: 'Offline test', provider: 'openai-codex', api: 'openai-codex-responses',
    baseUrl: 'http://offline.invalid', reasoning: true, input: ['text'], contextWindow: 272000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<any>;
  const calls = [
    { name: 'bash', arguments: { command: 'pwd\nrg --files\nrg -n Diagram core.ts' } },
    { name: 'read', arguments: { path: 'core.ts', offset: 1, limit: 1 } }
  ];
  const provider = {
    hasConfiguredAuth: () => true, isUsingOAuth: () => false, getModel: () => model, getAvailableSnapshot: () => [model],
    streamSimple: (_model: unknown, history: any) => {
      const call = calls[requests.length]; requests.push(JSON.parse(JSON.stringify(history)));
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
        content: call ? [{ type: 'toolCall', id: `call-${requests.length}`, ...call }] : [{ type: 'text', text: '{"ascii":"Diagram"}' }],
        stopReason: call ? 'toolUse' : 'stop', timestamp: Date.now(),
        usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: 'done', reason: message.stopReason as 'toolUse' | 'stop', message }); stream.end(message); return stream;
    }
  } as unknown as ModelRuntime;
  class OfflineRuntime extends AgentContextEvalRuntime {
    protected async model() { return { runtime: provider, model, provider: model.provider, modelId: model.id }; }
  }
  const runtime = new OfflineRuntime(cwd, true);
  try {
    await writeFile(path.join(cwd, 'core.ts'), 'export class Diagram {}');
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture');
    const descriptor = repositoryContextSchema.parse({ type: 'repository', repositoryPath: cwd, commit: git('rev-parse', 'HEAD'), exclusions: [], task: 'Identify the core' });
    const context = AgentContext.fromMessages('repository', [{ role: 'user', timestamp: 0, content: [descriptor] }]);
    const response = await runtime.generate({ workflow: 'alternatives', stage: 'alternative', model: model.id, effort: 'high',
      prompt: 'Discover the core. Return JSON with ascii.', files: { 'context.json': { snapshot: context.toSnapshot() } },
      schema: z.object({ ascii: z.string() }), signal: new AbortController().signal });
    expect(response.output).toEqual({ ascii: 'Diagram' });
    expect(response.execution?.contextHash).toBe(context.contentHash);
    expect(response.execution?.repositories?.[0]).toMatchObject({ commit: descriptor.commit,
      inspectionSource: 'session-transcript' });
    expect(response.usage?.input).toBe(30);
    const transcript = await readFile(managers[0].getSessionFile()!, 'utf8');
    const messages = transcript.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'message').map(entry => entry.message);
    expect(messages.filter(message => message.role === 'toolResult')).toHaveLength(2);
    expect(messages.filter(message => message.role === 'toolResult').every(message => !message.isError)).toBe(true);
    const supplied = JSON.parse(messages[0].content[0].text);
    expect(supplied.commit).toBe(descriptor.commit);
    expect(messages.find(message => message.role === 'toolResult' && message.toolName === 'bash').content[0].text).toContain(supplied.checkout);
    expect(messages.find(message => message.role === 'toolResult' && message.toolName === 'read').content[0].text).toContain('export class Diagram {}');
    expect(response.execution?.repositories?.[0].checkout).toBe(supplied.checkout);
    expect(JSON.stringify(requests[0])).not.toContain('export class Diagram');
    await expect(readFile(path.join(supplied.checkout, 'core.ts'))).rejects.toThrow();
  } finally { runtime.dispose(); spy.mockRestore(); await rm(cwd, { recursive: true, force: true }); }
});
