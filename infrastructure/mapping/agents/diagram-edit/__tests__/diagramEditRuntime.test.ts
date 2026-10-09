import { AgentContext } from '../../../../../domain/core/agents/agentContext';
import { afterEach, expect, it, vi } from 'vitest';
import { RevisionedDiagramService, type DiagramGenerationRequest } from '../../../../../domain/core/diagrams/diagramService';

type Tool = { execute(id: string, candidate: unknown): Promise<{ details: { accepted: boolean } }> };
const harness = vi.hoisted(() => ({
  actions: [] as ((tool: Tool) => Promise<void>)[],
  chats: [] as { history: unknown[]; prompts: string[]; abort: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[]
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: async () => ({ getModel: (_provider: string, id: string) => ({ id }), hasConfiguredAuth: () => true }) },
  DefaultResourceLoader: class { async reload() {} }, getAgentDir: () => '/tmp',
  SessionManager: { inMemory: () => ({ messages: [] as unknown[], appendMessage(message: unknown) { this.messages.push(message); } }) }, SettingsManager: { inMemory: () => ({}) }, defineTool: (tool: unknown) => tool,
  createAgentSession: async (options: { customTools: Tool[]; sessionManager: { messages: unknown[] } }) => {
    const chat = { history: structuredClone(options.sessionManager.messages), prompts: [] as string[], abort: vi.fn(async () => {}), dispose: vi.fn() };
    harness.chats.push(chat);
    return { session: { sessionId: 'test', ...chat, subscribe: () => () => {}, prompt: async (text: string) => {
      chat.prompts.push(text); await harness.actions.shift()?.(options.customTools[0]);
    } } };
  }
}));
import { PiDiagramEditRuntime, renderDiagramEditPrompt } from '../diagramEditRuntime';
afterEach(() => { harness.actions.length = 0; harness.chats.length = 0; vi.clearAllMocks(); });
function fixture() {
  const runtime = new PiDiagramEditRuntime('/tmp', true), service = new RevisionedDiagramService(runtime);
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
  const f = fixture(), template = 'CONTEXT {{context}}\nINSTRUCTION {{instruction}}';
  const result = renderDiagramEditPrompt(template, { ...f.request, instruction: '{{context}}\nKeep this literal' });
  expect(result).toContain('INSTRUCTION "{{context}}\\nKeep this literal"');
  expect(() => renderDiagramEditPrompt(`${template} {{unknown}}`, f.request)).toThrow('Unknown');
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
