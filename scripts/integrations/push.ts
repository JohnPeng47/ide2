import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  url: { type: 'string', default: 'http://127.0.0.1:5173' }, wait: { type: 'boolean', default: false }
} });
const [command, id, file] = positionals;
const token = process.env.NEW_DIAGRAM_PUSH_TOKEN;
if (!token) throw Error('Set NEW_DIAGRAM_PUSH_TOKEN (the same value as the application server)');
const base = `${values.url.replace(/\/$/, '')}/api/mapping/integrations`;
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
let result;
switch (command) {
  case 'connect':
    if (!id || !file) throw Error('Usage: connect <connection-id> <connection.json>');
    result = await request(`/connections/${encodeURIComponent(id)}`, 'PUT', JSON.parse(await readFile(file, 'utf8')));
    break;
  case 'connections': result = await request('/connections'); break;
  case 'push':
  case 'artifacts':
    if (!id || !file) throw Error(`Usage: ${command} <connection-id> <event.json> [--wait]`);
    result = await request(`/connections/${encodeURIComponent(id)}/${command === 'push' ? 'pushes' : 'artifacts'}`, 'POST', JSON.parse(await readFile(file, 'utf8')));
    break;
  case 'status':
    result = await request(id ? `/pushes/${encodeURIComponent(id)}` : '/pushes');
    break;
  default: throw Error('Commands: connect <id> <file>, connections, push|artifacts <id> <file>, status [push-id]. Options: --url <app-url>, --wait');
}
console.log(JSON.stringify(result, null, 2));
if (values.wait && result.id?.startsWith('push-')) {
  let previous = JSON.stringify(result);
  while (['resolving', 'running'].includes(result.status)) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    result = await request(`/pushes/${encodeURIComponent(result.id)}`);
    if (JSON.stringify(result) !== previous) {
      console.log(JSON.stringify(result, null, 2));
      previous = JSON.stringify(result);
    }
  }
  if (!['completed', 'skipped'].includes(result.status)) process.exitCode = 1;
}
