import { expect, it, vi } from 'vitest';
import { DiffSessionWorkflowService, type DiffSessionRun, type DiffSessionRunStore } from '../diffSessionWorkflowService';
import type { DiffSessionRuntime } from '../diffSessionWorkflow';

function setup(fail = false, hold = false) {
  const records = new Map<string, DiffSessionRun>(), artifacts = new Map<string, unknown>();
  const store: DiffSessionRunStore = {
    async create(run) { if (records.has(run.id)) return false; records.set(run.id, structuredClone(run)); return true; },
    async read(id) { return structuredClone(records.get(id)); },
    async save(run) { records.set(run.id, structuredClone(run)); },
    async artifact(_id, name, value) { artifacts.set(name, structuredClone(value)); }
  };
  const dispose = vi.fn(), turns: string[] = [];
  const runtime: DiffSessionRuntime = { dispose: vi.fn(), openSession: vi.fn(async (input: Parameters<DiffSessionRuntime['openSession']>[0]) => ({
    sessionId: 'one-session', dispose, transcript: () => turns,
    async runStep(request: import('../../../core/agents/agentWorkflow').AgentStepRequest) {
      turns.push(request.stepId);
      if (hold) await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }));
      if (request.stepId === 'analyze') return { text: 'Complete analysis' };
      const create = input.tools('materialize').find(tool => tool.name === 'create_diagram_change_session')!;
      await create.execute({});
      if (fail) throw Error('Model connection lost');
      return { text: 'Created', changeSessionId: 'generated' };
    }
  })) };
  const changes = { capture: vi.fn(async () => ({ projectId: 'project', documents: [], hunks: [{ id: 'hunk' }],
    context: { repositoryId: 'repo', head: 'head', commits: ['head'] } })),
    create: vi.fn(async () => ({ changeSessionId: 'generated' })), get: vi.fn(async () => ({ id: 'generated', status: 'ready' })) };
  const service = new DiffSessionWorkflowService(changes as any, {} as any, runtime, store,
    { enabled: true, sourceRoot: '/fixture', loadPrompts: async () => ({ analyze: 'Analyze', materialize: 'Create' }), sourceReader: async () => async () => ({}) });
  return { service, runtime, artifacts, records, turns, dispose, changes };
}
const request = { requestId: 'one', title: 'Proposal', baselineChangeSessionId: 'original' };
it('persists two sequential user requests and one conversation; replay does not run twice', async () => {
  const f = setup();
  const [run, replay] = await Promise.all([f.service.start(request), f.service.start(request)]);
  expect(run.id).toBe(replay.id);
  await vi.waitFor(() => expect(f.records.get(run.id)?.status).toBe('completed'));
  expect(f.turns).toEqual(['analyze', 'materialize']); expect(f.runtime.openSession).toHaveBeenCalledTimes(1);
  expect(f.artifacts.get('conversation')).toEqual(f.turns);
  expect(f.artifacts.get('analyze-request')).toMatchObject({ role: 'user' });
  expect(f.artifacts.get('materialize-request')).toEqual({ role: 'user', content: 'Create' });
  expect((await f.service.start(request)).changeSessionId).toBe('generated');
  await expect(f.service.start({ ...request, title: 'Different' })).rejects.toThrow('REQUEST_ID_CONFLICT');
  expect(f.dispose).toHaveBeenCalledOnce(); f.service.dispose();
});
it('retains a partial proposal and transcript when materialization fails', async () => {
  const f = setup(true), run = await f.service.start(request);
  await vi.waitFor(() => expect(f.records.get(run.id)?.status).toBe('failed'));
  expect(await f.service.get(run.id)).toMatchObject({ changeSessionId: 'generated', error: 'Model connection lost' });
  expect(f.artifacts.has('conversation')).toBe(true); expect(f.dispose).toHaveBeenCalledOnce(); f.service.dispose();
});
it('cancellation stops the first turn without creating a proposal', async () => {
  const f = setup(false, true), run = await f.service.start(request);
  await vi.waitFor(() => expect(f.turns).toEqual(['analyze']));
  await f.service.cancel(run.id);
  await vi.waitFor(() => expect(f.records.get(run.id)?.status).toBe('cancelled'));
  expect(f.changes.create).not.toHaveBeenCalled(); expect(f.dispose).toHaveBeenCalledOnce(); f.service.dispose();
});
