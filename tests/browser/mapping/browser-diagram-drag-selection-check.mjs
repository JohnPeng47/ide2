// Run with node --import tsx after npm run build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-drag-selection-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Root\n|-- Service\n|   `-- Worker\n`-- Other', nodes: [] });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--http', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams') }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', chunk => { logs += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1600, height: 1050,
    chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      return Promise.race([send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`CDP timeout: ${method} ${params?.expression ?? ''}`)), 15000);
      })]).finally(() => clearTimeout(timer));
    };
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    const errors = []; cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    const mouse = (type, point, modifiers = 0, clickCount = 1) => cdp.send('Input.dispatchMouseEvent', { type, ...point,
      button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, modifiers, clickCount });
    const click = async (point, modifiers = 0, clickCount = 1) => { await mouse('mousePressed', point, modifiers, clickCount); await mouse('mouseReleased', point, modifiers, clickCount); };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const center = selector => evaluate(cdp, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const background = () => evaluate(cdp, `(()=>{const r=document.querySelector('[data-grid-box=overview]').getBoundingClientRect();return {x:r.right-4,y:r.bottom-6};})()`);
    const node = label => evaluate(cdp, `(()=>{const e=[...document.querySelectorAll('[data-native-node="grid:overview"] [data-content-node-id]')].find(e=>e.textContent.trim()===${JSON.stringify(label)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const labels = () => evaluate(cdp, `[...document.querySelectorAll('[data-native-node="grid:overview"] [data-content-node-id].is-selected')].map(e=>e.textContent.trim()).sort()`);
    const state = () => evaluate(cdp, `(()=>{const e=document.querySelector('[data-grid-box=overview]');return {selected:e.dataset.diagramSelected==='true',drag:e.dataset.diagramDragSelected==='true',column:Number(e.dataset.gridColumn),row:Number(e.dataset.gridRow)};})()`);
    const expectLabels = expected => waitFor(async () => JSON.stringify(await labels()) === JSON.stringify(expected), { message: `Expected selected nodes: ${expected}` });
    await waitForSelector(cdp, '[data-native-node="grid:overview"] [data-content-node-id]');
    const camera = () => evaluate(cdp, `document.querySelector('.mapping-editor-overlay').style.transform`);
    const wheel = (deltaX, deltaY, point = { x: 1100, y: 600 }) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX, deltaY });
    const panWithoutClick = async () => {
      const before = await camera();
      await wheel(32, 48);
      await waitFor(async () => await camera() !== before, { message: 'First trackpad scroll must pan without clicking the canvas' });
      const panned = await camera();
      await wheel(-32, -48);
      await waitFor(async () => await camera() !== panned);
    };
    await panWithoutClick();
    assert.equal((await state()).selected, false); assert.deepEqual(await labels(), []);
    await click(await center('[aria-label="Filter diagrams"]'));
    await panWithoutClick();
    assert.equal(await evaluate(cdp, 'document.activeElement?.getAttribute("aria-label")'), 'Filter diagrams', 'Canvas scrolling must preserve text input focus');
    const before = await state();
    await click(await background(), 2);
    await waitFor(async () => (await state()).drag);
    assert.equal((await state()).selected, false, 'Ctrl-click frame must not select all diagram content');
    assert.deepEqual(await labels(), []);
    assert.equal(await evaluate(cdp, '!!document.querySelector(".mapping-whole-actions")'), false);
    await waitForSelector(cdp, '[data-diagram-move-handle="grid:overview"]');
    await click(await node('Service'), 2); await expectLabels(['Service']);
    await click(await node('Worker'), 2); await expectLabels(['Service', 'Worker']);
    await key('Escape', 'Escape', 27); await expectLabels(['Service']);
    await click(await background(), 2); await waitFor(async () => (await state()).drag);
    await click(await node('Worker'), 2); await expectLabels(['Service', 'Worker']);
    await click(await node('Service'), 2); await expectLabels(['Worker']);
    assert.equal((await state()).selected, false, 'Node toggles must not promote drag selection to whole content');
    await captureScreenshot(cdp, { output: process.env.DRAG_SELECTION_SCREENSHOT ?? path.join(root, 'selection.png') });
    const handle = await center('[data-diagram-move-handle="grid:overview"]');
    await mouse('mouseMoved', handle); await mouse('mousePressed', handle);
    for (let i = 1; i <= 10; i++) await mouse('mouseMoved', { x: handle.x + i * 10, y: handle.y + i * 8 });
    await mouse('mouseReleased', { x: handle.x + 100, y: handle.y + 80 });
    await waitFor(async () => { const s = await state(); return s.column > before.column && s.row > before.row; });
    assert.equal((await state()).selected, false); await expectLabels(['Worker']);
    await key('Escape', 'Escape', 27); await expectLabels([]);
    await waitFor(async () => !(await state()).drag);
    // A real double-click includes the preceding first click.
    const p = await background(); await click(p); await click(p, 0, 2);
    await waitFor(async () => (await state()).selected);
    await waitForSelector(cdp, '.mapping-whole-actions');
    // Keep the moved diagram visible while panning the canvas origin above the viewport.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1100, y: 600, deltaX: 0, deltaY: 110 });
    const clickable = selector => evaluate(cdp, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;
      const r=e.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
    await waitFor(async () => await clickable('.mapping-whole-actions > button'), { message: 'Selected diagram Actions must remain visible and clickable after panning' });
    if (await evaluate(cdp, `document.querySelector('.mapping-whole-actions > button').getAttribute('aria-expanded')!=='true'`))
      await click(await center('.mapping-whole-actions > button'));
    await waitForSelector(cdp, '.mapping-whole-actions [role="menu"]').catch(async error => {
      await captureScreenshot(cdp, { output: process.env.DIAGRAM_ACTIONS_SCREENSHOT ?? path.join(root, 'actions-failure.png') });
      console.error(await evaluate(cdp, `document.querySelector('.mapping-whole-actions')?.outerHTML`)); throw error;
    });
    await captureScreenshot(cdp, { output: process.env.DIAGRAM_ACTIONS_SCREENSHOT ?? path.join(root, 'actions.png') });
    const deleteSelector = '.mapping-whole-actions [role="menuitem"]:last-child';
    assert.ok(await clickable(deleteSelector), 'Delete diagram must be clickable');
    await click(await center(deleteSelector));
    await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-grid-box=overview]")'));
    await click(await center('.diagram-canvas__controls [aria-keyshortcuts="Control+Z"]'));
    await waitForSelector(cdp, '[data-grid-box=overview]');
    await key('Escape', 'Escape', 27);
    await waitFor(async () => !(await state()).selected && !(await state()).drag);
    // Ctrl-double-click on text retains the existing subtree gesture.
    const service = await node('Service'); await click(service, 2); await click(service, 2, 2);
    await expectLabels(['Service', 'Worker']);
    assert.equal((await state()).selected, false);
    await key('Escape', 'Escape', 27); await expectLabels([]);
    // Drag selection is session UI only: saving/reloading must not select content.
    await click(await background(), 2); await waitFor(async () => (await state()).drag);
    await click(await center('[aria-label="Menu"]'));
    const save = await evaluate(cdp, `(()=>{const e=[...document.querySelectorAll('.mapping-workspace-actions button')].find(e=>e.textContent.trim()==='Save workspace'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await click(save);
    await waitFor(async () => { const result = await fetch(url + '/api/mapping/workspace').then(r => r.json());
      const doc = (result.workspace ?? result)?.documents?.[0];
      return doc?.canvas.selection.items.length === 0 && doc?.document?.scene?.root?.children?.some(box => box.position?.column > 0);
    });
    await evaluate(cdp, 'window.__beforeDragReload=true'); await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => { try { return await evaluate(cdp, 'window.__beforeDragReload!==true&&document.readyState==="complete"'); } catch { return false; } });
    await waitForSelector(cdp, '[data-grid-box=overview]');
    assert.equal((await state()).selected, false); assert.equal((await state()).drag, false); assert.deepEqual(await labels(), []);
    await panWithoutClick();
    assert.deepEqual(errors, []);
    console.log('PASS first wheel pans before any canvas click and after reload, preserving input focus; Ctrl-click frame is drag-only; Ctrl-click nodes remain independent; move preserves membership; double-click frame selects whole diagram; actions remain clickable after pan; Delete and Undo work; subtree double-click, Escape and save/reload work');
  });
} finally {
  if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
