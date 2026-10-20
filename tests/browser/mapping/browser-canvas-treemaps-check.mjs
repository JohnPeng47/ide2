// npm run build && node --import tsx tests/browser/mapping/browser-canvas-treemaps-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'canvas-treemap-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/a.ts'), 'a\nb\nc\nd\ne\nf\ng\n');
  const store = new DiagramStore(root), project = await store.loadProject();
  const source = { sourceId: 'fixture-source', repositoryIdentity: path.join(root, '.git'), corpus: { kind: 'git-worktree', root }, domainProfileId: 'source-code' };
  const ascii = 'Root\n`-- Parent\n    `-- Child', scene = singleDiagramScene(ascii, source);
  scene.root.children[0].position = { column: 7, row: 3 };
  scene.contents.overview = new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree', source,
    evidence: { parent: { id: 'parent', label: 'Parent', handle: 'parent', category: 'operation', summary: 'Parent', sourceRanges: [{ id: 'p', path: 'src/a.ts', startLine: 1, endLine: 4, originalLines: ['a', 'b', 'c', 'd'] }] },
      child: { id: 'child', label: 'Child', handle: 'child', category: 'operation', summary: 'Child', sourceRanges: [{ id: 'c', path: 'src/a.ts', startLine: 3, endLine: 5, originalLines: ['c', 'd', 'e'] }] } },
    mappings: [{ id: 'parent', entityId: 'parent', sourceRangeIndex: 0, line: 2, startColumn: 5, endColumn: 10 },
      { id: 'duplicate', entityId: 'parent', sourceRangeIndex: 0, line: 2, startColumn: 5, endColumn: 10 },
      { id: 'child', entityId: 'child', sourceRangeIndex: 0, line: 3, startColumn: 9, endColumn: 13 }]
  }).diagram;
  await store.projectCatalogs.saveMappingDiagram(project.id, canvasSaveFixture({ name: 'Current LLM prompt stack', scene,
    representationId: 'representation-overview', expectedRevisionId: 'revision-overview' }));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1680, height: 1050, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const errors = [], requests = [];
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    await cdp.send('Page.enable'); cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    await cdp.send('Network.enable'); cdp.on('Network.requestWillBeSent', event => requests.push(event.request.url));
    const click = async (selector, text) => {
      if (selector.startsWith('.mapping-workspace-actions') && !await evaluate(cdp, '!!document.querySelector(".mapping-workspace-actions")')) await click('[aria-label="Menu"]');
      let point;
      await waitFor(async () => (point = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!e.disabled && e.getBoundingClientRect().width && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); if(!e)return;const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:null; })()`)));
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    const key = async (key, code) => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code }); };
    const scope = async value => {
      await click('select[aria-label="Treemap scope"]');
      await key(value === 'files' ? 'End' : 'Home', value === 'files' ? 35 : 36);
      await key('Enter', 13);
      await waitFor(async () => await evaluate(cdp, `document.querySelector('select[aria-label="Treemap scope"]').value===${JSON.stringify(value)}`));
    };
    const totals = () => evaluate(cdp, "[...document.querySelectorAll('[aria-label=\"Source LOC totals\"] strong')].map(e=>Number(e.textContent))");
    await waitForSelector(cdp, '[aria-label="Menu"]');
    await click('.mapping-workspace-actions button', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Workspace tools"] [role=tab][aria-selected=true]').textContent`), 'Treemaps');
    assert.deepEqual(await totals(), [5, 5, 0, 2]);
    assert.equal(await evaluate(cdp, "document.querySelector('select[aria-label=\"Treemap scope\"]').value"), 'mapped');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-selection, .change-treemap-region-picker, .change-treemap-footnote').length"), 0);
    assert.ok(await evaluate(cdp, "document.querySelector('.treemap-notice').textContent.includes('5 mapped / 7 file LOC · 71.4% coverage')"));
    await waitForSelector(cdp, '.mapping-native-body .canvas-treemap-tint');
    await click('.window-panel-tabbed [role=tab]', 'Search');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.canvas-treemap-tint')"));
    await click('.window-panel-tabbed [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.mapping-native-body .canvas-treemap-tint');
    assert.deepEqual(await totals(), [5, 5, 0, 2], 'Returning to Treemaps reads the current canvas');

    assert.ok(await evaluate(cdp, `(() => {
      const tints=[...document.querySelectorAll('.mapping-document-view:not([hidden]) .canvas-treemap-tint')];
      const box=tints[0].parentElement.querySelector('[data-grid-box]'), w=parseFloat(box.style.width), h=parseFloat(box.style.height);
      return tints.every(t=>parseFloat(t.style.left)>=0 && parseFloat(t.style.top)>=0 && parseFloat(t.style.left)+parseFloat(t.style.width)<=w+.01 && parseFloat(t.style.top)+parseFloat(t.style.height)<=h+.01)
        && Math.abs(tints.reduce((sum,t)=>sum+parseFloat(t.style.width)*parseFloat(t.style.height),0)-w*h)<.1;
    })()`), 'Native canvas tiles fill their diagram without a doubled scene offset');
    await click('.change-treemap-cell[data-treemap-kind=diagram] button');
    await click('.change-treemap-zoom-controls button', 'Zoom in');
    await click('.change-treemap-cell button[aria-label^="Parent:"]');
    await waitFor(async () => await evaluate(cdp, `(() => {
      const label=document.querySelector('.mapping-document-view:not([hidden]) .diagram-content-node[data-jump-focus]');
      if(!label)return false;const r=label.getBoundingClientRect(), panel=document.querySelector('.window-panel-tabbed').getBoundingClientRect();
      return r.right<panel.left && r.left>315;
    })()`));
    await click('.change-treemap-zoom-controls button', 'Zoom in');
    await waitForSelector(cdp, '.change-treemap-cell button[aria-label^="Child:"]');
    const point = await evaluate(cdp, `(() => {const r=document.querySelector('.change-treemap-cell button[aria-label^="Child:"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const camera = () => evaluate(cdp, "document.querySelector('.mapping-document-view:not([hidden]) [data-grid-box]').getBoundingClientRect().toJSON()");
    const cameraBeforeHover = await camera();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await waitForSelector(cdp, '.change-treemap-tooltip');
    await waitForSelector(cdp, '.mapping-document-view:not([hidden]) .treemap-canvas-hover');
    assert.equal(await evaluate(cdp, `(() => {
      const tile=document.querySelector('.change-treemap-cell button[aria-label^="Child:"]').parentElement;
      const outline=document.querySelector('.mapping-document-view:not([hidden]) .treemap-canvas-hover');
      return outline.dataset.diagramPosition===tile.dataset.diagramPosition && getComputedStyle(outline).borderTopWidth==='2px';
    })()`), true, 'Hover outlines the corresponding native canvas region');
    assert.deepEqual(await camera(), cameraBeforeHover, 'Hover leaves native canvas camera unchanged');
    if (process.env.CANVAS_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CANVAS_TREEMAP_SCREENSHOT.replace('.png', '-hover.png') });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.treemap-canvas-hover')"));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await waitForSelector(cdp, '.change-treemap-tooltip');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-tooltip').textContent"), '2 LOC · 40%');
    assert.equal(await evaluate(cdp, `(() => {const t=document.querySelector('.change-treemap-tooltip'),a=t.getBoundingClientRect(),b=document.querySelector('[aria-describedby="'+t.id+'"]').parentElement.getBoundingClientRect();return a.left>=b.right || a.right<=b.left || a.top>=b.bottom || a.bottom<=b.top;})()`), true);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-tooltip-diff').length"), 0);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    const regionPoint = await evaluate(cdp, `(() => {
      const tile=document.querySelector('.change-treemap-cell button[aria-label^="Child:"]').parentElement;
      const region=[...document.querySelectorAll('.mapping-document-view:not([hidden]) .canvas-treemap-tint')].find(e=>e.dataset.treemapRegion===tile.dataset.nodeId);
      const r=region.getBoundingClientRect();return {x:r.right-3,y:r.top+r.height/2};
    })()`);
    const cameraBeforeSelect = await camera();
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...regionPoint, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-selected=true] button')?.getAttribute('aria-label').startsWith('Child:') && !!document.querySelector('.change-treemap-tooltip')"));
    assert.deepEqual(await camera(), cameraBeforeSelect, 'Canvas selection reveals treemap without camera movement');
    assert.equal(await evaluate(cdp, "document.activeElement.closest('.change-treemap-cell')?.dataset.selected"), 'true');
    if (process.env.CANVAS_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CANVAS_TREEMAP_SCREENSHOT.replace('.png', '-reverse.png') });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.change-treemap-tooltip') && !document.querySelector('.treemap-canvas-hover')"));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...regionPoint, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: regionPoint.x + 12, y: regionPoint.y, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: regionPoint.x + 12, y: regionPoint.y, button: 'left', buttons: 0, clickCount: 1 });
    await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await evaluate(cdp, "!!document.querySelector('.change-treemap-tooltip')"), false, 'Dragging a region does not trigger reverse selection');
    await click('.change-treemap-zoom-controls button', 'Reset zoom');
    const identities = await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell[data-treemap-color]')].map(e=>[e.dataset.nodeId,e.dataset.treemapColor])");
    await scope('files');
    const panelSize = () => evaluate(cdp, '(() => { const r = document.querySelector(".window-panel-tabbed").getBoundingClientRect(); return {width:r.width,height:r.height}; })()');
    const originalSize = await panelSize();
    await click('.window-panel-tabbed > .window-panel-resize-corner');
    await key('ArrowRight', 39); await key('ArrowUp', 38);
    const resizedSize = await panelSize();
    assert.ok(resizedSize.width < originalSize.width);
    assert.ok(resizedSize.height < originalSize.height);
    assert.deepEqual(await totals(), [7, 5, 2, 2]);
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-treemap-kind=unmapped]').dataset.loc"), '2');
    assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell[data-treemap-color]')].map(e=>[e.dataset.nodeId,e.dataset.treemapColor])"), identities);
    await click('.change-treemap-switch button', 'Files');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-treemap-kind=file]').dataset.loc"), '7');
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('.canvas-treemap-tint').length===0"));
    await scope('mapped');
    assert.deepEqual(await totals(), [5, 5, 0, 2]);
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-treemap-kind=file]').dataset.loc"), '5');
    await click('.change-treemap-switch button', 'Diagrams');
    await click('.theme-toggle');
    await captureScreenshot(cdp, { output: process.env.CANVAS_TREEMAP_SCREENSHOT ?? path.join(root, 'canvas-treemap.png') });
    await scope('files');
    await click('[aria-label="Close Workspace tools"]');
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('.canvas-treemap-tint').length===0"));
    await click('.mapping-workspace-actions button', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.deepEqual(await panelSize(), resizedSize, 'Treemap size was lost on reopening');
    await cdp.send('Page.reload');
    await waitForSelector(cdp, '[aria-label="Menu"]');
    await click('.mapping-workspace-actions button', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.deepEqual(await panelSize(), resizedSize, 'Treemap size was lost on reload');
    assert.deepEqual(await totals(), [7, 5, 2, 2]);
    await writeFile(path.join(root, 'src/a.ts'), 'a\nb\nchanged\nd\ne\nf\ng\n');
    await click('.change-treemap-switch button', 'Refresh sources');
    await waitFor(async () => JSON.stringify(await totals()) === '[7,0,7,0]');
    assert.ok(await evaluate(cdp, "document.querySelector('.treemap-notice').textContent.includes('3 stale')"));
    assert.equal(requests.some(url => /diagram-edits|create-diagram|extend-diagram/.test(url)), false);
    assert.deepEqual(errors, []);
    console.log('PASS canvas mapped/file scopes, equal totals, overlap discounting, stale source refresh, source-only tooltips, native canvas tints, shared zoom controls, theme, scope persistence and cleanup without LLM calls');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
