import path from 'node:path';
import { expect, it } from 'vitest';
import { StdioCodexConnection } from './codexConnection';

it('initializes a real stdio peer, handles streaming RPC requests and interrupts', async () => {
  const client = new StdioCodexConnection(process.cwd(), true, path.resolve('tests/support/codex-app-server.mjs'));
  try {
    let resolve!: () => void;
    const completed = new Promise<void>(done => { resolve = done; });
    const deltas: string[] = [];
    client.subscribe(message => {
      if (message.method === 'item/commandExecution/requestApproval') client.respond(message.id!, { decision: 'decline' });
      if (message.method === 'item/agentMessage/delta') deltas.push(String(message.params.delta));
      if (message.method === 'turn/completed') resolve();
    }, () => {});
    const result = await client.request<{ thread: { id: string } }>('thread/start', {});
    await client.request('turn/start', { threadId: result.thread.id, input: [{ type: 'text', text: 'approval' }] });
    await completed;
    expect(deltas.join('')).toContain('decline');
  } finally { client.dispose(); }
});

it('reports a missing executable and enforces the existing AI execution flag', async () => {
  const disabled = new StdioCodexConnection(process.cwd(), false);
  await expect(disabled.request('model/list', {})).rejects.toThrow('AI execution is disabled');
  const missing = new StdioCodexConnection(process.cwd(), true, '/nonexistent/new-diagram-codex');
  try { await expect(missing.request('model/list', {})).rejects.toThrow('Cannot start Codex'); } finally { missing.dispose(); }
});
