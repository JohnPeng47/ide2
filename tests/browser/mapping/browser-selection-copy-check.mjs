import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'selection-copy-'));
let server;
const ascii = 'Root\n  |-- Long branch  \n\n  `-- Leaf\nOutside';
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100,
    chromePath: process.env.CHROME_PATH, arguments: process.platform === 'linux' ? ['--no-sandbox'] : [],
  }, async ({ cdp }) => {
    await waitForSelector(cdp, '[data-native-node="grid:overview"] pre');
    // Capture the clipboard boundary without changing the user's OS clipboard.
    await evaluate(cdp, `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedAscii = text; } } })`);
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const mouse = (type, point, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', {
      type, ...point, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, modifiers, clickCount: 1,
    });
    for (const reverse of [false, true]) {
      const points = await evaluate(cdp, `(() => {
        const el = document.querySelector('[data-grid-box="overview"]'), r = el.getBoundingClientRect();
        const w = r.width / Number(el.dataset.gridColumns), h = r.height / Number(el.dataset.gridRows);
        return [{x:r.left+w*6.5,y:r.top+h*1.5},{x:r.left+w*7.5,y:r.top+h*3.5}];
      })()`);
      if (reverse) points.reverse();
      await mouse('mousePressed', points[0], 2);
      for (let i = 1; i <= 5; i++) await mouse('mouseMoved', {
        x: points[0].x + (points[1].x - points[0].x) * i / 5,
        y: points[0].y + (points[1].y - points[0].y) * i / 5,
      }, 2);
      await mouse('mouseReleased', points[1], 2);
      await key('a', 'KeyA', 65);
      await waitForSelector(cdp, '.mapping-poc-selection-menu');
      if (reverse) await key('c', 'KeyC', 67, 2);
      else {
        const point = await evaluate(cdp, `(() => {const r=document.querySelector('button[aria-label="Copy ASCII + code refs"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await mouse('mousePressed', point);
        await mouse('mouseReleased', point);
      }
      await waitFor(async () => await evaluate(cdp, 'window.__copiedAscii !== undefined'));
      assert.equal(await evaluate(cdp, 'window.__copiedAscii'), '  |-- Long branch  \n\n  `-- Leaf\nAssociated Code Entities:',
        `${reverse ? 'Reversed drag and Ctrl+C' : 'Forward drag and Copy button'} copies whole rows in order, preserving whitespace`);
      await evaluate(cdp, 'delete window.__copiedAscii');
      await key('c', 'KeyC', 67);
      await waitFor(async () => await evaluate(cdp, 'window.__copiedAscii !== undefined'));
      assert.equal(await evaluate(cdp, 'window.__copiedAscii'), '  |-- Long branch  \n\n  `-- Leaf\nAssociated Code Entities:',
        `Plain C copies after opening the selection panel with focus on ${reverse ? 'the canvas' : 'its Copy button'}`);
      await key('Escape', 'Escape', 27);
      await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-poc-selection-menu")'));
      await evaluate(cdp, 'delete window.__copiedAscii');
    }
    console.log('Canvas row copy passed: narrow forward/reverse selections, Copy button, Ctrl+C, plain C with panel/canvas focus, indentation, blank lines, and trailing spaces.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
