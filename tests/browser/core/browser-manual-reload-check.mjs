import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { reloadTrigger } = await tsImport('../../../scripts/dev/manual-reload.ts', import.meta.url);
const { launchHeadlessBrowser, evaluate, waitFor } = await import(
  pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href
);
const temp = await mkdtemp(path.join(tmpdir(), 'manual-reload-check-'));
const children = [];
const browsers = [];
const directories = [path.join(temp, 'project'), path.join(temp, 'other-worktree')];
const plugin = path.join(root, 'scripts/dev/manual-reload.ts');
const cli = path.join(root, 'scripts/dev/reload-server.ts');
const tsx = import.meta.resolve('tsx');
const vite = import.meta.resolve('vite');

function config(revision) {
  return `import { manualReload } from ${JSON.stringify(plugin)};
export default {
  plugins: [manualReload(), {
    name: 'fixture-api',
    configureServer(server) {
      server.middlewares.use('/revision', (_req, res) => res.end('${revision}'));
    }
  }],
  server: { host: '127.0.0.1', port: 0 },
  optimizeDeps: { noDiscovery: true }
};`;
}

async function start(cwd) {
  const child = spawn(process.execPath, ['--import', tsx, '--input-type=module', '-e', `
    import { createServer } from ${JSON.stringify(vite)};
    const server = await createServer();
    await server.listen();
    console.log('READY:' + server.resolvedUrls.local[0]);
    server.watcher.on('change', file => console.log('CHANGED:' + file));
    process.on('SIGTERM', async () => { await server.close(); process.exit(); });
  `], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  await waitFor(() => {
    if (child.exitCode !== null) throw new Error(output);
    return output.includes('READY:');
  }, { timeoutMs: 20000, message: 'Fixture server did not start' });
  return { url: output.match(/READY:(\S+)/)[1], output: () => output };
}

async function reload(cwd) {
  const child = spawn(process.execPath, ['--import', tsx, cli], { cwd, stdio: 'inherit' });
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0);
}

try {
  for (const directory of directories) {
    await mkdir(directory);
    await writeFile(path.join(directory, 'vite.config.mts'), config('before'));
    await writeFile(path.join(directory, 'index.html'), '<input autofocus><p id="value"></p><script type="module" src="/main.js"></script>');
    await writeFile(path.join(directory, 'main.js'), `
      sessionStorage.loads = Number(sessionStorage.loads || 0) + 1;
      document.querySelector('#value').textContent = 'before';
    `);
  }
  const servers = await Promise.all([start(directories[0]), start(directories[0]), start(directories[1])]);
  for (const server of servers) {
    const browser = await launchHeadlessBrowser({
      url: server.url,
      ...(process.env.CHROME_PATH ? { chromePath: process.env.CHROME_PATH } : {}),
      arguments: ['--no-sandbox'],
    });
    browsers.push(browser);
    await waitFor(() => evaluate(browser.cdp, 'document.querySelector("#value")?.textContent === "before"'));
    await browser.cdp.send('Input.insertText', { text: 'unsaved progress' });
  }
  await writeFile(path.join(directories[0], 'main.js'), `
    sessionStorage.loads = Number(sessionStorage.loads || 0) + 1;
    document.querySelector('#value').textContent = 'after';
  `);
  await writeFile(path.join(directories[0], 'vite.config.mts'), config('after'));
  await waitFor(() => servers.slice(0, 2).every(server => server.output().includes('CHANGED:')));
  // Observe a bounded quiet period: absence of automatic reload is the assertion.
  const quietUntil = Date.now() + 1000;
  await waitFor(async () => {
    for (const browser of browsers) {
      assert.deepEqual(await evaluate(browser.cdp, '[sessionStorage.loads, document.querySelector("#value").textContent, document.querySelector("input").value]'),
        ['1', 'before', 'unsaved progress']);
    }
    return Date.now() >= quietUntil;
  });
  await reload(directories[0]);
  for (let i = 0; i < 2; i++) {
    await waitFor(() => evaluate(browsers[i].cdp, 'sessionStorage.loads === "2" && document.querySelector("#value")?.textContent === "after"'), { timeoutMs: 20000 });
    assert.equal(await (await fetch(`${servers[i].url}revision`)).text(), 'after');
  }
  assert.deepEqual(await evaluate(browsers[2].cdp, '[sessionStorage.loads, document.querySelector("input").value]'), ['1', 'unsaved progress']);
  // A second request confirms the trigger remains attached after restarting.
  await reload(directories[0]);
  for (const browser of browsers.slice(0, 2)) {
    await waitFor(() => evaluate(browser.cdp, 'sessionStorage.loads === "3"'), { timeoutMs: 20000 });
  }
  assert.equal(await evaluate(browsers[2].cdp, 'sessionStorage.loads'), '1');
  console.log('PASS: edits preserve progress; manual reload updates both cwd instances and backend config; other worktree stays untouched; repeated reload works.');
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    timer.unref();
  })));
  await Promise.all(directories.map(directory => rm(reloadTrigger(directory), { force: true })));
  await rm(temp, { recursive: true, force: true });
}
