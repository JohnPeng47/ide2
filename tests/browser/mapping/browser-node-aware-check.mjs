import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
// Run after npm run build: node --import tsx tests/browser/mapping/browser-node-aware-check.mjs
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
import { asciiSha256 } from '../../../domain/core/diagrams/asciiSha256.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'node-aware-rendering-'));
const ascii = 'Root\n|-- Group\n|   |-- [*] Rendering\n|   `-- Leaf\n`-- Footer  \n\n[*] Fallback';
let server;
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const source = singleDiagramScene(ascii);
  source.contents.overview = new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram;
  source.root.children.push({ ...source.root.children[0], id: 'second', position: { column: 35, row: 1 } });
  const targetAscii = 'Node-aware rendering\n|-- Shared renderer\n|   `-- DOM labels\n`-- Coordinates';
  const target = singleDiagramScene(targetAscii);
  target.contents.overview = new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii: targetAscii, structureKind: 'tree' }).diagram;
  const targetNode = Object.values(target.contents.overview.content.structure.nodes).find(node => node.label === 'DOM labels');
  const content = source.contents.overview.content;
  const from = (line, startColumn) => ({ revisionId: content.revisionId, contentHash: content.asciiSha256,
    line, startColumn, endColumn: ascii.split('\n')[line - 1].length });
  source.contents.overview.jumps = [
    { id: 'rendering', source: from(3, 9), target: { representationId: 'representation-target', displayNodeId: 'grid:overview', contentNodeId: targetNode.id } },
    { id: 'fallback', source: from(7, 1), target: { representationId: 'representation-target' } }
  ];
  const revision = catalog.revisions['revision-overview'];
  revision.content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene: source, edges: [] }).history };
  revision.ascii = projectCanvasSnapshot(source).ascii;
  revision.asciiSha256 = asciiSha256(revision.ascii);
  const targetRevision = { ...revision, id: 'revision-target', representationId: 'representation-target',
    ascii: targetAscii, asciiSha256: asciiSha256(targetAscii), content: { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene: target, edges: [] }).history } };
  catalog.revisions[targetRevision.id] = targetRevision;
  catalog.representations['representation-target'] = { ...catalog.representations['representation-overview'], id: 'representation-target',
    handle: 'rendering', name: 'Node-aware rendering', currentRevisionId: targetRevision.id, revisionIds: [targetRevision.id] };
  const savedCatalog = JSON.stringify(catalog);
  await writeFile(catalogPath, savedCatalog);
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', data => errors += data);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (...args) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${args[0]}`)), 15000);
      send(...args).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
    const browserErrors = [];
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => { void cdp.send('Page.handleJavaScriptDialog', { accept: true }); });
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => browserErrors.push(event.exceptionDetails.text));
    const visible = '.mapping-document-view:not([hidden]) ';
    const click = async selector => {
      const point = await evaluate(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw new Error('Missing '+${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const text = () => evaluate(cdp, `document.querySelector('${visible}.mapping-poc-ascii')?.textContent`);
    const name = () => evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]')?.value`);
    const checkGlyphs = async () => {
      const result = await evaluate(cdp, `(() => {
        const pre=document.querySelector('${visible}.mapping-poc-ascii');
        const plain=pre.cloneNode(false); plain.textContent=pre.textContent;
        Object.assign(plain.style,{position:'absolute',left:pre.offsetLeft+'px',top:pre.offsetTop+'px',pointerEvents:'none',visibility:'hidden'});
        pre.parentElement.appendChild(plain);
        try {
          const measure=e=>{ const origin=e.getBoundingClientRect(), walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT), out=[]; let node;
            while(node=walker.nextNode()) for(let i=0;i<node.length;i++){const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1); const b=r.getBoundingClientRect();out.push({c:node.data[i],x:b.left-origin.left,y:b.top-origin.top,w:b.width,h:b.height});} return out; };
          const actual=measure(pre), expected=measure(plain);
          const mismatch=actual.findIndex((a,i)=>!expected[i]||['x','y','w','h'].some(k=>Math.abs(a[k]-expected[i][k])>.15)||a.c!==expected[i].c);
          return {length:actual.length,expectedLength:expected.length,mismatch,actual:actual[mismatch],expected:expected[mismatch],height:pre.getBoundingClientRect().height,plainHeight:plain.getBoundingClientRect().height};
        } finally { plain.remove(); }
      })()`);
      assert.equal(result.length, result.expectedLength);
      assert.equal(result.mismatch, -1, JSON.stringify(result));
      assert.equal(result.height, result.plainHeight);
    };
    await waitForSelector(cdp, `${visible}.diagram-jump`);
    assert.equal(await text(), revision.ascii);
    await checkGlyphs();
    assert.equal(await evaluate(cdp, `document.querySelectorAll('${visible}.diagram-content-node[data-source-line="3"]').length`), 2);
    assert.equal(await evaluate(cdp, `!!document.querySelector('${visible}[data-diagram-jump-id="fallback"]').closest('.diagram-content-node')`), false);
    // Zoom must not change the relative glyph positions compared with raw <pre> text.
    const zoomPoint = await evaluate(cdp, `(() => {const r=document.querySelector('${visible}.mapping-poc-ascii').getBoundingClientRect();return{x:r.left+20,y:r.top+20};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...zoomPoint, deltaX: 0, deltaY: -140, modifiers: 2 });
    await waitFor(async () => await evaluate(cdp, `document.querySelector('${visible}[aria-label="Diagram zoom"]').textContent`) !== '100%');
    await checkGlyphs();
    await click(`${visible}[title="Reset zoom and center diagram"]`);
    await waitFor(async () => await evaluate(cdp, `document.querySelector('${visible}[aria-label="Diagram zoom"]').textContent`) === '100%');
    // Ctrl-drag starts on an interactive jump without activating navigation.
    const selection = await evaluate(cdp, `(() => {const r=document.querySelector('${visible}[data-diagram-jump-id="rendering"]').getBoundingClientRect();return {start:{x:r.left+2,y:r.top+r.height/2},end:{x:r.right-2,y:r.top+r.height/2}};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...selection.start, button: 'left', buttons: 1, modifiers: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...selection.end, button: 'left', buttons: 1, modifiers: 2 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...selection.end, button: 'left', buttons: 0, modifiers: 2, clickCount: 1 });
    await waitForSelector(cdp, `${visible}.mapping-poc-selection-menu`);
    assert.equal(await name(), 'Current LLM prompt stack');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(async () => !await evaluate(cdp, `!!document.querySelector('${visible}.mapping-poc-selection-menu')`));
    // Folding a pipe branch only hides its own instance's text and jump.
    await click(`${visible}[data-subtree-owner="grid:overview"][data-subtree-line="2"]`);
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('${visible}[data-diagram-jump-id="rendering"]').length`) === 1);
    await checkGlyphs();
    await click(`${visible}[data-subtree-owner="grid:overview"][data-subtree-line="2"]`);
    await waitFor(async () => await text() === revision.ascii);
    // Make the destination label hidden, then navigate back to the source.
    await click('[data-project-diagram="representation-target"]');
    await waitFor(async () => await name() === 'Node-aware rendering');
    await click(`${visible}[data-subtree-owner="grid:overview"][data-subtree-line="2"]`);
    await waitFor(async () => !(await text()).includes('DOM labels'));
    await click('[data-project-diagram="representation-overview"]');
    await waitFor(async () => await name() === 'Current LLM prompt stack');
    // Editing only the name demonstrates that jumping preserves the unsaved source draft.
    await click('[aria-label="Diagram name"]');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.insertText', { text: 'Unsaved source draft' });
    await click(`${visible}[data-diagram-jump-id="rendering"]`);
    await waitFor(async () => await name() === 'Node-aware rendering');
    await waitForSelector(cdp, `${visible}[data-jump-focus]`);
    assert.equal(await evaluate(cdp, `document.querySelector('${visible}[data-jump-focus]').textContent`), 'DOM labels');
    await checkGlyphs();
    await captureScreenshot(cdp, { output: process.env.NODE_AWARE_SCREENSHOT ?? path.join(root, 'node-aware.png') });
    await click('[data-project-diagram="representation-overview"]');
    await waitFor(async () => await name() === 'Unsaved source draft');
    assert.equal(await text(), revision.ascii);
    // A link on unparsed text still works through its exact source range.
    await click(`${visible}[data-diagram-jump-id="fallback"]`);
    await waitFor(async () => await name() === 'Node-aware rendering');
    await click('[data-project-diagram="representation-overview"]');
    await waitFor(async () => await name() === 'Unsaved source draft');
    await click('.mapping-workspace-actions button'); // Save workspace, only in this disposable fixture.
    await waitFor(async () => { try { return JSON.parse(await readFile(path.join(root, '.diagrams/mapping-workspace.json'), 'utf8')).documents.some(doc => doc.name === 'Unsaved source draft'); } catch { return false; } });
    console.log('Reloading saved workspace');
    await cdp.send('Page.navigate', { url: `${url}/mapping` });
    console.log('Navigation returned');
    await waitFor(async () => await name() === 'Unsaved source draft');
    await waitForSelector(cdp, `${visible}.diagram-jump`);
    await checkGlyphs();
    console.log('Restored workspace glyphs verified');
    await click(`${visible}[data-diagram-jump-id="rendering"]`);
    await waitFor(async () => await name() === 'Node-aware rendering');
    assert.equal(await readFile(catalogPath, 'utf8'), savedCatalog, 'Jumping and workspace saving must not save diagram revisions');
    assert.deepEqual(browserErrors, []);
    console.log('Node-aware rendering: exact text and glyph geometry, zoom, instance-specific pipe-branch folding, parsed/unparsed jumps, target reveal, unsaved draft retention and workspace reload passed.');
  });
} finally { server?.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); }
