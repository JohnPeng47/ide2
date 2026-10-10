import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';

const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(
  pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'mapping-ipad-browser-'));
let server;
try {
  await seedMappingFixture(root, {
    ascii: 'Root\n|-- Parent\n|\n|   `-- Child\n|\n|\n|-- Sibling\n|\n|\n`-- Other\n',
    nodes: [
      { id: 'parent', label: 'Parent', head: { line: 2, startColumn: 5, endColumn: 10 }, sourceRanges: [{ path: 'src/parent.ts', startLine: 1, endLine: 100 }] },
      { id: 'child', label: 'Child', head: { line: 4, startColumn: 9, endColumn: 13 }, sourceRanges: [] },
      { id: 'sibling', label: 'Sibling', head: { line: 7, startColumn: 5, endColumn: 11 }, sourceRanges: [] },
      { id: 'other', label: 'Other', head: { line: 10, startColumn: 5, endColumn: 9 }, sourceRanges: [] },
    ],
  });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/parent.ts'), Array.from({ length: 100 }, (_, i) => `// Parent: fixture source line ${i + 1}`).join('\n'));
  const port = await new Promise(resolve => {
    const socket = createServer();
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_ALLOWED_HOSTS: 'ipad.test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${errors}`); });
  // A non-localhost HTTP origin reproduces iPad LAN access and secure-context API restrictions.
  await withHeadlessBrowser({ url: `http://ipad.test:${port}/mapping?diagram=representation-overview`, width: 1366, height: 1024,
    chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu', '--host-resolver-rules=MAP ipad.test 127.0.0.1', '--no-proxy-server', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      let timeout;
      try { return await Promise.race([send(method, params), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 15000); })]); }
      finally { clearTimeout(timeout); }
    };
    try {
      const exceptions = [];
      await cdp.send('Runtime.enable');
      cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await waitForSelector(cdp, '[data-native-node="grid:overview"] pre');
      assert.equal(await evaluate(cdp, 'isSecureContext'), false, 'Exercise plain HTTP LAN browser restrictions');
      const query = selector => JSON.stringify(selector);
      const rect = selector => evaluate(cdp, `(() => {const e=document.querySelector(${query(selector)}); const r=e?.getBoundingClientRect();return r&&{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
      const center = async selector => {
        const target = await evaluate(cdp, `(() => {const e=document.querySelector(${query(selector)}),r=e?.getBoundingClientRect();if(!r?.width||!r.height)return null;const x=r.x+r.width/2,y=r.y+r.height/2,top=document.elementFromPoint(x,y);return {x,y,reachable:!!top&&e.contains(top),obstruction:top?.tagName+':'+top?.textContent?.slice(0,60)}})()`);
        assert.ok(target?.reachable, `Reachable ${selector}; found ${target?.obstruction}`);
        return { x: target.x, y: target.y };
      };
      const frames = () => evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point, i) => ({ id: i + 1, radiusX: 1, radiusY: 1, force: 1, ...point })) });
      const tap = async point => { await touch('touchStart', [point]); await touch('touchEnd', []); };
      const tapSelector = async selector => tap(await center(selector));
      const doubleTap = async point => { await tap(point); await tap(point); };
      const button = async text => {
        const p = await evaluate(cdp, `(() => {const e=[...document.querySelectorAll('.diagram-canvas__controls button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});const r=e?.getBoundingClientRect();if(!r)return null;const x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
        assert.ok(p, `${text} canvas control is reachable`); await tap(p);
      };
      const label = line => `[data-native-node="grid:overview"] [data-content-node-id][data-source-line="${line}"]`;
      const selectedLines = () => evaluate(cdp, '[...new Set([...document.querySelectorAll("[data-native-node] .diagram-content-node.is-selected")].map(e=>Number(e.dataset.sourceLine)))].sort((a,b)=>a-b)');
      const expectLines = async (lines, message) => {
        await waitFor(async () => JSON.stringify(await selectedLines()) === JSON.stringify(lines), { message });
        // Persistence is debounced; wait for the selection before taking a baseline.
        await waitFor(async () => {
          const items = (await workspace()).canvas.selection.items;
          const persisted = [...new Set(items.flatMap(item => item.region
            ? [1, 2, 4, 7, 10].filter(line => line >= item.region.rect.startLine && line <= item.region.rect.endLine)
            : [1, 2, 4, 7, 10]))].sort((a, b) => a - b);
          return JSON.stringify(persisted) === JSON.stringify(lines);
        }, { message: `${message} (persisted)` });
      };
      const box = () => rect('[data-grid-box="overview"]');
      const workspace = async () => {
        const state = await (await fetch(`${url}/api/mapping/workspace`)).json();
        return state?.documents.find(document => document.representationId === 'representation-overview');
      };
      const drag = async (from, to, beforeRelease) => {
        await touch('touchStart', [from]);
        for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }]); await frames(); }
        if (beforeRelease) await beforeRelease();
        await touch('touchEnd', []);
      };
      const stableCamera = async () => {
        let last, stableSince = performance.now();
        await waitFor(async () => {
          const current = await box();
          if (!last || Math.abs(current.x - last.x) > .1 || Math.abs(current.y - last.y) > .1 || Math.abs(current.w - last.w) > .1) stableSince = performance.now();
          last = current;
          return current.w > 20 && performance.now() - stableSince >= 200;
        }, { message: 'Native camera animation settles' });
      };
      const fit = async () => {
        await stableCamera();
        await button('Fit canvas');
        await stableCamera();
      };

      const pointer = (type, point, pointerType = 'pen', extra = {}) => cdp.send('Input.dispatchMouseEvent', {
        type, ...point, pointerType, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra,
      });
      const clickPointer = async (selector, pointerType = 'pen') => {
        const point = await center(selector);
        await pointer('mousePressed', point, pointerType); await pointer('mouseReleased', point, pointerType);
      };
      const penDrag = async (from, to, beforeRelease) => {
        await pointer('mousePressed', from);
        for (let i = 1; i <= 8; i++) { await pointer('mouseMoved', { x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }); await frames(); }
        if (beforeRelease) await beforeRelease();
        await pointer('mouseReleased', to);
      };
      const escapeButton = '.diagram-canvas__controls [aria-keyshortcuts="Escape"]';
      const toolActive = name => evaluate(cdp, `[...document.querySelectorAll('.diagram-canvas__controls button')].some(e=>e.textContent.trim()===${JSON.stringify(name)} && e.getAttribute('aria-pressed')==='true')`);
      assert.equal(await evaluate(cdp, `!!document.querySelector('[aria-label="Add to selection"]')`), false);
      const esc = await rect(escapeButton);
      assert.ok(esc.w >= 44 && esc.h >= 44, 'Esc is finger-sized');
      await waitFor(async () => !!await workspace(), { message: 'Initial workspace persistence finishes' });
      for (const mode of ['Select', 'Pan']) {
        await button(mode);
        const before = await workspace(), camera = await box(), origin = await center(label(7));
        await doubleTap(origin); await frames();
        await expectLines([], 'Finger double taps never select');
        assert.ok(Math.abs((await box()).w - camera.w) < 1, 'Finger double taps do not trigger native zoom');
        await tap(origin);
        await drag(origin, { x: origin.x + 80, y: origin.y + 45 }, async () => {
          assert.equal(await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'), false, 'Finger tap-drag never creates a marquee');
        });
        await waitFor(async () => Math.abs((await box()).x - camera.x) > 30, { message: `Finger pans while ${mode} is chosen` });
        await stableCamera();
        assert.equal(await toolActive(mode), true, 'Finger pan preserves the chosen pen/mouse tool');
        assert.deepEqual((await workspace()).canvas.selection, before.canvas.selection);
        assert.equal((await workspace()).history.headId, before.history.headId);
        await fit();
      }
      console.log('PASS: fingers only pan in Select and Pan, including double-tap and tap-drag');

      await button('Select');
      await clickPointer(label(2)); await expectLines([2], 'Pen selects immediately after finger navigation');
      await clickPointer(label(7)); await expectLines([7], 'Pen selection replaces the previous region');
      await clickPointer(label(2), 'mouse'); await expectLines([2, 7], 'Mouse selection remains additive');
      assert.equal(await evaluate(cdp, '!!document.querySelector(".source-window-host .window-panel")'), false);

      for (const mode of ['Select', 'Pan']) for (const entry of ['tap-then-pinch', 'simultaneous', 'staggered', 'dragging']) {
        await button(mode);
        const origin = await center(label(7)), other = { x: origin.x + 100, y: origin.y + 80 };
        const before = await box(), beforeHistory = (await workspace()).history.headId;
        if (entry === 'tap-then-pinch') await tap(origin);
        if (entry === 'staggered' || entry === 'dragging') {
          await touch('touchStart', [origin]);
          if (entry === 'dragging') { origin.x += 30; await touch('touchMove', [origin]); }
          await frames();
        }
        await touch('touchStart', [origin, other]);
        for (let i = 1; i <= 8; i++) {
          await touch('touchMove', [{ x: origin.x - i * 4, y: origin.y - i * 2 }, { x: other.x + i * 4, y: other.y + i * 2 }]); await frames();
        }
        await waitFor(async () => (await box()).w > before.w * 1.05, { message: `${entry} pinch zooms in ${mode}` });
        await touch('touchMove', [{ id: 1, x: origin.x - 32, y: origin.y - 16 }]);
        assert.equal(await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'), false);
        await touch('touchEnd', []); await stableCamera();
        assert.equal(await toolActive(mode), true, `${entry} pinch preserves ${mode} after all fingers lift`);
        await expectLines([2, 7], 'Pinch preserves selection');
        assert.equal((await workspace()).history.headId, beforeHistory);
        await fit();
      }
      console.log('PASS: two-finger zoom preserves selection, history and chosen tool');

      await button('Select');
      const row2 = await rect(label(2)), row3 = await rect(label(4));
      const start = { x: row2.x + 1, y: row2.y + row2.h / 2 }, end = { x: row3.x + row3.w + 4, y: row3.y + row3.h / 2 };
      const beforeMarquee = await workspace();
      await penDrag(start, end, async () => {
        await waitForSelector(cdp, '[data-selection-preview]');
        assert.deepEqual((await workspace()).canvas.selection, beforeMarquee.canvas.selection, 'Pen preview does not persist');
      });
      await expectLines([2, 4], 'Pen marquee commits after release');
      const cancelStart = await center(label(10)), cancelEnd = { x: cancelStart.x + 100, y: cancelStart.y + 80 };
      const cancelBaseline = (await workspace()).canvas.selection;
      await penDrag(cancelStart, cancelEnd, async () => {
        await waitForSelector(cdp, '[data-selection-preview]');
        await tapSelector(escapeButton);
        await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'));
      });
      await frames();
      assert.deepEqual((await workspace()).canvas.selection, cancelBaseline, 'Toolbar Esc cancels a held pen marquee');

      const frame = await box(), framePoint = { x: frame.x + frame.w - 3, y: frame.y + frame.h - 3 };
      await pointer('mousePressed', framePoint); await pointer('mouseReleased', framePoint);
      await waitForSelector(cdp, '[data-diagram-move-handle]');
      await waitFor(async () => (await workspace()).canvas.selection.items.some(item => !item.region));
      const handle = await rect('[data-diagram-move-handle]');
      assert.ok(handle.w >= 44 && handle.h >= 44);
      const panBeforeHandle = await box(), beforeFingerHandle = await workspace();
      const fingerFrom = await center('[data-diagram-move-handle]');
      await drag(fingerFrom, { x: fingerFrom.x + 80, y: fingerFrom.y + 50 });
      await waitFor(async () => Math.abs((await box()).x - panBeforeHandle.x) > 30);
      assert.equal((await workspace()).history.headId, beforeFingerHandle.history.headId, 'Finger on move handle pans without moving the diagram');
      await fit();
      const moveBefore = await box(), headBeforeMove = (await workspace()).history.headId;
      const moveFrom = await center('[data-diagram-move-handle]');
      await penDrag(moveFrom, { x: moveFrom.x + 80, y: moveFrom.y + 50 }, async () => {
        await waitFor(async () => Math.abs((await box()).x - moveBefore.x) > 30);
        await tapSelector(escapeButton);
      });
      await waitFor(async () => Math.abs((await box()).x - moveBefore.x) < 2 && Math.abs((await box()).y - moveBefore.y) < 2);
      assert.equal((await workspace()).history.headId, headBeforeMove, 'Toolbar Esc rolls back native pen movement');
      await penDrag(moveFrom, { x: moveFrom.x + 100, y: moveFrom.y + 60 });
      await waitFor(async () => (await workspace()).history.headId !== headBeforeMove);
      await tapSelector('.diagram-canvas__controls [title="Undo (Ctrl+Z)"]');
      await waitFor(async () => Math.abs((await box()).x - moveBefore.x) < 2 && Math.abs((await box()).y - moveBefore.y) < 2);
      await tapSelector('[aria-label="Selected diagrams"] [aria-keyshortcuts="Escape"]');
      await expectLines([], 'Whole-diagram action menu Esc deselects');
      await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-diagram-selected=true]")'));

      const canvas = await rect('[data-diagram-canvas]'), panFrom = { x: canvas.x + canvas.w * .7, y: canvas.y + canvas.h * .7 };
      const middleBefore = await box();
      await pointer('mousePressed', panFrom, 'mouse', { button: 'middle', buttons: 4 });
      await pointer('mouseMoved', { x: panFrom.x + 60, y: panFrom.y + 30 }, 'mouse', { button: 'middle', buttons: 4 }); await frames();
      await pointer('mouseReleased', { x: panFrom.x + 60, y: panFrom.y + 30 }, 'mouse', { button: 'middle', buttons: 0 });
      await waitFor(async () => Math.abs((await box()).x - middleBefore.x) > 30);
      await fit();
      await clickPointer(label(2)); await expectLines([2], 'Pen still selects after native movement');
      await clickPointer(label(10), 'mouse'); await expectLines([2, 10], 'Mouse still accumulates');
      await clickPointer(label(7)); await expectLines([7], 'Pen replaces mouse selection');
      await doubleTap(await center(label(2))); await expectLines([7], 'Fingers never select after pen input');
      await clickPointer(label(2)); await expectLines([2], 'Pen resumes without changing tools');
      await tapSelector('[data-selection-active="true"] [aria-keyshortcuts="A"]');
      await waitForSelector(cdp, '[aria-label="Selected node operations"]');
      await tapSelector('[aria-label="Selected node operations"] [aria-keyshortcuts="Escape"]');
      await expectLines([], 'Selection action menu Esc deselects');
      await waitFor(async () => !await evaluate(cdp, `!!document.querySelector('[aria-label="Selected node operations"]')`));
      await clickPointer(label(2)); await expectLines([2], 'Select again to open mapped source');
      await tapSelector('[data-selection-active="true"] [aria-keyshortcuts="A"]');
      await waitForSelector(cdp, '[aria-label="Selected node operations"]');
      await tapSelector('[title="Open mapped source ranges for the selected nodes"]');
      await waitForSelector(cdp, '.source-window-host .code-panel-content');
      await waitFor(async () => evaluate(cdp, `(() => {const e=document.querySelector('.source-window-host .code-panel-content');return e.scrollHeight>e.clientHeight+100})()`));
      const pane = await rect('.source-window-host .code-panel-content');
      const beforeScroll = await box();
      const scrollBefore = await evaluate(cdp, "document.querySelector('.source-window-host .code-panel-content').scrollTop");
      const scrollStart = { x: pane.x + pane.w * .65, y: pane.y + pane.h * .8 };
      await drag(scrollStart, { x: scrollStart.x, y: scrollStart.y - Math.min(180, pane.h * .5) });
      await waitFor(async () => await evaluate(cdp, "document.querySelector('.source-window-host .code-panel-content').scrollTop") > scrollBefore + 30, { message: 'A finger scrolls the source pane' });
      const afterScroll = await box();
      assert.ok(Math.abs(afterScroll.x - beforeScroll.x) < 1 && Math.abs(afterScroll.y - beforeScroll.y) < 1 && Math.abs(afterScroll.w - beforeScroll.w) < 1, 'Panel scrolling leaves the canvas camera unchanged');
      await expectLines([2], 'Panel scrolling preserves selection');
      console.log('PASS: hybrid mouse/pen/touch input and native source-panel scrolling');
      await tapSelector('[aria-label="Close Mapped source"]');
      await waitFor(async () => !await evaluate(cdp, '!!document.querySelector(".source-window-host")'));
      await tapSelector('[data-selection-active="true"] [aria-keyshortcuts="Escape"]');
      await expectLines([], 'Retained selection Esc deselects');
      const contextPoint = { x: canvas.x + canvas.w * .7, y: canvas.y + canvas.h * .8 };
      await pointer('mousePressed', contextPoint, 'mouse', { button: 'right', buttons: 2 });
      await pointer('mouseReleased', contextPoint, 'mouse', { button: 'right', buttons: 0 });
      await waitForSelector(cdp, '[aria-label="Canvas actions"]');
      await tapSelector('[aria-label="Canvas actions"] [aria-keyshortcuts="Escape"]');
      await waitFor(async () => !await evaluate(cdp, `!!document.querySelector('[aria-label="Canvas actions"]')`));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
      await frames();
      for (const selector of ['.diagram-canvas__controls button:nth-child(1)', '.diagram-canvas__controls button:nth-child(2)',
        '.diagram-canvas__controls [title="Undo (Ctrl+Z)"]', escapeButton, '.diagram-canvas__controls button:last-child']) {
        await center(selector);
        const target = await rect(selector);
        assert.ok(target.w >= 44 && target.h >= 44, 'Portrait tablet toolbar controls retain finger-sized targets');
      }
      await captureScreenshot(cdp, { output: process.env.IPAD_GESTURES_SCREENSHOT ?? path.join(root, 'ipad-gestures.png') });
      assert.deepEqual(exceptions, [], 'No browser runtime errors');
      console.log('PASS: pen selection/movement, touch Esc buttons, undo and portrait toolbar');
    } catch (error) {
      console.error('Touch test state:', await evaluate(cdp, `({selected:[...document.querySelectorAll('.diagram-content-node.is-selected')].map(e=>e.dataset.sourceLine),preview:!!document.querySelector('[data-selection-preview]'),tools:[...document.querySelectorAll('.diagram-canvas__controls button')].map(e=>[e.textContent,e.getAttribute('aria-pressed')])})`).catch(() => null));
      if (process.env.IPAD_GESTURES_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.IPAD_GESTURES_SCREENSHOT }).catch(() => {});
      throw error;
    }
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
