import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import assert from 'node:assert/strict';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
import { defaultArrowAppearance } from '../../../domain/core/diagrams/diagramConnection.ts';
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
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-delete-browser-'));
let server;
try {
  const ascii = 'Alpha\n|-- A branch\n`-- A tail';
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene(ascii);
  scene.contents = Object.fromEntries(['a','b','c'].map((id, i) => [id, new RevisionedDiagramService().create({ id, revision: 0,
    ascii: `${['Alpha','Beta','Gamma'][i]}\n|-- ${id.toUpperCase()} branch\n\x60-- ${id.toUpperCase()} tail`, structureKind: 'tree' }).diagram]));
  scene.root.children = ['a','b','c'].map((id, i) => ({ id, kind: 'diagram', contentId: id, collapsed: false, position: { column: i * 25, row: 5 } }));
  const edges = [['a','b'],['b','a'],['a','a'],['b','c']].map(([a,b], i) => ({ id: `edge${i}`,
    source: { kind: 'content-node', displayNodeId: `grid:${a}`, contentNodeId: diagramContentNodes(scene.contents[a].content).find(n => n.line === 2).id,
      revisionId: scene.contents[a].content.revisionId, side: 'auto' },
    target: { kind: 'box', displayNodeId: `grid:${b}`, side: 'auto' }, appearance: { ...defaultArrowAppearance, label: `${a} to ${b}` } }));
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges }).history };
  await writeFile(catalogPath, JSON.stringify(catalog));
  const store = new DiagramStore(root);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      let timer;
      try { return await Promise.race([send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`CDP timed out: ${method}`)), 30000);
      })]); } finally { clearTimeout(timer); }
    };
    const exceptions = []; cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(error => { if (!/navigated or closed/.test(String(error))) exceptions.push(String(error)); })); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.text));
    const click = async (selector, text) => {
      // Following a jump can pan the toolbar outside the viewport. Recenter through
      // the public control before interacting with history, just as a user would.
      if (selector.includes('.mapping-grid-tools')) {
        await click('.mapping-document-view:not([hidden]) [title="Reset zoom and center diagram"]');
      }
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(async () => {
          const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled && ${text ? `el.textContent.includes(${JSON.stringify(text)})` : 'true'});
          if(!el || el.closest('[inert]'))return null;
          const before=el.getBoundingClientRect();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const r=el.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;
          const hit=document.elementFromPoint(x,y);
          return r.width&&r.height&&Math.abs(r.x-before.x)<.1&&Math.abs(r.y-before.y)<.1&&hit&&el.contains(hit)?{x,y}:null;
        })()`);
        return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };

    const visible = '.mapping-document-view:not([hidden])';
    const readBox = async id => evaluate(cdp, `(() => { const r=document.querySelector('${visible} [data-grid-box="${id}"]').getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    const box = async id => { let value; await waitFor(async () => { value = await readBox(id); return value.right - value.left > 2 && value.bottom - value.top > 2 && !await evaluate(cdp, `!!document.querySelector('.mapping-transfer-busy') || document.querySelector('${visible}').inert`); }); return value; };
    const selected = async ids => waitFor(async () => JSON.stringify(await evaluate(cdp, `[...document.querySelectorAll('${visible} [data-diagram-selected="true"]')].map(el=>el.dataset.gridBox).sort()`)) === JSON.stringify([...ids].sort()));
    const mouse = (type, point, modifiers = 0, clickCount = 1, button = 'left') => cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, modifiers,
      button, buttons: type === 'mouseReleased' ? 0 : button === 'right' ? 2 : 1, clickCount });
    const double = async (id, modifiers = 0) => {
      // Use the diagram's left gutter so the node's single-click CodePanel action is not invoked.
      await box(id);
      let p;
      await waitFor(async () => {
        const before=await readBox(id);
        await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        const b=await readBox(id); p={x:b.left+2,y:b.bottom-4};
        return Math.abs(b.left-before.left)<.5 && Math.abs(b.bottom-before.bottom)<.5;
      });
      await mouse('mousePressed',p,modifiers); await mouse('mouseReleased',p,modifiers);
      await mouse('mousePressed',p,modifiers,2); await mouse('mouseReleased',p,modifiers,2);
    };
    const present = async ids => waitFor(async () => JSON.stringify(await evaluate(cdp,
      `[...document.querySelectorAll('${visible} [data-grid-box]')].map(el=>el.dataset.gridBox).filter(id=>['a','b','c'].includes(id)).sort()`)) === JSON.stringify([...ids].sort()));
    const persisted = async predicate => {
      let value;
      await waitFor(async () => { const result=await fetch(url+'/api/mapping/workspace').then(r=>r.json());
        value=(result?.workspace ?? result)?.documents?.find(d=>d.representationId==='representation-overview'); return value && predicate(value); });
      return value;
    };
    await present(['a','b','c']);
    assert.equal(await evaluate(cdp, `!!document.querySelector('[aria-label="Selected diagrams"]')`), false);
    await double('b'); await selected(['b']);
    assert.equal(await evaluate(cdp, `!!document.querySelector('[aria-label="Selected diagrams"]')`), false, 'Selecting a diagram does not open a popup toolbar');
    if (process.env.DIAGRAM_DELETE_SCREENSHOT) await captureScreenshot(cdp, {output:process.env.DIAGRAM_DELETE_SCREENSHOT});
    if (!await evaluate(cdp, `!!document.querySelector('.mapping-whole-actions [role=menu]')`)) await click('.mapping-whole-actions > button', 'Actions (A)');
    await click('[aria-label="Selection actions"] button', 'Delete diagram');
    await present(['a','c']);
    assert.equal(await evaluate(cdp, `!!document.querySelector('[aria-label="Selected diagrams"]')`), false);
    const deleted = await persisted(doc => doc.document.edges.length === 1);
    assert.equal(deleted.document.edges[0].id, 'edge2'); // Only the unrelated a -> a connection remains.
    assert.deepEqual(deleted.canvas.selection.items, []);
    await click(`${visible} .mapping-grid-tools button`, 'Undo');
    await present(['a','b','c']); await selected(['b']);
    await persisted(doc => doc.document.edges.length === 4);
    await click(`${visible} .mapping-grid-tools button`, 'Redo');
    await present(['a','c']);
    await click(`${visible} .mapping-grid-tools button`, 'Undo');
    await present(['a','b','c']);
    await key('Escape', 'Escape', 27);
    // Ctrl-double-click adds each diagram to the selection.
    await double('a', 2); await double('b', 2); await double('c', 2);
    await selected(['a','b','c']);
    if (!await evaluate(cdp, `!!document.querySelector('.mapping-whole-actions [role=menu]')`)) await click('.mapping-whole-actions > button', 'Actions (A)');
    await click('[aria-label="Selection actions"] button', 'Delete diagrams');
    await present([]); await waitForSelector(cdp, '.mapping-empty-canvas');
    await click('[aria-label="Menu"]');
    await click('.mapping-workspace-actions button', 'Save workspace');
    await persisted(doc => Object.keys(doc.document.scene.contents).length === 0 && doc.document.edges.length === 0);
    await waitFor(async()=>await evaluate(cdp, `[...document.querySelectorAll('.mapping-workspace-actions button')].some(el=>el.textContent==='Save workspace'&&!el.disabled)`));
    await evaluate(cdp, 'window.__beforeDeleteReload = true');
    await cdp.send('Page.reload', {ignoreCache:true});
    await waitFor(async()=> { try { return await evaluate(cdp, 'window.__beforeDeleteReload !== true && document.readyState === "complete"'); }
      catch(error) { if (/context|navigated|closed/i.test(String(error))) return false; throw error; } });
    await waitForSelector(cdp, '.mapping-empty-canvas');
    await present([]);
    await click(`${visible} .mapping-grid-tools button`, 'Undo');
    await present(['a','b','c']);
    await persisted(doc => doc.document.edges.length === 4);
    await click(`${visible} .mapping-grid-tools button`, 'Redo');
    await present([]); await waitForSelector(cdp, '.mapping-empty-canvas');
    assert.deepEqual(exceptions, []);
    console.log('PASS: no selection popup, Delete in Actions, single/multi deletion, incident edges, Undo/Redo, empty canvas, save/reload and persisted undo history');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
