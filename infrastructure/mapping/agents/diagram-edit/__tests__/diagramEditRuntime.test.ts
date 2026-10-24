import { AgentContext } from '../../../../../domain/core/agents/agentContext';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiagramGenerationRequest } from '../../../../../domain/core/diagrams/diagramGeneration';
import { revisionFixture } from '../../../../../tests/support/diagramRevisions';

type Tool = { execute(id: string, candidate: unknown): Promise<{ details: { accepted: boolean } }> };
const harness = vi.hoisted(() => ({
  actions: [] as ((tool: Tool) => Promise<void>)[],
  chats: [] as { history: unknown[]; prompts: string[]; abort: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[]
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: async () => ({ getModel: (_provider: string, id: string) => ({ id }), hasConfiguredAuth: () => true }) },
  DefaultResourceLoader: class { async reload() {} }, getAgentDir: () => '/tmp',
  SessionManager: { create: () => ({ messages: [] as unknown[], appendMessage(message: unknown) { this.messages.push(message); } }) }, SettingsManager: { inMemory: () => ({}) }, defineTool: (tool: unknown) => tool,
  createAgentSession: async (options: { customTools: Tool[]; sessionManager: { messages: unknown[] } }) => {
    const chat = { history: structuredClone(options.sessionManager.messages), prompts: [] as string[], abort: vi.fn(async () => {}), dispose: vi.fn() };
    const messages = structuredClone(chat.history);
    const tool: Tool = { execute: async (id, candidate) => {
      messages.push({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'submit_diagram', arguments: candidate }] });
      const result = await options.customTools[0].execute(id, candidate);
      messages.push({ role: 'toolResult', toolCallId: id, toolName: 'submit_diagram', content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
      return result;
    } };
    harness.chats.push(chat);
    return { session: { sessionId: 'test', messages, ...chat, subscribe: () => () => {}, prompt: async (text: string) => {
      chat.prompts.push(text); messages.push({ role: 'user', content: text }); await harness.actions.shift()?.(tool);
    } } };
  }
}));
import { PiDiagramEditRuntime, renderDiagramEditPrompt } from '../diagramEditRuntime';
afterEach(() => { harness.actions.length = 0; harness.chats.length = 0; vi.clearAllMocks(); });
function fixture() {
  const runtime = new PiDiagramEditRuntime('/tmp', true), service = revisionFixture(runtime);
  const base = service.create({ id: crypto.randomUUID(), revision: 0, ascii: 'Original' });
  const request: DiagramGenerationRequest = { input: { id: base.diagram.id }, instruction: 'Add a child', baseRevisionId: base.revision.id,
    context: { diagram: base.diagram, selection: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 8 } } };
  return { runtime, service, base, request };
}
it('corrects rejected submissions in one agent session and issues only the validated revision', async () => {
  const f = fixture();
  harness.actions.push(async tool => {
    expect((await tool.execute('blank', { ascii: ' ', structureKind: 'tree', mappings: [] })).details.accepted).toBe(false);
    expect((await tool.execute('unknown-source', { ascii: 'Root', structureKind: 'tree', mappings: [
      { id: 'm', entityId: 'invented', sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 4 }
    ] })).details.accepted).toBe(false);
    expect(f.service.listRevisions(f.base.diagram.diagramId)).toHaveLength(1);
    expect((await tool.execute('valid', { ascii: 'Root\n`-- Child', structureKind: 'tree', mappings: [] })).details.accepted).toBe(true);
  });
  const result = await f.service.generate(f.request);
  expect(result.diagram.content.ascii).toBe('Root\n`-- Child');
  expect(result.revision.parentId).toBe(f.base.revision.id);
  expect(f.service.listRevisions(f.base.diagram.diagramId)).toHaveLength(2);
  expect(harness.chats[0].prompts[0]).toContain(f.base.revision.id);
  expect(harness.chats[0].prompts[0]).toContain('Add a child');
  expect(harness.chats[0].dispose).toHaveBeenCalledOnce(); f.runtime.dispose();
});

it('captures and reuses the full successful transcript, including tool results', async () => {
  const f = fixture(), captured = vi.fn(), session = vi.fn();
  harness.actions.push(async tool => { await tool.execute('first', { ascii: 'First', structureKind: 'tree', mappings: [] }); });
  await f.service.generate({ ...f.request, llmSessionId: 'panel' }, { onAgentContext: captured, onAgentSession: session });
  expect(session).toHaveBeenCalledWith('test');
  const first = captured.mock.calls[0][0];
  expect(first.source.sourceSessionId).toBe('panel');
  expect(first.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'toolResult']);
  harness.actions.push(async tool => { await tool.execute('second', { ascii: 'Second', structureKind: 'tree', mappings: [] }); });
  await f.service.generate({ ...f.request, llmSessionId: 'panel', agentContext: first, instruction: 'Continue the previous request' }, { onAgentContext: captured });
  expect(harness.chats[1].history).toEqual(AgentContext.fromSnapshot(first).toPiMessages());
  expect(captured.mock.calls[1][0].messages).toHaveLength(6);
  expect(captured.mock.calls[1][0].messages.slice(0, 3)).toEqual(expect.arrayContaining(first.messages.map((m: object) => expect.objectContaining(m))));
  await expect(f.service.generate({ ...f.request, llmSessionId: 'panel', agentContext: first }, { onAgentContext: captured })).rejects.toThrow('without a validated submission');
  expect(captured).toHaveBeenCalledTimes(2);
  f.runtime.dispose();
});
it('requires a validated submission and cleans up on cancellation', async () => {
  const f = fixture();
  await expect(f.service.generate(f.request)).rejects.toThrow('without a validated submission');
  expect(harness.chats[0].dispose).toHaveBeenCalledOnce();
  const abort = new AbortController();
  harness.actions.push(async () => { abort.abort(Error('cancelled')); });
  await expect(f.service.generate(f.request, { signal: abort.signal })).rejects.toThrow('cancelled');
  expect(harness.chats[1].abort).toHaveBeenCalledOnce(); expect(harness.chats[1].dispose).toHaveBeenCalledOnce();
  expect(f.service.listRevisions(f.base.diagram.diagramId)).toHaveLength(1); f.runtime.dispose();
});
it('renders prompt values once, preserving literal template markers in user content', () => {
  const f = fixture(), markdown = 'CONTEXT {{context}}\nREFS {{references}}\nSTYLE {{options.style}} {{options.detail}}\nINSTRUCTION {{instruction}}';
  const parameters = [{ kind: 'enum' as const, key: 'style', options: [{ value: 'minimal', guidance: 'Fewest boxes.' }] }, { kind: 'number' as const, key: 'detail' }];
  const prompt = { markdown, options: { style: 'minimal', detail: 2 }, parameters, references: [{ ref: 1, label: '{{instruction}}' }] };
  const result = renderDiagramEditPrompt({ ...f.request, prompt, instruction: '{{context}}\nKeep this literal' });
  expect(result).toContain('INSTRUCTION "{{context}}\\nKeep this literal"');
  expect(result).toContain('STYLE Fewest boxes. 2');
  expect(result).toContain('REFS [{"ref":1,"label":"{{instruction}}"}]');
  expect(() => renderDiagramEditPrompt({ ...f.request, prompt: { ...prompt, markdown: `${markdown} {{unknown}}` } })).toThrow('Unknown');
  expect(renderDiagramEditPrompt(f.request)).toContain(f.base.revision.id);
  f.runtime.dispose();
});

it('seeds uploaded trajectory before the current task and starts a fresh history for each run', async () => {
  const f = fixture();
  const context = AgentContext.fromTrajectory({ agentType: 'claude', sourceSessionId: 'source', format: 'messages-v1',
    fromEntryId: 'one', throughEntryId: 'one', entries: [{ id: 'one', parentId: null,
      message: { role: 'user', content: [{ type: 'text', text: 'The new cache belongs to Workspace.' }] } }] });
  harness.actions.push(async tool => { await tool.execute('valid', { ascii: 'Workspace\n`-- Cache', structureKind: 'tree', mappings: [] }); });
  await f.service.generate({ ...f.request, agentContext: context.toSnapshot() });
  expect(harness.chats[0].history).toEqual(context.toPiMessages());
  expect(harness.chats[0].prompts).toHaveLength(1);
  expect(harness.chats[0].prompts[0]).toContain('Add a child');
  await expect(f.service.generate(f.request)).rejects.toThrow('without a validated submission');
  expect(harness.chats[1].history).toEqual([]);
  expect(context.toSnapshot().messages).toHaveLength(1);
  f.runtime.dispose();
});

it.each(['edit-diagram', 'create-diagram', 'extend-diagram'] as const)('ends the condensed %s prompt with the output contract', operation => {
  const f = fixture();
  const prompt = renderDiagramEditPrompt({ ...f.request, operation });
  const output = prompt.slice(prompt.lastIndexOf('# OUTPUT FORMAT'));
  expect(prompt).toContain('## User instruction (JSON string)');
  expect(output).toContain('## ASCII and structure');
  expect(output).toContain('## Source mappings');
  expect(output).toContain('## Submission');
  expect(output).toContain('Omit mappings');
  expect(output).not.toContain('requestId');
  expect(prompt.endsWith('Never claim success without submitting.')).toBe(true);
  expect(prompt).not.toContain('Preserve logical node identities: append');
  const enabled = renderDiagramEditPrompt({ ...f.request, operation, sourceMappings: true });
  expect(enabled).toContain('complete array');
  expect(enabled).toContain('Use only supplied evidence IDs');
  if (operation !== 'edit-diagram') {
    expect(prompt).toContain('Do not use [[keep:...]]');
    expect(prompt).not.toContain('You may choose whether to preserve node continuity');
  }
});
