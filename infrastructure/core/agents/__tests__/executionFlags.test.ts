import { afterEach, expect, it, vi } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { PiMappingAgentRuntime } from '../../../mapping/agents/selection/agentRuntime';
import { PiDiagramEditRuntime } from '../../../mapping/agents/diagram-edit/diagramEditRuntime';
import { PiFileCompactionRuntime } from '../../../mapping/agents/compaction/fileCompactionRuntime';
import { CodexLocalChatRuntime } from '../../../mapping/agents/chat/localChatRuntime';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn()
}));
afterEach(() => vi.restoreAllMocks());

it('denies every real AI entry point by default before reading inputs or creating resources', async () => {
  const createModel = vi.spyOn(ModelRuntime, 'create');
  const selection = new PiMappingAgentRuntime();
  const edit = new PiDiagramEditRuntime('/tmp');
  const compaction = new PiFileCompactionRuntime();
  const chat = new CodexLocalChatRuntime();
  const disabled = { code: 'ai-disabled', message: expect.stringContaining('--pi') };
  await expect(selection.promptDiagramSelection(undefined!)).rejects.toMatchObject(disabled);
  await expect(edit.generate(undefined!, undefined!)).rejects.toMatchObject(disabled);
  await expect(compaction.openSession(undefined!)).rejects.toMatchObject(disabled);
  await expect(chat.reply(undefined!, undefined!)).rejects.toMatchObject(disabled);
  expect(createModel).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  selection.dispose(); edit.dispose(); compaction.dispose(); chat.dispose();
});

it('denies selection requests even when a cached session is available', async () => {
  const runtime = new PiMappingAgentRuntime();
  const prompt = vi.fn();
  // Exercise the session reuse path: no model setup would be needed to spend credits.
  const sessions = (runtime as unknown as { mappingPocSessions: Map<string, unknown> }).mappingPocSessions;
  sessions.set('cached', { session: { prompt, abort: vi.fn(), dispose: vi.fn() } });
  await expect(runtime.promptDiagramSelection({ clientSessionId: 'cached' } as Parameters<typeof runtime.promptDiagramSelection>[0]))
    .rejects.toMatchObject({ code: 'ai-disabled' });
  expect(prompt).not.toHaveBeenCalled();
  sessions.clear(); runtime.dispose();
});
