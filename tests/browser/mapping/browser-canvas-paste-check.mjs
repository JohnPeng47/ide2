import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'canvas-paste-'));
let server;
const ascii = 'Workbench renderer\n|-- EditorPart\n`-- View\n   \nEnd';
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      return Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000); })]).finally(() => clearTimeout(timer));
    };
    const click = async selector => {
      const point = typeof selector === 'string' ? await evaluate(cdp, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`) : selector;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const count = () => evaluate(cdp, 'document.querySelectorAll("[data-grid-box]").length');
    const gridPoint = (column, row) => evaluate(cdp, `(() => {
      const box = document.querySelector('[data-grid-box="overview"]'), r = box.getBoundingClientRect();
      const w = r.width / Number(box.dataset.gridColumns), h = r.height / Number(box.dataset.gridRows);
      return {x: r.left + (${column} - Number(box.dataset.gridColumn) + .5) * w,
        y: r.top + (${row} - Number(box.dataset.gridRow) + .5) * h};
    })()`);
    const rightClick = async point => {
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'right', buttons:2, clickCount:1});
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'right', buttons:0, clickCount:1});
    };
    const clipboard = text => evaluate(cdp, `Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{readText:async () => ${JSON.stringify(text)}}})`);
    const open = async (column, row) => {
      await rightClick(await gridPoint(column, row));
      await waitForSelector(cdp, '.canvas-paste-menu');
    };
    const pastedBox = () => evaluate(cdp, `Array.from(document.querySelectorAll('[data-grid-box]')).filter(el => !['root','overview'].includes(el.dataset.gridBox)).map(el => ({id:el.dataset.gridBox, column:Number(el.dataset.gridColumn), row:Number(el.dataset.gridRow)}))`);
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-canvas__surface')?.style.transform.includes('translate3d(')`));
    const initialCount = await count();
    await open(25, 7); // Blank canvas, without any selection or entities.
    await cdp.send('Page.enable');
    await captureScreenshot(cdp, {output:path.join(root, 'paste-menu.png')});
    await key('Escape','Escape',27);
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".canvas-paste-menu")'));
    await open(25, 7);
    await click({x:10,y:10});
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".canvas-paste-menu")'));

    console.log('Menu dismissal passed');
    // Real pan and zoom, followed by an insertion at known grid coordinates.
    const pan = await gridPoint(30, 10);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', ...pan, button:'left', buttons:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved', x:pan.x+60, y:pan.y+40, button:'left', buttons:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', x:pan.x+60, y:pan.y+40, button:'left', buttons:0});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel', ...pan, deltaX:0, deltaY:-150, modifiers:2});
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".diagram-canvas__controls output")?.value !== "100%"'));
    await clipboard('```text\r\n  Pasted\r\n  |-- Child\r\n```');
    await open(25, 7);
    await click('.canvas-paste-menu button');
    await waitFor(async () => (await count()) === initialCount + 1);
    assert.deepEqual((await pastedBox()).map(({column,row}) => ({column,row})), [{column:25,row:7}]);
    assert.match(await evaluate(cdp, 'document.querySelector(".mapping-poc-ascii").textContent'), /Pasted/);
    await click('.mapping-grid-tools button:first-child');
    await waitFor(async () => (await count()) === initialCount);
    await click('.mapping-grid-tools button:nth-child(2)');
    await waitFor(async () => (await count()) === initialCount + 1);
    assert.equal((await pastedBox())[0].column, 25);

    console.log('Placement and undo/redo passed');
    // Overlap anchors the paste and moves the old diagram to the right.
    await clipboard('[Overlap]');
    await open(0, 0);
    await click('.canvas-paste-menu button');
    await waitFor(async () => (await count()) === initialCount + 2);
    assert.ok(await evaluate(cdp, 'Number(document.querySelector("[data-grid-box=overview]").dataset.gridColumn) >= 12'));
    assert.ok((await pastedBox()).some(box => box.column === 0 && box.row === 0));

    console.log('Collision passed');
    // Invalid/empty data creates no box and exposes a manual paste form.
    await clipboard('   ');
    await open(25, 12);
    await click('.canvas-paste-menu button');
    await waitForSelector(cdp, '.canvas-paste-menu [role=alert]');
    assert.equal(await count(), initialCount + 2);
    assert.equal(await evaluate(cdp, 'document.querySelector(".canvas-paste-menu button").disabled'), true);
    await key('Escape','Escape',27);
    await evaluate(cdp, `Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{readText:async () => {throw new Error('denied')}}})`);
    await open(25, 12);
    await click('.canvas-paste-menu button');
    await waitForSelector(cdp, '.canvas-paste-menu textarea');
    await click('.canvas-paste-menu textarea');
    await cdp.send('Input.insertText', {text:'[Manual]'});
    await click('.canvas-paste-menu button');
    await waitFor(async () => (await count()) === initialCount + 3);

    console.log('Fallback passed');
    // Slow clipboard reads cannot duplicate insertions or outlive cancellation.
    await evaluate(cdp, `Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{readText:() => {window.__reads=(window.__reads||0)+1; return new Promise(resolve => window.__resolveClipboard=resolve)}}})`);
    await open(25, 16);
    await click('.canvas-paste-menu button');
    await click('.canvas-paste-menu button');
    assert.equal(await evaluate(cdp, 'window.__reads'), 1);
    await key('Escape','Escape',27);
    await evaluate(cdp, 'window.__resolveClipboard("[Too late]")');
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await count(), initialCount + 3);
    await open(25, 16);
    await click('.canvas-paste-menu button');
    await click('.mapping-submenu button');
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".canvas-paste-menu")'));
    await waitForSelector(cdp, '.mapping-create-dialog');
    await evaluate(cdp, 'window.__resolveClipboard("[Also too late]")');
    await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await count(), initialCount + 3);

    // A real right-click inside a text field keeps the native menu.
    await evaluate(cdp, `window.addEventListener('contextmenu', event => { window.__nativeContextPrevented = event.defaultPrevented; }, {once:true})`);
    const field = await evaluate(cdp, `(() => { const r=document.querySelector('.mapping-create-dialog input').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    await rightClick(field);
    assert.equal(await evaluate(cdp, 'window.__nativeContextPrevented'), false);
    await key('Escape', 'Escape', 27);
    // Escape may dismiss the dialog as well as the native context menu.
    if (await evaluate(cdp, '!!document.querySelector(".mapping-create-dialog")')) await click('.mapping-create-dialog footer button:first-child');
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-create-dialog")'));
    await click('.mapping-workspace-actions button:first-child');
    await waitFor(async () => {
      const workspace = await (await fetch(`${url}/api/mapping/workspace`)).json();
      return Object.values(workspace?.documents[0]?.document?.scene?.contents ?? {}).some(content => content.ascii === '[Manual]');
    });
    console.log('Persistence passed');
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', {accept:true}));
    await cdp.send('Page.reload', {ignoreCache:true});
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(async () => (await count()) === initialCount + 3);
    assert.match(await evaluate(cdp, 'document.querySelector(".mapping-poc-ascii").textContent'), /Manual/);
    console.log('Canvas paste passed: menu dismissal, pan/zoom coordinates, collision layout, undo/redo, clipboard validation/fallback, stale reads, and save/reload.');

  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
