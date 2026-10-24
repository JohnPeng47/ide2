// Run after npm run build: node --import tsx tests/browser/mapping/browser-diagram-edit-ui-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { singleDiagramScene, projectCanvasSnapshot } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { asciiSha256 } from '../../../domain/core/diagrams/asciiSha256.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-edit-ui-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'First\n`-- Existing', nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene('First\n`-- Existing');
  const diagrams = revisionFixture();
  scene.contents = { ...scene.contents,
    overview: diagrams.create({ id: 'overview', revision: 0, ascii: 'First\n`-- Existing', structureKind: 'tree' }).diagram,
    second: diagrams.create({ id: 'second', revision: 0, ascii: 'Second\n`-- Other', structureKind: 'tree' }).diagram };
  scene.root.children.push({ id: 'second', kind: 'diagram', contentId: 'second', position: { column: 35, row: 0 }, collapsed: false });
  const revision = catalog.revisions['revision-overview'];
  revision.content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene }).history };
  revision.ascii = projectCanvasSnapshot(scene).ascii; revision.asciiSha256 = asciiSha256(revision.ascii);
  await writeFile(catalogPath, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw Error(`${e}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100,
    chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    let editRequests = 0;
    cdp.on('Network.requestWillBeSent', event => { if (event.request.url.endsWith('/tools/edit-diagram')) editRequests++; });
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const send = cdp.send.bind(cdp);
    cdp.send = async (method, parameters) => {
      let timer;
      try { return await Promise.race([send(method, parameters), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 15000); })]); }
      finally { clearTimeout(timer); }
    };
    const mouse = async (type, p, clickCount = 1, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount, modifiers });
    const click = async (selector, text) => {
      const p = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)}); if (!e || e.disabled) throw Error('Unavailable: '+${JSON.stringify(text ?? selector)}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse('mousePressed', p); await mouse('mouseReleased', p);
    };
    const diagramPoint = async id => evaluate(cdp, `(() => {const r=document.querySelector('[data-grid-box="${id}"]').getBoundingClientRect();return{x:r.x+8,y:r.y+8};})()`);
    const select = async id => { const p = await diagramPoint(id); await mouse('mousePressed', p, 2, 2); await mouse('mouseReleased', p, 2, 2); };
    const text = async () => evaluate(cdp, "[...document.querySelectorAll('[data-native-node] .mapping-poc-ascii')].map(el => el.textContent).join('\\n')");
    const historyKey = async key => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: `Key${key.toUpperCase()}`, modifiers: 2, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: `Key${key.toUpperCase()}`, modifiers: 2, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
    };
    await waitForSelector(cdp, '[data-grid-box=second]');
    await waitFor(async () => (await diagramPoint('overview')).x > 320);
    await select('overview'); await waitForSelector(cdp, '.mapping-diagram-selection-actions');
    await select('second');
    await waitFor(async () => evaluate(cdp, "[...document.querySelectorAll('.mapping-diagram-selection-actions button')].find(e=>e.textContent==='Update diagram with AI…')?.disabled"));
    await select('second');
    await click('.mapping-diagram-selection-actions button', 'Update diagram with AI…');
    await waitForSelector(cdp, '.prompt-composer .prompt-body-text');
    for (const action of ['Close', 'Cancel', 'Escape']) {
      await cdp.send('Input.insertText', { text: 'Changed my mind' });
      if (action === 'Escape') {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      } else await click('.prompt-composer button', action);
      await waitFor(async () => !await evaluate(cdp, "Boolean(document.querySelector('.prompt-composer, .prompt-composer-launcher'))"));
      assert.equal(editRequests, 0, 'Dismissing a prompt must not start generation');
      await click('.mapping-diagram-selection-actions button', 'Update diagram with AI…');
      await waitForSelector(cdp, '.prompt-composer .prompt-body-text');
      assert.equal(await evaluate(cdp, "document.querySelector('.prompt-composer .prompt-body-text').value"), '');
    }
    await cdp.send('Input.insertText', { text: 'UI whole diagram update' });
    // The expanded composer covers the canvas; minimize it to change the selection underneath.
    await click('.prompt-composer button', 'Minimize');
    await select('second');
    await click('.prompt-composer button', 'Restore');
    assert.ok(await evaluate(cdp, "document.querySelector('.prompt-composer .window-panel-header small').textContent.includes('/ First')"));
    await click('.prompt-composer button[type=submit]');
    await waitForSelector(cdp, '[data-edit-status=completed]', { timeoutMs: 15000 });
    assert.ok((await text()).includes('[edited: UI whole diagram update]'));
    await captureScreenshot(cdp, { output: process.env.UI_SCREENSHOT_PATH ?? path.join(root, 'completed.png') });
    await click('[aria-label="Close Update diagram with AI"]');
    await waitFor(async () => !await evaluate(cdp, "Boolean(document.querySelector('.prompt-composer, .prompt-composer-launcher'))"));
    console.log('PASS: Close/Cancel/Escape discard drafts without requests; completed updates dismiss; whole selection, multi-selection guard, pinned target and persistence acknowledgement');
    // Reload immediately after completion: no explicit Save action.
    let loaded = false; cdp.on('Page.loadEventFired', () => { loaded = true; });
    await cdp.send('Page.reload', { ignoreCache: true }); await waitFor(() => loaded);
    await waitForSelector(cdp, '[data-grid-box=overview]');
    await waitFor(async () => (await text()).includes('[edited: UI whole diagram update]'));
    assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.prompt-composer'))"), false);
    await click('.mapping-grid-tools > span');
    await historyKey('z');
    await waitFor(async () => !(await text()).includes('[edited: UI whole diagram update]'));
    await historyKey('y');
    await waitFor(async () => (await text()).includes('[edited: UI whole diagram update]'));
    // A normal text input keeps its own native undo/redo; it must not navigate canvas history.
    await click('input[placeholder="Find a diagram…"]');
    await cdp.send('Input.insertText', { text: 'Test filter' });
    await historyKey('z');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('input[placeholder=\"Find a diagram…\"]').value === ''"));
    assert.ok((await text()).includes('[edited: UI whole diagram update]'));
    await historyKey('y');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('input[placeholder=\"Find a diagram…\"]').value === 'Test filter'"));
    assert.ok((await text()).includes('[edited: UI whole diagram update]'));
    await historyKey('z');
    // Ctrl-drag part of the other diagram to expose the region action menu.
    await click('.mapping-diagram-selection-actions button', 'Deselect all');
    const start = await diagramPoint('second');
    const end = { x: start.x + 40, y: start.y + 22 };
    await mouse('mousePressed', start, 1, 2);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1, modifiers: 2 });
    await mouse('mouseReleased', end, 1, 2);
    await waitForSelector(cdp, '.retained-selection-controls');
    await click('.retained-selection-controls button', 'Actions (A)');
    await waitForSelector(cdp, '.mapping-poc-selection-actions');
    await click('.mapping-poc-selection-actions button', 'Update containing diagram with AI…');
    await waitForSelector(cdp, '.prompt-composer .prompt-body-text');
    assert.ok(await evaluate(cdp, "document.querySelector('.prompt-composer .window-panel-header small').textContent.includes('/ Second')"));
    assert.ok(await evaluate(cdp, "document.querySelector('.prompt-composer .window-panel-header small').textContent.includes('whole diagram')"));
    await cdp.send('Input.insertText', { text: 'UI region owner update' });
    await click('.prompt-composer button[type=submit]');
    await waitForSelector(cdp, '[data-edit-status=completed]', { timeoutMs: 15000 });
    assert.ok((await text()).includes('[edited: UI region owner update]'));
    assert.ok((await text()).includes('[edited: UI whole diagram update]'));
    console.log('PASS: immediate reload, Ctrl+Z/Ctrl+Y canvas undo/redo, native text undo/redo, Ctrl-selection action, whole-owner scope, unmapped diagram update');
  });
} finally {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
