// npm run build && node --import tsx tests/browser/mapping/browser-diagram-diff-alternatives-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController.ts';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-alternatives-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  const store = new DiagramStore(root), project = await store.loadProject(), revisions = revisionFixture();
  const ascii = 'Root\n|-- Branch\n|   `-- Original\n`-- Other';
  const base = revisions.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).revision;
  const scene = singleDiagramScene(ascii); scene.contents = { ...scene.contents, overview: base.diagram };
  scene.root.children[0].position = { column: 50, row: 6 };
  const controller = new MappingDocumentController({ scene, edges: [], sections: {} }, initialCanvasState());
  const viewId = controller.canvasView(controller.getSnapshot().version, { operation: 'start', name: 'Recorded edit' }).recording.id;
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 3, end: 3, patch: '|   `-- Alternative' }]);
  controller.canvasView(controller.getSnapshot().version, { operation: 'stop' });
  controller.canvasView(controller.getSnapshot().version, { operation: 'promote-diffs', viewId });
  const document = controller.getSnapshot().document;
  await store.projectCatalogs.saveMappingDiagram(project.id, { name: 'Alternatives', scene: document.scene, edges: [], history: controller.exportHistory(), representationId: 'representation-overview', expectedRevisionId: 'revision-overview' });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown', event => { errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text); });
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const click = async selector => {
      let p; await waitFor(async () => p = await evaluate(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e || e.disabled)return null; const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y)) ? p : null; })()`));
      for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    const native = '[data-native-node="grid:overview"]', text = () => evaluate(cdp, `document.querySelector('${native} pre')?.textContent`);
    await waitForSelector(cdp, `${native} pre`);
    const select = async () => {
      const p = await evaluate(cdp, `(() => { const r=document.querySelector('[data-grid-box="overview"]').getBoundingClientRect(); return {x:r.right-2,y:r.bottom-2}; })()`);
      for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await waitForSelector(cdp, '[data-alternative-node]');
    };
    await select();
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-alternative-node=\"root\"]').length"), 1);
    await click('[aria-label="Swap alternative Diff: Recorded edit"]');
    await waitFor(async () => (await text())?.includes('Original') && (await text())?.includes('Alternative'));
    assert.equal(await evaluate(cdp, `!!document.querySelector('${native} [style*="--diff-deleted-fill"]')`), true);
    await click('[aria-label="Open alternative panel Diff: Recorded edit"]');
    await waitForSelector(cdp, '[data-side-panel] pre');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[data-side-panel] pre').textContent.includes('Original')"));
    const align = () => evaluate(cdp, `(() => { const a=document.querySelector('${native} .ascii-line'),b=document.querySelector('[data-side-panel] .ascii-line'); return a && b ? Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top) : 999; })()`);
    await waitFor(async () => await align() < 1);
    await click('[aria-label="Toggle panel layout flow"]');
    await waitForSelector(cdp, '[data-panel-placement="flow"]');
    await waitFor(async () => await align() < 1);
    const palette = () => evaluate(cdp, `(() => {
      const panel=document.querySelector('[data-side-panel]'), canvas=document.querySelector('.tl-background');
      const text=document.querySelector('${native} pre'), button=panel.querySelector('button');
      const deleted=panel.querySelector('[style*="--diff-deleted-fill"]');
      return { background:getComputedStyle(panel).backgroundColor, canvas:getComputedStyle(canvas).backgroundColor,
        text:getComputedStyle(panel.querySelector('pre')).color, regularText:getComputedStyle(text).color,
        control:getComputedStyle(button).color, foreground:getComputedStyle(panel).color,
        deleted:getComputedStyle(deleted).backgroundColor };
    })()`);
    const dark=await palette();
    assert.equal(dark.background,dark.canvas); assert.equal(dark.text,dark.regularText); assert.equal(dark.control,dark.foreground);
    await click('.theme-toggle');
    await waitFor(async () => await evaluate(cdp, "document.documentElement.dataset.theme === 'light'"));
    const light=await palette();
    assert.equal(light.background,light.canvas); assert.equal(light.text,light.regularText); assert.equal(light.control,light.foreground);
    assert.notEqual(light.background,dark.background); assert.notEqual(light.deleted,dark.deleted);
    await captureScreenshot(cdp, { output: path.join(root, 'diff-alternatives-light.png') });
    await click('.theme-toggle');
    await waitFor(async () => await evaluate(cdp, "document.documentElement.dataset.theme === 'dark'"));
    await captureScreenshot(cdp, { output: path.join(root, 'diff-alternatives.png') });
    const camera = () => evaluate(cdp, `(() => { const m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.mapping-document-view:not([hidden]) .mapping-editor-overlay')).transform);return {x:m.e,y:m.f,z:m.a}; })()`);
    const panelPoint = () => evaluate(cdp, `(() => { const e=document.querySelector('[data-side-panel] pre'),r=e.getBoundingClientRect(),p={x:r.left+20,y:r.top+10};if(!e.contains(document.elementFromPoint(p.x,p.y)))throw Error('Panel text is obstructed');return p; })()`);
    const idlePanel = () => waitFor(async () => await evaluate(cdp, "getComputedStyle(document.querySelector('[data-side-panel]')).willChange === 'auto'"));
    const mouse = params => cdp.send('Input.dispatchMouseEvent', params);
    const dragPanel = async button => {
      const start = await panelPoint();
      const before = await camera(), buttons = button === 'middle' ? 4 : 1;
      await mouse({ type: 'mouseMoved', ...start });
      await mouse({ type: 'mousePressed', ...start, button, buttons, clickCount: 1 });
      for (const distance of [10, 25, 40]) await mouse({ type: 'mouseMoved', x: start.x + distance, y: start.y + distance, button, buttons });
      await waitFor(async () => (await camera()).x > before.x + 25);
      assert.equal((await camera()).z, before.z, 'Panel drag translates without zoom');
      await waitFor(async () => await evaluate(cdp, "document.querySelector('[data-side-panel]').style.willChange === 'transform'"));
      await mouse({ type: 'mouseMoved', ...start, button, buttons });
      await mouse({ type: 'mouseReleased', ...start, button, buttons: 0, clickCount: 1 });
      await idlePanel();
      const after = await camera(); // Hand-tool inertia may finish beyond the release point.
      await mouse({ type: 'mouseWheel', x: 1700, y: 150, deltaX: after.x - before.x, deltaY: after.y - before.y });
      await waitFor(async () => Math.abs((await camera()).x - before.x) < 1 && Math.abs((await camera()).y - before.y) < 1);
      await idlePanel();
    };
    await dragPanel('middle');
    await click('.diagram-canvas__controls button:nth-child(2)'); // Pan
    await dragPanel('left');
    await click('.diagram-canvas__controls button:nth-child(1)'); // Select
    await click('[data-side-panel] pre'); // Focus the canvas before the keyboard gesture.
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await dragPanel('left');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    const touch = await panelPoint(), touchCamera = await camera();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x + 50, y: touch.y + 50, id: 1 }] });
    await waitFor(async () => (await camera()).x > touchCamera.x + 25);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touch, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await idlePanel();
    const wheelPoint = await panelPoint(), beforeWheel = await camera();
    await mouse({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 40 });
    await waitFor(async () => (await camera()).y < beforeWheel.y - 25);
    await mouse({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -40 });
    await idlePanel();
    const beforeZoom = await camera();
    await mouse({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -30, modifiers: 2 });
    await waitFor(async () => (await camera()).z > beforeZoom.z);
    await idlePanel(); // The cached raster must not remain after zoom.
    await mouse({ type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 30, modifiers: 2 });
    await idlePanel();
    console.log('PASS panel wheel, middle drag, Pan, Space-drag, touch pan and zoom; pan raster released at rest');
    // Wait for autosave by observing the persisted workspace through the public endpoint.
    await waitFor(async () => { const response = await fetch(`${url}/api/mapping/workspace`); if (!response.ok) return false; const value = await response.json(); return JSON.stringify(value).includes('diagram-side-panel'); }, { timeoutMs: 20000 });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForSelector(cdp, '[data-panel-placement="flow"]');
    await waitFor(async () => (await text())?.includes('Alternative') && (await text())?.includes('Original'));
    await click('[aria-label="Close alternative panel"]');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('[data-side-panel]')"));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', modifiers: 2 });
    await waitForSelector(cdp, '[data-side-panel]');
    assert.deepEqual(errors, []);
    await click('[aria-label="Close alternative panel"]');
    await select();
    await click('[aria-label="Swap alternative Diff: Recorded edit"]');
    await waitFor(async () => (await text())?.includes('Alternative') && !(await text())?.includes('Original'));
    console.log('PASS light/dark panel theme consistency; root diff alternative: inline and SidePanel, alignment/flow, reload, undo and swap back');
  });
} finally {
  if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
