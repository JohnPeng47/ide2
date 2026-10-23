// Run after npm run build. Exercises folding through real pointer events on a disposable canvas.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'subtree-bounds-'));
const ascii = 'Diagram\n|-- content\n|   |-- structure\n|   |   |-- A long nested label that defines the expanded width\n|   |   `-- Leaf\n|   `-- revisionId\n`-- sourceContext\n    `-- Evidence';
const rows = ascii.split('\n');
let server;
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--http', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams') }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1600, height: 1000,
    chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const exceptions = []; cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.text));
    const frame = '[data-grid-box="overview"]';
    const button = line => `[data-subtree-owner="grid:overview"][data-subtree-line="${line}"]`;
    const click = async (selector, label) => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled && (!${JSON.stringify(label)} || el.textContent.trim()===${JSON.stringify(label)}));
          if(!el)return null; const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
          return r.width && r.height && el.contains(document.elementFromPoint(x,y)) ? {x,y}:null; })()`);
        return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const geometry = () => evaluate(cdp, `(() => { const el=document.querySelector(${JSON.stringify(frame)}); if(!el)return null;
      const rect=el.getBoundingClientRect(), native=el.closest('.tl-shape').getBoundingClientRect();
      return {column:Number(el.dataset.gridColumn),row:Number(el.dataset.gridRow),columns:Number(el.dataset.gridColumns),rows:Number(el.dataset.gridRows),
        width:rect.width,height:rect.height,nativeWidth:native.width,nativeHeight:native.height}; })()`);
    const verify = async lines => {
      const columns = Math.max(...lines.map(line => rows[line - 1].length));
      await waitFor(async () => { const g=await geometry(); return g?.rows===lines.length && g.columns===columns; });
      const g = await geometry();
      assert.equal(g.column, 0); assert.equal(g.row, 0);
      assert.ok(Math.abs(g.width-g.nativeWidth)<1, 'Native hit area width must match the visible frame');
      assert.ok(Math.abs(g.height-g.nativeHeight)<1, 'Native hit area height must match the visible frame');
      assert.equal(await evaluate(cdp, `document.querySelector('[data-native-node="grid:overview"] .mapping-poc-ascii').dataset.lineCount`), String(lines.length));
      return g;
    };
    await waitForSelector(cdp, button(3));
    const expanded = await verify([1,2,3,4,5,6,7,8]);
    await click(button(3));
    const folded = await verify([1,2,3,6,7,8]);
    assert.ok(folded.width < expanded.width && folded.height < expanded.height);
    await click(button(2)); await verify([1,2,7,8]);
    await click(button(2)); await verify([1,2,3,6,7,8]);
    await click('.mapping-grid-tools button', 'Undo'); await verify([1,2,7,8]);
    await click('.mapping-grid-tools button', 'Redo'); await verify([1,2,3,6,7,8]);
    await click(button(3)); await verify([1,2,3,4,5,6,7,8]);
    await click(button(2)); await verify([1,2,7,8]);
    await captureScreenshot(cdp, { output: process.env.SUBTREE_BOUNDS_SCREENSHOT ?? path.join(root, 'folded.png') });
    await click('[aria-label="Menu"]');
    await click('.mapping-workspace-actions button', 'Save workspace');
    await waitFor(async () => {
      const result=await fetch(url+'/api/mapping/workspace').then(r=>r.json());
      const doc=(result.workspace ?? result)?.documents?.find(doc=>doc.representationId==='representation-overview');
      return doc?.canvas.diagramViews?.['grid:overview']?.collapsedContentNodeIds.length === 1;
    });
    await evaluate(cdp, 'window.__subtreeBoundsBeforeReload = true');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => {
      try { return await evaluate(cdp, 'window.__subtreeBoundsBeforeReload !== true && document.readyState === "complete"'); }
      catch (error) { if (/context|navigated|closed/i.test(String(error))) return false; throw error; }
    });
    await waitForSelector(cdp, button(2));
    await verify([1,2,7,8]);
    await click(button(2)); await verify([1,2,3,4,5,6,7,8]);
    assert.deepEqual(exceptions, []);
    console.log('PASS nested collapse shrinks frame and native shape width/height; expansion, undo/redo and saved reload restore correct bounds');
  });
} finally {
  if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
