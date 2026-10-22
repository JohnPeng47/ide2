import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'workspace-save-browser-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Workspace save\n`-- Preserved content', nodes: [] });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const { port } = socket.address(); socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: '.diagrams' }, stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', data => { errors += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${errors}`); });
  const manifest = async () => JSON.parse(await readFile(path.join(root, '.diagrams/workspace-records.json'), 'utf8'));
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(() => {
          const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && ${text ? `e.textContent.trim() === ${JSON.stringify(text)}` : 'true'});
          if (!element) return null;
          const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          return r.width && r.height && element.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
        })()`); return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const saved = () => waitFor(async () => evaluate(cdp, `!document.querySelector('.mapping-transfer-busy') && document.querySelector('.mapping-menu-status')?.textContent === 'Workspace saved'`));
    await click('button', 'Menu');
    await click('input[aria-label="Diagram name"]');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.insertText', { text: 'Saved workspace name' });
    await click('button', 'Save workspace'); await saved();
    const before = await manifest();
    const started = performance.now();
    await click('button', 'Save workspace'); await saved();
    assert.equal((await manifest()).revision, before.revision, 'An unchanged save must not publish another workspace revision');
    console.log(`Unchanged save completed in ${Math.round(performance.now() - started)} ms without a write`);
    const origin = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => {
      try { return await evaluate(cdp, `performance.timeOrigin !== ${origin} && document.readyState === 'complete'`); } catch { return false; }
    });
    await click('button', 'Menu');
    await waitFor(async () => evaluate(cdp, `document.querySelector('input[aria-label="Diagram name"]')?.value === 'Saved workspace name'`));
    await click('button', 'Save workspace'); await saved();
    const reopened = await manifest();
    await click('button', 'Save workspace'); await saved();
    assert.equal((await manifest()).revision, reopened.revision, 'Restored histories must also support a no-op save');
    console.log('Workspace save, unchanged save, and persisted name after reload verified');
  });
} finally {
  if (server && server.exitCode === null) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill(); await closed; }
  await rm(root, { recursive: true, force: true });
}
