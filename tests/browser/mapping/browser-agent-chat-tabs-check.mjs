import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'chat-tabs-'));
const ascii = 'Root\n|-- Service\n|   `-- Worker\n`-- Other';
let server;
try {
  await seedMappingFixture(fixture, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAMS_DIR: path.join(fixture, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs); return (await fetch(base).catch(() => null))?.ok; }, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${base}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer; const error = Error(`CDP timeout: ${method} ${params?.expression?.slice(0, 100) ?? ''}`);
      return Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(error), 15000); })]).finally(() => clearTimeout(timer));
    };
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const errors = [], requests = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails));
    cdp.on('Network.requestWillBeSent', event => { if (/agent-chat\/sessions\/[^/]+\/send$/.test(event.request.url)) requests.push(JSON.parse(event.request.postData)); });
    const mouse = async (point, modifiers = 0, clickCount = 1) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount, modifiers });
    };
    const click = async selector => {
      const point = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw Error('Unavailable: '+${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse(point);
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };

    const prefix = async (second, code, keyCode, modifiers = 0) => {
      await key('b', 'KeyB', 66, 2); await key(second, code, keyCode, modifiers);
    };
    const count = () => evaluate(cdp, 'document.querySelectorAll(".agent-chat-tabs [role=tab]").length');
    const prompt = () => evaluate(cdp, 'document.querySelector(".agent-chat-prompt").textContent');
    const activeTab = () => evaluate(cdp, 'document.querySelector(".agent-chat-tabs [aria-selected=true]").id');
    const type = async text => { await click('.agent-chat-prompt'); await key('a', 'KeyA', 65, 2); await cdp.send('Input.insertText', { text }); };
    const idle = async text => waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat').dataset.chatState === 'idle' && document.querySelector('.agent-chat-prompt').textContent === '' && document.querySelector('.agent-chat-timeline').textContent.includes(${JSON.stringify(text)})`));
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await prefix('a', 'KeyA', 65);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-prompt")?.isContentEditable'));
    assert.equal(await count(), 1);
    // Direct Ctrl+F and L no longer dispatch WindowPanel commands.
    await key('f', 'KeyF', 70, 2); await key('Escape', 'Escape', 27);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat").checkVisibility()'), true);
    await click('.agent-chat-prompt'); await key('l', 'KeyL', 76);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat").checkVisibility()'), true);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlRight', windowsVirtualKeyCode: 17, location: 2, modifiers: 2 });
    await key('b', 'KeyB', 66, 2);
    assert.equal(await evaluate(cdp, '!!document.querySelector(".window-panel-prefix-hint")'), false);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlRight', windowsVirtualKeyCode: 17, location: 2 });
    await type('First unsent draft'); const firstDraft = await activeTab();
    // Toggle from the editor and canvas, preserving the current tab and draft.
    await prefix('b', 'KeyB', 66);
    await waitFor(() => evaluate(cdp, '!document.querySelector(".window-panel-tabbed").checkVisibility()'));
    assert.equal(await evaluate(cdp, 'document.activeElement.matches(".mapping-poc-graph-stage")'), true);
    await prefix('b', 'KeyB', 66, 2);
    await waitFor(() => evaluate(cdp, 'document.activeElement.matches(".agent-chat-prompt")'));
    assert.equal(await activeTab(), firstDraft); assert.equal(await prompt(), 'First unsent draft');
    assert.equal(await count(), 1);
    await prefix('b', 'KeyB', 66, 2);
    await waitFor(() => evaluate(cdp, '!document.querySelector(".window-panel-tabbed").checkVisibility()'));
    await prefix('b', 'KeyB', 66);
    await waitFor(() => evaluate(cdp, 'document.activeElement.matches(".agent-chat-prompt")'));
    await prefix('c', 'KeyC', 67, 2); // Ctrl may remain held for the second key.
    await waitFor(async () => await count() === 2);
    assert.equal(await prompt(), '');
    await type('Second unsent draft'); const secondDraft = await activeTab();
    await click('[aria-label="New chat tab"]'); assert.equal(await count(), 3); assert.equal(await prompt(), '');
    await click('.agent-chat-tab[data-active=true] .agent-chat-tab-close');
    assert.equal(await count(), 2); assert.equal(await activeTab(), secondDraft); assert.equal(await prompt(), 'Second unsent draft');
    await prefix('PageUp', 'PageUp', 33); await waitFor(async () => await activeTab() === firstDraft);
    assert.equal(await prompt(), 'First unsent draft');
    await prefix('PageUp', 'PageUp', 33); await waitFor(async () => await activeTab() === secondDraft);
    assert.equal(await prompt(), 'Second unsent draft');
    await prefix('PageDown', 'PageDown', 34); await waitFor(async () => await activeTab() === firstDraft);
    // Prefix cancellation never closes the active panel or changes its draft.
    await key('b', 'KeyB', 66, 2); await waitForSelector(cdp, '.window-panel-prefix-hint');
    await key('Escape', 'Escape', 27);
    assert.equal(await evaluate(cdp, '!!document.querySelector(".window-panel-prefix-hint")'), false);
    assert.equal(await prompt(), 'First unsent draft');
    await key('b', 'KeyB', 66, 2);
    await waitFor(() => evaluate(cdp, '!document.querySelector(".window-panel-prefix-hint")'), { timeoutMs: 3500 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', text: 'c', windowsVirtualKeyCode: 67 });
    await key('c', 'KeyC', 67);
    assert.equal(await count(), 2); assert.ok((await prompt()).includes('c'));
    // A running reply keeps its own thread while another tab is used.
    await type('wait'); await key('Enter', 'Enter', 13);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").dataset.chatState === "running" && document.querySelector(".agent-chat-prompt").isContentEditable'));
    const first = await activeTab();
    await prefix('PageDown', 'PageDown', 34); await waitFor(async () => await activeTab() === secondDraft);
    assert.equal(await prompt(), 'Second unsent draft');
    await type('Second conversation'); await key('Enter', 'Enter', 13); await idle('Second conversation');
    const second = await activeTab();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].text, 'wait'); assert.equal(requests[1].text, 'Second conversation');
    await prefix('PageUp', 'PageUp', 33); await waitFor(async () => await activeTab() === first);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-send").textContent === "Stop"'));
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent.includes("Second conversation")'), false);
    await click('.agent-chat-send'); await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").dataset.chatState === "interrupted"'));
    // Search and LLM now use the same prefix, including when the chat editor owns focus.
    await prefix('f', 'KeyF', 70);
    await waitFor(() => evaluate(cdp, 'document.activeElement?.getAttribute("aria-label") === "Search diagram text"'));
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Diagram search scope"]').value`), 'canvas');
    await key('b', 'KeyB', 66, 2); await key('Escape', 'Escape', 27);
    assert.equal(await evaluate(cdp, 'document.querySelector(".diagram-search-panel").checkVisibility()'), true);
    await prefix('f', 'KeyF', 70, 8);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Diagram search scope"]').value === 'global'`));
    await prefix('b', 'KeyB', 66);
    await waitFor(() => evaluate(cdp, '!document.querySelector(".window-panel-tabbed").checkVisibility()'));
    await prefix('b', 'KeyB', 66);
    await waitFor(() => evaluate(cdp, 'document.activeElement?.getAttribute("aria-label") === "Search diagram text"'));
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Diagram search scope"]').value`), 'global');
    await prefix('l', 'KeyL', 76);
    await waitFor(() => evaluate(cdp, `document.querySelector('.window-panel-tabs [id$="-llm"]').getAttribute("aria-selected") === "true"`));
    await prefix('a', 'KeyA', 65); await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").checkVisibility()'));
    assert.equal(await activeTab(), first);
    await prefix('PageDown', 'PageDown', 34); await waitFor(async () => await activeTab() === second);
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_TABS_SCREENSHOT ?? path.join(fixture, 'tabs.png') });
    // Closing a tab keeps its conversation in history; reopening reuses a single tab.
    await click('.agent-chat-tab[data-active=true] .agent-chat-tab-close');
    assert.equal(await count(), 1); assert.equal(await activeTab(), first);
    await click('[aria-label="Chat menu"]'); await click('[aria-label="Agent conversations"]');
    const historyIndex = await evaluate(cdp, `[...document.querySelector('[aria-label="Agent conversations"]').options].findIndex(option => option.textContent.includes('Second conversation'))`);
    assert.ok(historyIndex > 0);
    await key('Home', 'Home', 36);
    for (let i = 0; i < historyIndex; i++) await key('ArrowDown', 'ArrowDown', 40);
    await key('Enter', 'Enter', 13);
    await waitFor(async () => await count() === 2);
    const restored = await activeTab();
    // Both saved conversations reopen as tabs after a reload.
    const loaded = new Promise(resolve => { const off = cdp.on('Page.loadEventFired', () => { off(); resolve(); }); });
    await cdp.send('Page.reload'); await loaded; await waitForSelector(cdp, '[data-grid-box="overview"]'); await prefix('a', 'KeyA', 65);
    await waitFor(async () => await count() === 2);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-tabs [aria-selected=true]").textContent.includes("Second conversation")'), true);
    assert.deepEqual(errors, []);
    console.log('PASS: prefix dispatch from editors, held/released Ctrl, cancellation/timeout, Search scopes, LLM, independent draft tabs, concurrent threads, cycle/wrap, closing/history, reload.');

  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(fixture, { recursive: true, force: true });
}
