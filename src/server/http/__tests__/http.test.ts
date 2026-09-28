import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { readBody, RequestTooLarge, sendJson } from '../http';

it('returns a readable 413 without dropping the connection, then accepts another request', async () => {
  const server = createServer(async (request, response) => {
    try { sendJson(response, 200, await readBody(request, 1024)); }
    catch (error) { sendJson(response, error instanceof RequestTooLarge ? 413 : 400, { error: (error as Error).message }); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const rejected = await fetch(url, { method: 'PUT', body: JSON.stringify({ data: 'x'.repeat(4096) }) });
    expect(rejected.status).toBe(413);
    expect((await rejected.json()).error).toContain('save limit');
    const accepted = await fetch(url, { method: 'PUT', body: '{"retry":true}' });
    expect(accepted.status).toBe(200); expect(await accepted.json()).toEqual({ retry: true });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
