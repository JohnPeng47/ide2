import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DiagramStore } from '../../persistence/store';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (accept(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for CLI server/process state');
}
// /proc lets the integration test observe actual descendants, including tsserver's workers.
async function descendants(pid: number): Promise<Array<{ pid: number; command: string }>> {
  const children = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => '')).trim().split(/\s+/).filter(Boolean).map(Number);
  return (await Promise.all(children.map(async child => [{ pid: child, command: await readFile(`/proc/${child}/cmdline`, 'utf8').catch(() => '') }, ...await descendants(child)]))).flat();
}
const languageProcesses = (processes: Array<{ pid: number; command: string }>) => processes.filter(({ command }) => /typescript-language-server|[/\\](?:tsserver|_typingsInstaller)\.js/.test(command));
async function start(enabled: boolean) {
  const root = await mkdtemp(path.join(tmpdir(), 'lsp-startup-test-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.git'));
  const store = new DiagramStore(root);
  const project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: path.join(root, '.git') });
  const source = 'function answer() { return 42; }\nanswer();\n';
  await writeFile(path.join(root, 'main.ts'), source);
  const port = await new Promise<number>(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)); }); });
  const child = spawn(process.execPath, ['scripts/dev/start-server.mjs', ...(enabled ? ['--lsp'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_LSP: '1', VITE_LSP_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; };
  cleanup.push(stop);
  const url = `http://127.0.0.1:${port}`;
  await until(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
    return fetch(`${url}/api/core/project/source?${new URLSearchParams({ projectId: project.id, path: 'main.ts' })}`).then(response => response.ok ? response.json() : null).catch(() => null);
  }, value => value !== null);
  const request = () => fetch(`${url}/api/core/project/definitions`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: project.id, path: 'main.ts', position: { line: 1, character: 2 }, sourceSha256: createHash('sha256').update(source).digest('hex') }) });
  return { root, child, stop, request, url, project, output: () => output };
}

it('default CLI startup ignores inherited opt-ins and blocks requests without spawning a language server', async () => {
  const { child, request, url, project, output } = await start(false);
  expect(output()).toContain('LSP disabled');
  for (let i = 0; i < 3; i++) {
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'LSP_DISABLED' });
  }
  const source = await (await fetch(`${url}/api/core/project/source?${new URLSearchParams({ projectId: project.id, path: 'main.ts' })}`)).json();
  expect(source.lspEnabled).toBe(false);
  expect((await fetch(`${url}/api/core/project/files?${new URLSearchParams({ projectId: project.id, path: '' })}`)).ok).toBe(true);
  if (process.platform === 'linux') expect(languageProcesses(await descendants(child.pid!))).toEqual([]);
}, 30000);

it('explicit --lsp starts lazily, shares the session, resolves definitions, and stops child processes with the server', async () => {
  const { child, request, stop, url, project, output } = await start(true);
  expect(output()).toContain('LSP enabled');
  const source = await (await fetch(`${url}/api/core/project/source?${new URLSearchParams({ projectId: project.id, path: 'main.ts' })}`)).json();
  expect(source.lspEnabled).toBe(true);
  if (process.platform === 'linux') expect(languageProcesses(await descendants(child.pid!))).toEqual([]);
  expect(await (await request()).json()).toMatchObject({ locations: [{ path: 'main.ts', range: { start: { line: 0, character: 9 } } }] });
  const processes = process.platform === 'linux' ? languageProcesses(await descendants(child.pid!)) : [];
  if (process.platform === 'linux') expect(processes.length).toBeGreaterThanOrEqual(2);
  expect((await request()).ok).toBe(true);
  if (process.platform === 'linux') expect(languageProcesses(await descendants(child.pid!)).map(p => p.pid)).toEqual(processes.map(p => p.pid));
  await stop();
  if (process.platform === 'linux') await until(async () => (await Promise.all(processes.map(async ({ pid }) => {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    return stat && !stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  }))).some(Boolean), alive => !alive);
}, 40000);
