import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-search-browser-'));
let server;
try {
  const ascii = 'Root\n|-- Branch\n|   |-- Needle alpha\n|   `-- needle beta\n`-- Tail';
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene(ascii);
  scene.contents.overview = new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram;
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges: [] }).history };
  const remoteRevision = { ...catalog.revisions['revision-overview'], id: 'revision-remote', representationId: 'representation-remote',
    ascii: 'Remote\n`-- needle remote', content: { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene: singleDiagramScene('Remote\n`-- needle remote'), edges: [] }).history } };
  catalog.revisions[remoteRevision.id] = remoteRevision;
  catalog.representations['representation-remote'] = { ...catalog.representations['representation-overview'],
    id: 'representation-remote', name: 'Remote canvas', currentRevisionId: remoteRevision.id, revisionIds: [remoteRevision.id] };
  await writeFile(catalogPath, JSON.stringify(catalog));
  const store = new DiagramStore(root), changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, { list: () => [] });
  const proposal = await changes.create({ title: 'Search proposal', requestId: 'create-search-proposal' });
  await changes.apply(proposal.changeSessionId, 'representation-overview', 0,
    [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 3, end: 3, patch: '|   |-- ProposalOnly' }], 'proposal-search-edit');
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const exceptions = []; await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.text));
    await cdp.send('Page.enable');
    // This fixture is disposable; allow the reload despite pending view autosaves.
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const send = cdp.send.bind(cdp);
    cdp.send = (method, parameters) => {
      let timer;
      return Promise.race([send(method, parameters), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 15000);
      })]).finally(() => clearTimeout(timer));
    };
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled && ${text ? `el.textContent.includes(${JSON.stringify(text)})` : 'true'}); if(!el)return null; const r=el.getBoundingClientRect(); return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`);
        return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const search = async (text, global = false) => {
      await key('f', 'KeyF', 70, global ? 10 : 2);
      await waitForSelector(cdp, '[aria-label="Search diagram text"]');
      await key('a', 'KeyA', 65, 2);
      await cdp.send('Input.insertText', { text });
    };
    const count = async n => waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-search-panel [role=status]')?.textContent === '${n} matching ${n === 1 ? 'line' : 'lines'}'`),
      { message: `Expected ${n} search results` }).catch(async error => {
        console.error(await evaluate(cdp, "({status:document.querySelector('.diagram-search-panel [role=status]')?.textContent,body:document.body.innerText.slice(-2500)})")); throw error;
      });
    await waitForSelector(cdp, '[aria-label="Collapse subtree Branch"]');
    await click('[aria-label="Collapse subtree Branch"]');
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-poc-ascii").textContent.includes("Needle alpha")'), false);
    await search('needle'); await count(2);
    const queryHistory = () => evaluate(cdp, "JSON.parse(localStorage.getItem('diagram-search-queries') ?? '[]')");
    const queryText = () => evaluate(cdp, "document.querySelector('[aria-label=\"Search diagram text\"]').value");
    assert.deepEqual(await queryHistory(), [], 'typing and automatic searching do not persist queries');
    const highlights = () => evaluate(cdp, "document.querySelectorAll('.mapping-document-view:not([hidden]) .diagram-search-highlight').length");
    const focusedLine = () => evaluate(cdp, "Number(document.querySelector('.mapping-document-view:not([hidden]) .diagram-search-highlight.is-current')?.dataset.searchLine)");
    await waitFor(async () => await highlights() === 2);
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-poc-ascii").textContent.includes("Needle alpha")'), true, 'automatic selection reveals folded matches');
    await key('Enter', 'Enter', 13); await waitFor(async () => await focusedLine() === 3);
    await key('Enter', 'Enter', 13); await waitFor(async () => await focusedLine() === 4);
    await key('Enter', 'Enter', 13); await waitFor(async () => await focusedLine() === 3);
    await key('Enter', 'Enter', 13, 8); await waitFor(async () => await focusedLine() === 4);
    assert.deepEqual(await queryHistory(), ['needle'], 'Enter cycling does not duplicate history');
    await search('Tail'); await click('[aria-label="Run diagram search"]'); await count(1);
    assert.deepEqual(await queryHistory(), ['Tail', 'needle']);
    await search('Branch'); await count(1); await click('[data-search-result-line="2"]');
    assert.deepEqual(await queryHistory(), ['Tail', 'needle'], 'clicking a result does not submit query history');
    await search('unfinished query'); await count(0);
    await key('ArrowUp', 'ArrowUp', 38); assert.equal(await queryText(), 'Tail');
    await key('ArrowUp', 'ArrowUp', 38); assert.equal(await queryText(), 'needle');
    await key('ArrowDown', 'ArrowDown', 40); assert.equal(await queryText(), 'Tail');
    await key('ArrowDown', 'ArrowDown', 40); assert.equal(await queryText(), 'unfinished query');
    assert.deepEqual(await queryHistory(), ['Tail', 'needle'], 'browsing history does not persist the unfinished query');
    await key('Enter', 'Enter', 13);
    assert.deepEqual(await queryHistory(), ['unfinished query', 'Tail', 'needle'], 'Enter saves a query even with no results');
    await search('needle'); await count(2); await waitFor(async () => await highlights() === 2);
    await key('Escape', 'Escape', 27);
    assert.equal(await highlights(), 2, 'minimizing preserves all highlights');
    await click('[aria-label="Search diagrams"]');
    await key('a', 'KeyA', 65, 2); await key('Backspace', 'Backspace', 8);
    await waitFor(async () => await highlights() === 0);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-search-result-line]').length"), 0, 'clearing drops results and focused highlight');
    await click('.diagram-search-options label', 'Auto-select matches');
    await search('needle'); await count(2);
    assert.equal(await highlights(), 0, 'disabled auto selection leaves results available without canvas highlights');
    await key('Enter', 'Enter', 13); await waitFor(async () => await focusedLine() === 3);
    await click('.diagram-search-options label', 'Auto-select matches');
    await waitFor(async () => await highlights() === 2);
    console.log('PASS: auto-select, Enter wraparound, minimize, clear, and toggle');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Diagram search scope"]').value`), 'canvas');
    await click('[data-search-result-line="3"]');
    await waitForSelector(cdp, '[data-search-line="3"]');
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-poc-ascii").textContent.includes("Needle alpha")'), true);
    const aligned = await evaluate(cdp, `(() => {const h=document.querySelector('[data-search-line="3"]').getBoundingClientRect();const label=[...document.querySelectorAll('.diagram-content-node')].find(n=>n.textContent==='Needle alpha').getBoundingClientRect();return Math.abs(h.top-label.top)<3 && Math.abs(h.left-label.left)<3;})()`);
    assert.ok(aligned, 'highlight aligns with the revealed raw line');
    await captureScreenshot(cdp, { output: path.join(root, 'search-folded-match.png') });
    await click('.diagram-search-options input[type=checkbox]'); await count(1);
    await click('.diagram-search-options input[type=checkbox]'); await count(2);
    await search('needle', true); await count(3);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    const targets = await cdp.send('Target.getTargets');
    const pageTarget = targets.targetInfos.find(t => t.type === 'page' && t.url.startsWith(url));
    assert.ok(targets.targetInfos.some(t => t.type === 'worker' && t.parentId === pageTarget.targetId), 'search runs in a real Web Worker');
    await click('[data-search-result-canvas="representation-remote"]');
    await waitForSelector(cdp, '.mapping-document-view:not([hidden]) [data-search-line="2"]');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]').value`), 'Remote canvas');
    await key('Escape', 'Escape', 27);
    // Paste a new, unsaved diagram through the public canvas UI.
    await evaluate(cdp, `Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=> 'Unsaved\\n\\x60-- needle draft'}})`);
    const point = await evaluate(cdp, `(() => {const b=document.querySelector('.mapping-document-view:not([hidden]) [data-grid-box="overview"]'),r=b.getBoundingClientRect(),w=r.width/Number(b.dataset.gridColumns),h=r.height/Number(b.dataset.gridRows);return {x:r.left+25*w,y:r.top+8*h};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'right', clickCount: 1 });
    await click('.canvas-paste-menu button');
    await search('needle', true); await count(4);
    await click('.mapping-document-view:not([hidden]) .mapping-grid-tools button', 'Undo'); await count(3);
    await click('.mapping-document-view:not([hidden]) .mapping-grid-tools button', 'Redo'); await count(4);
    await click('.diagram-search-options label', 'Auto-select matches');
    await key('Escape', 'Escape', 27);
    await click('.mapping-submenu button', 'Save');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".mapping-submenu [role=status]")?.textContent === "Saved"'));
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(Error('Timed out reloading search fixture')); }, 20000);
      const off = cdp.on('Page.loadEventFired', () => { clearTimeout(timer); off(); resolve(); });
    });
    await cdp.send('Page.reload', { ignoreCache: true }); await loaded;
    await waitForSelector(cdp, '.mapping-document-view:not([hidden]) [data-grid-box="overview"]');
    await search('needle', true); await count(4);
    assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.diagram-search-options label')].find(label=>label.textContent.includes('Auto-select')).querySelector('input').checked"), false, 'auto-select preference survives reload');
    assert.deepEqual(await queryHistory(), ['needle', 'unfinished query', 'Tail'], 'only submitted queries survive reload');
    await key('ArrowUp', 'ArrowUp', 38); assert.equal(await queryText(), 'needle');
    await key('ArrowUp', 'ArrowUp', 38); assert.equal(await queryText(), 'unfinished query');
    await search('needle', true); await count(4);
    assert.equal(await highlights(), 0);
    await click('.diagram-search-options label', 'Auto-select matches');
    await key('Escape', 'Escape', 27);
    await click('[role=tab]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary', 'Search proposal');
    await click('nav[aria-label="Diagram changes"] button', 'Current LLM prompt stack');
    await waitForSelector(cdp, '.change-preview-stage');
    await search('ProposalOnly'); await count(1);
    await key('Enter', 'Enter', 13);
    await waitForSelector(cdp, '.change-preview-stage [data-search-line="3"]');
    assert.ok(await evaluate(cdp, `(() => {const h=document.querySelector('.change-preview-stage [data-search-line="3"]').getBoundingClientRect();const label=[...document.querySelectorAll('.change-preview-stage .diagram-content-node')].find(n=>n.textContent==='ProposalOnly').getBoundingClientRect();return Math.abs(h.top-label.top)<3 && Math.abs(h.left-label.left)<3;})()`), 'proposal highlight accounts for inserted diff rows and prefixes');
    if (process.env.SEARCH_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.SEARCH_SCREENSHOT });
    await search('ProposalOnly', true); await count(0);
    await search('needle', true); await count(4);
    // A later query must win even while a previous one is producing results.
    await search('absent', true); await search('remote', true); await count(2);
    assert.deepEqual(exceptions, []);
    console.log('PASS: automatic selection toggle, folded matches, Enter/Shift+Enter cycling and wrap, minimized highlights, clear, worker, local/global shortcuts, exact highlight, case sensitivity, unopened canvas, unsaved edits, undo/redo, reload, proposal isolation, latest query');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
