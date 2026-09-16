import { expect, it } from 'vitest';
import { QuickJsAgentRuntime } from '../execRuntime';
it('executes against only the supplied API, supporting return values and loops', async () => {
  const runtime = new QuickJsAgentRuntime();
  expect(await runtime.run('return { globals: [typeof process, typeof fetch, typeof window, typeof require], result: nodes.list() };', async (method) => ({ method })))
    .toEqual({ globals: ['undefined','undefined','undefined','undefined'], result: { method: 'nodes.list' } });
});
it('interrupts runaway scripts and surfaces API errors', async () => {
  const runtime = new QuickJsAgentRuntime();
  await expect(runtime.run('while(true) {}', async () => null)).rejects.toThrow();
  await expect(runtime.run('return nodes.get({nodeId:"missing"});', async () => { throw new Error('Missing node'); })).rejects.toThrow('Missing node');
}, 35000);
