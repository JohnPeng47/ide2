import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from './browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'unmapped-selection-'));
let server;
const ascii = 'Workbench renderer\n|-- EditorPart\n`-- View\n   \nEnd';
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100 }, async ({ cdp }) => {
    const click = async selector => {
      const point = typeof selector === 'string' ? await evaluate(cdp, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`) : selector;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const select = async (line = 2, endColumn = 14, reverse = false, cancel = false) => {
      const points = await evaluate(cdp, `(() => {
        const el = document.querySelector('[data-grid-box="overview"]'), r = el.getBoundingClientRect();
        const w = r.width / Number(el.dataset.gridColumns), h = r.height / Number(el.dataset.gridRows);
        return {start: {x: r.left + w*.5, y: r.top + h*(${line}-.5)}, end: {x: r.left + w*(${endColumn}-.5), y: r.top + h*(${line}-.5)}};
      })()`);
      if (reverse) [points.start, points.end] = [points.end, points.start];
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, modifiers: 2, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.end, button: 'left', buttons: 1, modifiers: 2 });
      if (cancel) await key('Escape', 'Escape', 27);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', modifiers: 2, clickCount: 1 });
      if (cancel) await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-poc-selection-menu") && !document.querySelector(".mapping-poc-selection-rect")'));
      else await waitForSelector(cdp, '.mapping-poc-selection-menu');
    };
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-canvas__surface')?.style.transform.includes('translate3d(')`));
    assert.equal(await evaluate(cdp, 'document.querySelectorAll("[data-selectable-node]").length'), 0);
    // Capture the clipboard boundary without changing the user's OS clipboard.
    await evaluate(cdp, `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedAscii = text; } } })`);
    await key('a', 'KeyA', 65);
    await key('c', 'KeyC', 67);
    assert.equal(await evaluate(cdp, '!!document.querySelector(".local-chat-ask-form") || window.__copiedAscii !== undefined'), false);
    await select(2, 14, false, true); // Escape during the drag must survive pointer release.
    await select();
    assert.match(await evaluate(cdp, 'document.querySelector(".mapping-poc-selection-menu").textContent'), /Region selected · no code entities/);
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-poc-selection-actions button[aria-keyshortcuts=P]").disabled'), true);
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-poc-selection-actions button[aria-keyshortcuts=N]").disabled'), true);
    await click('.mapping-poc-selection-actions button:first-child');
    await waitFor(async () => await evaluate(cdp, 'window.__copiedAscii?.startsWith("|-- EditorPart\\n")'));
    await key('Escape', 'Escape', 27);
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-poc-selection-menu") && !document.querySelector(".mapping-poc-selection-rect")'));
    await select(4, 1); // A single blank cell is a valid rectangle.
    await key('c', 'KeyC', 67);
    await waitFor(async () => await evaluate(cdp, 'window.__copiedAscii?.startsWith(" ")'));
    await key('Escape', 'Escape', 27);
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-poc-selection-menu")'));
    await select(4, 3, true); // Reversed whitespace-only drags normalize the rectangle.
    await click({ x: 10, y: 10 });
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-poc-selection-menu")'));
    await select();
    await key('a', 'KeyA', 65);
    await waitForSelector(cdp, '.local-chat-ask-form textarea');
    assert.equal(await evaluate(cdp, 'document.querySelector(".local-chat-ask-form button[type=submit]").disabled'), true);
    await click('.local-chat-ask-form textarea');
    await cdp.send('Input.insertText', { text: 'Explain this diagram region.' });
    await click('.local-chat-ask-form button[type=submit]');
    await waitForSelector(cdp, '[data-local-chat-role=assistant]', { timeoutMs: 10000 });
    assert.match(await evaluate(cdp, 'document.querySelector("[data-local-chat-role=assistant]").textContent'), /0 source ranges/);
    await click('.mapping-workspace-actions button:first-child');
    await waitFor(async () => {
      const workspace = await (await fetch(`${url}/api/mapping/workspace`)).json();
      const conversation = Object.values(workspace?.documents[0].canvas.display.nodes ?? {}).find(node => node.kind === 'conversation');
      return conversation?.thread.selection.nodeIds.length === 0 && conversation.thread.messages.length === 2;
    });
    console.log('Unmapped interactions and persisted conversation passed; checking reload.');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForSelector(cdp, '[data-local-chat-role=assistant]', { timeoutMs: 30000 });

    console.log('Unmapped selection passed: rectangle/menu, copy, Escape during/after drag, empty Ask disabled, no-selection shortcuts, single blank cell, reversed whitespace drag, outside click, Ask without source ranges, and save/reload.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
