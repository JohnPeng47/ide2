import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
// Run after npm run build: node --import tsx tests/browser/mapping/browser-connections-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { projectCanvasSnapshot, singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-connections-'));
const ascii = 'Root\n+-- Branch\n|   `-- Leaf\n`-- Footer';
let server;
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene(ascii);
  scene.contents.overview = new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram;
  scene.root.children.push({ id: 'second', kind: 'diagram', contentId: 'overview', collapsed: false, position: { column: 40, row: 3 }, collapsedContentId: 'overview-summary' });
  const revision = catalog.revisions['revision-overview'];
  revision.content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges: [] }).history };
  revision.ascii = projectCanvasSnapshot(scene).ascii;
  // Fixtures are seeded before startup. Every interaction below uses real pointer/keyboard input.
  await writeFile(catalogPath, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', data => errors += data);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    const browserErrors = [];
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => browserErrors.push(event.exceptionDetails.text));
    const click = async (selector, text, corner = false) => {
      const point = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !${JSON.stringify(text ?? '')} || e.textContent.trim() === ${JSON.stringify(text ?? '')}); if(!e) throw new Error('Missing '+${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); return {x:r.left+${corner ? '2' : 'r.width/2'},y:r.top+${corner ? 'r.height-2' : 'r.height/2'}}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const key = async (key, code, value) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: value });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: value });
    };
    const count = () => evaluate(cdp, 'document.querySelectorAll("[data-connection-id]").length');
    const arrowPath = () => evaluate(cdp, 'document.querySelector("[data-connection-id] > path").getAttribute("d")');
    const anchor = (end, box, label, line) => `[aria-label="Connect ${end}: ${box} · ${label} (line ${line})"]`;
    await waitForSelector(cdp, '[data-grid-box="second"]');
    await click('.mapping-grid-tools button', 'Connections (0)');
    await click('.diagram-connections-panel button', 'New connection');
    await click(anchor('source', 'overview', 'Leaf', 3));
    await click('[aria-label="Connect target: second · whole box"]', undefined, true);
    await click('[aria-label="Connection label"]'); await cdp.send('Input.insertText', { text: 'Uses' });
    await click('.diagram-connections-panel button', 'Create connection');
    await waitFor(async () => await count() === 1);
    const originalPath = await arrowPath();
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".mapping-submenu [role=status]").textContent') === 'Unsaved changes');
    await click('[aria-label="Close connections"]');
    // Collapsing proxies the source at the branch without changing its semantic attachment.
    await click('[data-subtree-owner="grid:overview"][data-subtree-line="2"]');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-connection-id]").dataset.connectionStatus') === 'proxy');
    assert.notEqual(await arrowPath(), originalPath);
    await click('[data-subtree-owner="grid:overview"][data-subtree-line="2"]');
    await waitFor(async () => await arrowPath() === originalPath);
    await click('.mapping-grid-tools button', 'Undo');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-connection-id]").dataset.connectionStatus') === 'proxy');
    await click('.mapping-grid-tools button', 'Redo');
    await waitFor(async () => await arrowPath() === originalPath);
    // Select the actual SVG hit path, then edit through the same form.
    const hit = await evaluate(cdp, `(() => { const p=document.querySelector('.diagram-connection-hit'),point=p.getPointAtLength(p.getTotalLength()/2);return new DOMPoint(point.x,point.y).matrixTransform(p.getScreenCTM()).toJSON(); })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', buttons: 0, clickCount: 1 });
    await waitForSelector(cdp, '.diagram-connections-panel');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Connection label"]').value`), 'Uses');
    await click('[aria-label="source side offset"]');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await cdp.send('Input.insertText', { text: '0.25' });
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="source side offset"]').value`), '0.25');
    await click('.diagram-connections-panel button', 'Update connection');
    await click('[aria-label="Close connections"]');
    // Existing Move interaction must carry the destination arrow with it.
    await click('[data-grid-box="second"] .mapping-grid-box-tools button', 'Move');
    const point = await evaluate(cdp, `(() => {const e=document.querySelector('.mapping-poc-ascii'),r=e.getBoundingClientRect(),m=document.querySelector('.diagram-connections').getScreenCTM(),s=Math.hypot(m.a,m.b),w=document.querySelector('.mapping-poc-cell-probe').getBoundingClientRect().width/10,h=parseFloat(getComputedStyle(e).lineHeight);return {x:r.left+60.3*w,y:r.top+8.3*h*s};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-grid-box=second]").dataset.gridColumn') === '60');
    assert.notEqual(await arrowPath(), originalPath);
    await click('.mapping-grid-tools button', 'Connections (1)');
    await click('.diagram-connections-panel button', 'New connection');
    await click(anchor('source', 'overview', 'Branch', 2));
    await click(anchor('target', 'second', 'Footer', 4));
    await click('[aria-label="Connection line style"]'); await key('End', 'End', 35); await key('Enter', 'Enter', 13);
    await click('.diagram-connections-panel button', 'Create connection');
    await waitFor(async () => await count() === 2);
    assert.equal(await evaluate(cdp, '[...document.querySelectorAll("[data-connection-id] > g > path[stroke-dasharray]")].filter(p=>p.getAttribute("stroke-dasharray")).length'), 1);
    await click('.diagram-connections-panel li button', 'Uses');
    await click('.diagram-connections-panel button', 'Delete connection');
    await waitFor(async () => await count() === 1);
    await click('[aria-label="Close connections"]');
    await click('.mapping-grid-tools button', 'Undo'); await waitFor(async () => await count() === 2);
    await captureScreenshot(cdp, { output: process.env.CONNECTION_SCREENSHOT ?? path.join(root, 'connections.png') });
    await click('.mapping-submenu button', 'Save');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".mapping-submenu [role=status]").textContent') === 'Saved');
    let saved = JSON.parse(await readFile(catalogPath, 'utf8'));
    const current = saved.revisions[saved.representations['representation-overview'].currentRevisionId];
    assert.equal(current.content.edges.length, 2);
    assert.deepEqual(current.content.scene.contents, JSON.parse(JSON.stringify(scene.contents)));
    assert.equal(current.content.edges[0].target.kind, 'box');
    assert.equal(current.content.edges[0].source.offset, 0.25);
    assert.equal(current.content.edges[1].target.kind, 'content-node');
    await cdp.send('Page.navigate', { url: `${url}/mapping` });
    await waitFor(async () => await count() === 2);
    // Saving/restoring a workspace includes connections and the saved baseline.
    await click('.mapping-workspace-actions button', 'Save workspace');
    await waitFor(async () => { try { return JSON.parse(await readFile(path.join(root, '.diagrams/mapping-workspace.json'), 'utf8')).documents[0].document.edges.length === 2; } catch { return false; } });
    await cdp.send('Page.navigate', { url: `${url}/mapping` });
    await waitFor(async () => await count() === 2);
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-submenu [role=status]").textContent'), 'Saved');
    assert.deepEqual(browserErrors, []);
    console.log('Connections: pointer creation, node/box targets, styling, movement, folding, undo/redo, deletion, catalog reopen and workspace reload passed; diagram content unchanged.');
  });
} finally { server?.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); }
