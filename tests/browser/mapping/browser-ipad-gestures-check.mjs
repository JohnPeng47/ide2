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
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1366, height: 1024,
    chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
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
        return state.documents.find(document => document.representationId === 'representation-overview');
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

      const touchControl = await rect('[aria-label="Add to selection"]');
      assert.ok(touchControl.w >= 44 && touchControl.h >= 44, 'Coarse-pointer controls have finger-sized targets');
      await button('Select');
      await tapSelector(label(2));
      await expectLines([2], 'A touch label tap selects its region');
      assert.equal(await evaluate(cdp, '!!document.querySelector(".source-window-host .window-panel")'), false, 'Selecting a label does not open a panel');
      await tapSelector(label(7));
      await expectLines([7], 'Touch selection replaces the previous region');
      await tapSelector('[aria-label="Add to selection"]');
      await waitForSelector(cdp, '[aria-label="Add to selection"][aria-pressed="true"]');
      await tapSelector(label(2));
      await expectLines([2, 7], 'Add to selection accumulates touch regions');
      await tapSelector('[aria-label="Add to selection"]');
      console.log('PASS: touch tap, replace/add selection and panel ownership');

      const row2 = await rect(label(2)), row3 = await rect(label(4));
      const start = { x: row2.x + 1, y: row2.y + row2.h / 2 }, end = { x: row3.x + row3.w + 4, y: row3.y + row3.h / 2 };
      const beforeMarquee = await workspace();
      await drag(start, end, async () => {
        await waitForSelector(cdp, '[data-selection-preview]');
        assert.deepEqual((await workspace()).canvas.selection, beforeMarquee.canvas.selection, 'Marquee pointermove does not write selection');
      });
      await expectLines([2, 4], 'Select finger drag commits a region marquee');
      await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'));
      console.log('PASS: touch marquee preview and release commit');

      // A second contact transfers ownership immediately; no canceled marquee may commit.
      const baseline = await workspace();
      await touch('touchStart', [start]);
      await touch('touchMove', [end]);
      await waitForSelector(cdp, '[data-selection-preview]');
      const second = { x: end.x + 160, y: end.y + 100 };
      const beforePinch = await box();
      await touch('touchStart', [end, second]);
      await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'), { message: 'Second finger cancels preview immediately' });
      for (let i = 1; i <= 8; i++) {
        await touch('touchMove', [{ x: end.x - i * 5, y: end.y - i * 3 }, { x: second.x + i * 5, y: second.y + i * 3 }]); await frames();
      }
      await waitFor(async () => (await box()).w > beforePinch.w * 1.05, { message: 'Both contacts reach the native pinch recognizer' });
      // CDP emits touchEnd for a removed ID while keeping the other active.
      await touch('touchMove', [{ id: 1, x: end.x - 40, y: end.y - 24 }]);
      await touch('touchMove', [{ id: 1, x: end.x - 80, y: end.y - 40 }]);
      assert.equal(await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'), false, 'Remaining finger cannot restart marquee');
      await touch('touchEnd', []);
      await expectLines([2, 4], 'Pinch preserves region membership through native settle');
      await frames();
      assert.equal((await workspace()).history.headId, baseline.history.headId, 'Pinch creates no document history entry');
      await fit();
      console.log('PASS: second-finger cancellation, native pinch and selection/history preservation');

      await button('Pan');
      const panBefore = await box();
      const canvas = await rect('[data-diagram-canvas]');
      const panFrom = { x: canvas.x + canvas.w * .7, y: canvas.y + canvas.h * .7 };
      await drag(panFrom, { x: panFrom.x + 80, y: panFrom.y + 45 });
      await waitFor(async () => Math.abs((await box()).x - panBefore.x) > 30, { message: 'One finger pans in Pan mode' });
      await expectLines([2, 4], 'Pan preserves application selection');
      await fit();

      const doublePoint = await center(label(10));
      const doubleBefore = await box();
      await tap(doublePoint); await tap(doublePoint);
      await waitForSelector(cdp, '[data-grid-box="overview"][data-diagram-selected="true"]');
      await frames();
      assert.ok(Math.abs((await box()).w - doubleBefore.w) < 1, 'Double tap selects a diagram without native zoom');
      // Wait outside the double-tap window before starting a distinct gesture.
      await new Promise(resolve => setTimeout(resolve, 350));
      const a = await rect(label(2)), b = await rect(label(4));
      const secondFrom = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, secondTo = { x: b.x + b.w + 2, y: b.y + b.h - 1 };
      const tapDragBefore = await box();
      await tap(secondFrom);
      await drag(secondFrom, secondTo, () => waitForSelector(cdp, '[data-selection-preview]'));
      await waitFor(async () => (await selectedLines()).includes(4), { message: 'Tap then drag starts a marquee in Pan mode' });
      assert.ok(Math.abs((await box()).w - tapDragBefore.w) < 1, 'Tap-drag suppresses one-finger zoom');
      console.log('PASS: Pan, double-tap whole diagram and tap-drag marquee');

      await button('Select');
      const cancelStart = await center(label(10));
      const cancelBaseline = (await workspace()).canvas.selection;
      await touch('touchStart', [cancelStart]);
      await touch('touchMove', [{ x: cancelStart.x + 100, y: cancelStart.y + 80 }]);
      await waitForSelector(cdp, '[data-selection-preview]');
      await touch('touchCancel', []);
      await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'));
      await frames();
      assert.deepEqual((await workspace()).canvas.selection, cancelBaseline, 'pointercancel does not commit selection');

      // Frame selection exposes an explicit, finger-sized native movement handle.
      const frame = await box();
      await tap({ x: frame.x + frame.w - 3, y: frame.y + frame.h - 3 });
      await waitForSelector(cdp, '[data-diagram-move-handle]');
      const handle = await rect('[data-diagram-move-handle]');
      assert.ok(handle.w >= 44 && handle.h >= 44, 'Move handle is at least 44 CSS pixels');
      await center(label(1)); // The move handle must leave the root label reachable.
      const moveBefore = await box();
      const headBeforeMove = (await workspace()).history.headId;
      const moveFrom = await center('[data-diagram-move-handle]');
      await touch('touchStart', [moveFrom]);
      await touch('touchMove', [{ x: moveFrom.x + 80, y: moveFrom.y + 50 }]);
      await waitFor(async () => Math.abs((await box()).x - moveBefore.x) > 30);
      await touch('touchCancel', []);
      await waitFor(async () => Math.abs((await box()).x - moveBefore.x) < 2 && Math.abs((await box()).y - moveBefore.y) < 2, { message: 'Canceled native touch move restores geometry' });
      assert.equal((await workspace()).history.headId, headBeforeMove, 'Canceled touch move creates no history entry');
      await drag(moveFrom, { x: moveFrom.x + 100, y: moveFrom.y + 60 });
      await waitFor(async () => Math.abs((await box()).x - moveBefore.x) > 50, { message: 'Touch handle moves the diagram' });
      await waitFor(async () => (await workspace()).history.headId !== headBeforeMove, { message: 'Native move commits geometry' });
      await tapSelector('[title="Undo (Ctrl+Z)"]');
      await waitFor(async () => Math.abs((await box()).x - moveBefore.x) < 2 && Math.abs((await box()).y - moveBefore.y) < 2, { message: 'One undo restores the touch move' });
      // Hybrid devices can switch immediately from touch to a trackpad or pen.
      const middleBefore = await box();
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...panFrom, button: 'middle', buttons: 4, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: panFrom.x + 60, y: panFrom.y + 30, button: 'middle', buttons: 4 });
      await frames();
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panFrom.x + 60, y: panFrom.y + 30, button: 'middle', buttons: 0, clickCount: 1 });
      await waitFor(async () => Math.abs((await box()).x - middleBefore.x) > 30, { message: 'Middle-button pan works immediately after touch' });
      await fit();
      await tapSelector(label(2));
      await expectLines([2], 'Label tap still works after native movement');
      const clickPointer = async (selector, pointerType) => {
        const point = await center(selector);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, pointerType, button: 'left', buttons: 1, clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, pointerType, button: 'left', buttons: 0, clickCount: 1 });
      };
      await clickPointer(label(10), 'mouse');
      await expectLines([2, 10], 'Mouse node selection retains its additive semantics after touch');
      await clickPointer(label(7), 'pen');
      await expectLines([7], 'Pen contacts use their own pointer type on a hybrid device');
      await tapSelector(label(2));
      await expectLines([2], 'Touch works immediately after pen');
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
      await captureScreenshot(cdp, { output: process.env.IPAD_GESTURES_SCREENSHOT ?? path.join(root, 'ipad-gestures.png') });
      assert.deepEqual(exceptions, [], 'No browser runtime errors');
      console.log('PASS: pointer cancellation, accessible move handle and single-step undo');
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
