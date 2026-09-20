// Run after npm run build: node --import tsx tests/browser/mapping/browser-edge-attachments-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { createDiagram } from '../../../domain/core/diagrams/diagram.ts';
import { connectionContentNodes, defaultArrowAppearance } from '../../../domain/core/diagrams/diagramConnection.ts';
import { projectCanvasSnapshot, singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'edge-attachments-'));
const ascii = 'Root\n|-- Parent\n|   `-- Long source label\n`-- Footer';
let server;
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene(ascii);
  scene.contents.overview = createDiagram({ id: 'overview', revision: 0, ascii, structureKind: 'tree' });
  scene.root.children[0].position = { column: 66, row: 4 };
  scene.root.children.push({ ...scene.root.children[0], id: 'second', position: { column: 120, row: 13 } });
  const content = scene.contents.overview.content;
  const sourceNode = connectionContentNodes(content).find(node => node.label === 'Long source label');
  const footer = connectionContentNodes(content).find(node => node.label === 'Footer');
  const edges = [{ id: 'box-edge', source: { kind: 'content-node', displayNodeId: 'grid:overview', contentNodeId: sourceNode.id,
    revisionId: content.revisionId, side: 'right', offset: 0.25 },
    target: { kind: 'box', displayNodeId: 'grid:second', side: 'left', offset: 0.75 }, appearance: { ...defaultArrowAppearance, label: 'Box edge' } },
  { id: 'node-edge', source: { kind: 'content-node', displayNodeId: 'grid:overview', contentNodeId: footer.id,
    revisionId: content.revisionId, side: 'bottom' }, target: { kind: 'content-node', displayNodeId: 'grid:second', contentNodeId: footer.id,
    revisionId: content.revisionId, side: 'top' }, appearance: { ...defaultArrowAppearance, label: 'Node edge' } }];
  const revision = catalog.revisions['revision-overview'];
  revision.content = { kind: 'mapping-canvas', scene, edges };
  revision.ascii = projectCanvasSnapshot(scene).ascii;
  const savedCatalog = JSON.stringify(catalog);
  await writeFile(catalogPath, savedCatalog);
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', data => errors += data);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100 }, async ({ cdp }) => {
    try {
    const browserErrors = [];
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', e => browserErrors.push(e.exceptionDetails.text));
    const click = async (selector, text) => {
      const p = await evaluate(cdp, `(() => {const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!${JSON.stringify(text ?? '')}||e.textContent.trim()===${JSON.stringify(text ?? '')}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1 });
    };
    const label = (box, line) => `[data-display-node-id="grid:${box}"][data-content-node-id][data-source-line="${line}"]`;
    const check = async (id, source, target, sourceSide, targetSide, sourceOffset = .5, targetOffset = .5) => {
      const result = await evaluate(cdp, `(() => {
        const g=document.querySelector('[data-connection-id="${id}"]'), p=g?.querySelector('.diagram-connection-hit');
        if (!p) return {missing:true};
        const rect=s=>document.querySelector(s).getBoundingClientRect();
        const side=(r,s,t)=>({x:s==='left'?r.left:s==='right'?r.right:r.left+r.width*t,y:s==='top'?r.top:s==='bottom'?r.bottom:r.top+r.height*t});
        const screen=t=>p.getPointAtLength(t).matrixTransform(p.getScreenCTM());
        const a=screen(0),b=screen(p.getTotalLength()),expectedA=side(rect(${JSON.stringify(source)}),'${sourceSide}',${sourceOffset}),expectedB=side(rect(${JSON.stringify(target)}),'${targetSide}',${targetOffset});
        return {source:g.dataset.geometrySource,a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},expectedA,expectedB};
      })()`);
      assert.equal(result.source, 'measured', JSON.stringify(result));
      for (const [actual, expected] of [[result.a, result.expectedA], [result.b, result.expectedB]])
        assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < .2, JSON.stringify(result));
    };
    const checkAll = () => Promise.all([
      check('box-edge', label('overview', 3), '[data-grid-box="second"]', 'right', 'left', .25, .75),
      check('node-edge', label('overview', 4), label('second', 4), 'bottom', 'top')
    ]);
    await waitForSelector(cdp, '[data-connection-id="box-edge"]');
    await checkAll();
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-submenu [role=status]").textContent'), 'Saved');
    // Large composed columns catch accumulated character-width rounding errors.
    const point = await evaluate(cdp, `(() => {const r=document.querySelector(${JSON.stringify(label('overview', 3))}).getBoundingClientRect(); return {x:r.left+10,y:r.top+5};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -140, modifiers: 2 });
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[aria-label="Diagram zoom"]').textContent`) !== '100%');
    await checkAll();
    // Real pan preserves attachment even without a React render.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - 80, y: point.y + 30, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x - 80, y: point.y + 30, button: 'left', buttons: 0 });
    await checkAll();
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-submenu [role=status]").textContent'), 'Saved');
    await click('[title="Reset zoom and center diagram"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[aria-label="Diagram zoom"]').textContent === '100%' && !document.querySelector('.diagram-canvas__surface').getAnimations().some(a => a.playState === 'running')`));
    await click('[data-subtree-owner="grid:overview"][data-subtree-line="2"]');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-connection-id=box-edge]")?.dataset.connectionStatus') === 'proxy');
    await check('box-edge', label('overview', 2), '[data-grid-box="second"]', 'right', 'left', .25, .75);
    await click('.mapping-grid-tools button', 'Undo');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-connection-id=box-edge]")?.dataset.connectionStatus') === 'resolved');
    await checkAll();
    await click('[aria-label="Collapse overview"]');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-connection-id=box-edge]")?.dataset.connectionStatus') === 'proxy');
    await check('box-edge', '[data-grid-box="overview"]', '[data-grid-box="second"]', 'right', 'left', .25, .75);
    await click('.mapping-grid-tools button', 'Undo');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector("[data-connection-id=box-edge]")?.dataset.connectionStatus') === 'resolved');
    await checkAll();
    await captureScreenshot(cdp, { output: process.env.EDGE_SCREENSHOT ?? path.join(root, 'attachments.png') });
    assert.equal(await readFile(catalogPath, 'utf8'), savedCatalog);
    assert.deepEqual(browserErrors, []);
    console.log('Measured arrow borders: node/box targets, offsets, large columns, zoom, pan, subtree/box proxies and undo passed; catalog unchanged.');
    } catch (error) {
      if (process.env.EDGE_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.EDGE_SCREENSHOT });
      throw error;
    }
  });
} finally { server?.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); }
