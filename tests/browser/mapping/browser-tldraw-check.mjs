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
const root = await mkdtemp(path.join(tmpdir(), 'mapping-tldraw-browser-'));
let server;
try {
  const ascii = 'Alpha\n\n|-- A branch\n`-- A tail\n';
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene(ascii);
  scene.contents = Object.fromEntries(['a','b','c'].map((id, i) => [id, new RevisionedDiagramService().create({ id, revision: 0,
    ascii: `${['Alpha','Beta','Gamma'][i]}\n\n|-- ${id.toUpperCase()} branch\n\x60-- ${id.toUpperCase()} tail\n`, structureKind: 'tree' }).diagram]));
  scene.root.children = ['a','b','c'].map((id, i) => ({ id, kind: 'diagram', contentId: id, collapsed: false, position: { column: i * 25, row: 5 } }));
  const edges = [['a','b'],['b','a'],['a','a'],['b','c']].map(([a,b], i) => ({ id: `edge${i}`,
    source: { kind: 'content-node', displayNodeId: `grid:${a}`, contentNodeId: diagramContentNodes(scene.contents[a].content).find(n => n.line === 3).id,
      revisionId: scene.contents[a].content.revisionId, side: 'auto' },
    target: { kind: 'box', displayNodeId: `grid:${b}`, side: 'auto' }, appearance: { ...defaultArrowAppearance, label: `${a} to ${b}` } }));
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges }).history };
  await writeFile(catalogPath, JSON.stringify(catalog));
  const store = new DiagramStore(root);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {

    const send = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      let timer;
      try { return await Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 20000); })]); }
      finally { clearTimeout(timer); }
    };
    const exceptions = [];
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(error => { if (!/navigated|closed/.test(String(error))) exceptions.push(String(error)); }));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.exceptionThrown', e => (exceptions.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text), console.log('browser error', e.exceptionDetails.exception?.description ?? e.exceptionDetails.text)));
    await waitForSelector(cdp, '[data-native-node="grid:a"] pre');
    const bounds = () => evaluate(cdp, `(() => {const el=document.querySelector('[data-grid-box="a"]');if(!el)return {x:0,y:0,w:0,h:0};const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
    await waitFor(async () => (await bounds()).w > 20);
    const edgeAligned = () => evaluate(cdp, `(() => {
      const path=document.querySelector('[data-connection-id="edge0"] .diagram-connection-hit');
      const label=document.querySelector('[data-native-node="grid:a"] [data-content-node-id][data-source-line="3"]');
      if(!path||!label)return false;
      const point=path.getPointAtLength(0).matrixTransform(path.getScreenCTM()),rect=label.getBoundingClientRect();
      return Math.min(Math.abs(point.x-rect.left),Math.abs(point.x-rect.right),Math.abs(point.y-rect.top),Math.abs(point.y-rect.bottom))<.2
        && point.x>=rect.left-.2 && point.x<=rect.right+.2 && point.y>=rect.top-.2 && point.y<=rect.bottom+.2;
    })()`);
    await waitFor(edgeAligned, {message:'Edge attaches to its source label'});
    const first = await bounds();
    const from = {x:first.x+first.w-3,y:first.y+first.h-4};
    const to = {x:from.x+130,y:from.y+90};
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', ...from });
    await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', ...from, button:'left',buttons:1,clickCount:1 });
    for(let i=1;i<=10;i++) await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved',x:from.x+(to.x-from.x)*i/10,y:from.y+(to.y-from.y)*i/10,buttons:1,button:'left' });
    await waitFor(edgeAligned, {message:'Edge follows the source label during native dragging'});
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...to, button:'left',buttons:0,clickCount:1 });
    await waitFor(async () => Math.abs((await bounds()).y-first.y)>40);
    await captureScreenshot(cdp, { output: process.env.TLDRAW_SCREENSHOT ?? path.join(root,'canvas.png') });
    const clickText = async text => {
      const point = await evaluate(cdp, `(() => { const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)}&&!el.disabled);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.ok(point, text+' button');
      await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
    };
    await clickText('Undo');
    await waitFor(async () => Math.abs((await bounds()).y-first.y)<2);
    await clickText('Redo');
    await waitFor(async () => Math.abs((await bounds()).y-first.y)>40);
    const beforeReload = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', {});
    await waitFor(async () => { try { return (await evaluate(cdp, 'performance.timeOrigin')) !== beforeReload; } catch (error) { if (/context|navigated|closed/i.test(String(error))) return false; throw error; } });
    await waitForSelector(cdp, '[data-native-node="grid:a"] pre');
    await waitFor(async () => Math.abs((await bounds()).y-first.y)>40);
    await clickText('Undo');
    await waitFor(async () => Math.abs((await bounds()).y-first.y)<2);
    const asciiText = await evaluate(cdp, `document.querySelector('[data-native-node="grid:a"] pre').textContent`);
    assert.ok(asciiText.includes('Alpha\n\n'), 'Blank separator rows remain in the rendered shape');
    const panBefore = await bounds();
    const panStart = {x:1000,y:500}, panEnd = {x:1080,y:540};
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',...panStart});
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',...panStart,button:'middle',buttons:4,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',...panEnd,button:'middle',buttons:4});
    await waitFor(async () => Math.abs((await bounds()).x-panBefore.x-80)<2);
    assert.ok(Math.abs((await bounds()).y-panBefore.y-40)<2, 'Pan follows the pointer vertically');
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',...panEnd,button:'middle',buttons:0,clickCount:1});
    await waitFor(async () => { const a = await bounds(); await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'); return Math.abs((await bounds()).x-a.x)<.1; });
    assert.equal(await evaluate(cdp, `document.querySelector('[title="Undo (Ctrl+Z)"]').disabled`), true, 'Camera movement creates no canvas undo step');
    // Native inertia can carry a shape out of view after a fast synthetic pan.
    // Fit is a public camera command and brings it back for the zoom/copy checks.
    await clickText('Fit canvas');
    await waitFor(async () => (await bounds()).w > 20);
    await waitFor(async () => { const a = await bounds(); await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'); return Math.abs((await bounds()).w-a.w)<.1; });
    const panAfter = await bounds();
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:900,y:450,deltaX:0,deltaY:-120,modifiers:2});
    await waitFor(async () => (await bounds()).w > panAfter.w*1.05);
    await waitFor(async () => { const a = await bounds(); await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))'); return Math.abs((await bounds()).w-a.w)<.1; });
    const cancelBefore = await bounds(), cancelFrom = {x:cancelBefore.x+cancelBefore.w-3,y:cancelBefore.y+cancelBefore.h-4};
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',...cancelFrom,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:cancelFrom.x+90,y:cancelFrom.y+70,button:'left',buttons:1});
    await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:cancelFrom.x+90,y:cancelFrom.y+70,button:'left',buttons:0,clickCount:1});
    await waitFor(async () => Math.abs((await bounds()).x-cancelBefore.x)<2 && Math.abs((await bounds()).y-cancelBefore.y)<2);
    const copyBox = await bounds(), copyFrom = {x:copyBox.x+copyBox.w-3,y:copyBox.y+copyBox.h-4};
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',...copyFrom,button:'left',buttons:1,clickCount:1,modifiers:1});
    for (let step=1;step<=10;step++) await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:copyFrom.x+16*step,y:copyFrom.y+10*step,button:'left',buttons:1,modifiers:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:copyFrom.x+160,y:copyFrom.y+100,button:'left',buttons:0,clickCount:1,modifiers:1});
    await waitForSelector(cdp, '[data-native-node^="grid:copy-"] pre');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-native-node^="grid:copy-"]').length`), 1);
    await clickText('Undo');
    await waitFor(async () => !await evaluate(cdp, `document.querySelector('[data-native-node^="grid:copy-"]') !== null`));
    assert.deepEqual(exceptions, []);
    console.log('PASS: native dragging, undo/redo, restored history, blank rows, middle-button pan, zoom, Escape cancellation, and Alt-drag duplication');
  });
} finally {
  if(server) {server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
  await rm(root,{recursive:true,force:true});
}
