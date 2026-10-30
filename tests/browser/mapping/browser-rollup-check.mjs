// npm run build && node --import tsx tests/browser/mapping/browser-generated-comparisons-check.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { compareWorkspaceFixture } from '../../support/compareWorkspace.ts';
import { WorkspaceRecordStore } from '../../../infrastructure/mapping/persistence/workspace/workspaceRecordStore.ts';
const { evaluate, waitFor, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'rollup-browser-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Domain\n`-- Shared feature', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const records = new WorkspaceRecordStore(storeRoot), fixture = compareWorkspaceFixture(projectId);
  fixture.documents[0].representationId = 'draft-comparison-fixture'; fixture.activeDocumentId = 'draft-comparison-fixture';
  const views = fixture.documents[0].history.canvasViews;
  for (const view of Object.values(views.saved)) {
    view.alternativeGroupId = 'fixture-alternatives';
    view.generation = { runId: 'fixture', chatId: 'fixture', parentChatId: 'fixture', triggerPrompt: 'fixture', prompt: 'fixture', model: 'gpt-6-sol', effort: 'high', status: 'finished', startedAt: new Date().toISOString() };
  }
  await records.state(projectId, async () => fixture);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore'
  });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 30000 });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1300, chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    const errors = []; await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
    const click = async (selector, text) => {
      await waitFor(async () => await evaluate(cdp, `!![...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.getBoundingClientRect().height && (!${JSON.stringify(text)} || e.textContent.trim() === ${JSON.stringify(text)}))`));
      for (let attempt = 0; attempt < 20; attempt++) {
        const scroll = await evaluate(cdp, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.getBoundingClientRect().height && (!${JSON.stringify(text)} || e.textContent.trim() === ${JSON.stringify(text)})); let p=e.parentElement; while(p && !(p.scrollHeight>p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p=p.parentElement; if(!p) return null; const r=e.getBoundingClientRect(), b=p.getBoundingClientRect(); if(r.top>=b.top && r.bottom<=b.bottom) return null; return {x:b.right-16,y:Math.max(0,b.top)+40,deltaX:0,deltaY:r.top<b.top?-220:220,top:p.scrollTop}; })()`);
        if (!scroll) break;
        const { top, ...wheel } = scroll;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheel });
        await waitFor(async () => await evaluate(cdp, `(() => { const e = document.elementFromPoint(${wheel.x},${wheel.y}); let p=e; while(p && !(p.scrollHeight>p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p=p.parentElement; return p?.scrollTop !== ${top}; })()`));
      }
      const point = await evaluate(cdp, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !e.disabled && e.getBoundingClientRect().height && (!${JSON.stringify(text)} || e.textContent.trim() === ${JSON.stringify(text)})); const r = e.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    await waitFor(async () => await evaluate(cdp, "(document.body?.innerText.length ?? 0) > 100"));
    await click('[role=tab]', 'Canvas');
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-generated-canvas]').length === 2"));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('textarea[aria-label*=generation]').length"), 0);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[aria-label=\"Generate alternatives…\"]').length"), 0);
    await click('button', 'Roll up canvas…');
    const key = async (key, code) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code });
    };
    await click('select[aria-label="Child canvas"]'); await key('Home', 36); await key('ArrowDown', 40); await key('Enter', 13);
    await click('select[aria-label="Parent canvas"]'); await key('Home', 36); await key('ArrowDown', 40); await key('ArrowDown', 40); await key('Enter', 13);
    await click('button', 'Generate two passes');
    await waitFor(async () => await evaluate(cdp, "!!document.querySelector('[data-rollup-status=finished]')"), { timeoutMs: 30000 });
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-generated-canvas]').length === 6"));
    const canvases = await (await fetch(url + '/api/mapping/generated-canvases')).json();
    const g2 = canvases.find(c => c.generated.stage === 'g2');
    const catalogRequests = [];
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', event => {
      if (new URL(event.request.url).pathname === '/api/core/project/representations') catalogRequests.push(event.request.url);
    });
    await click(`[data-generated-canvas="${g2.id}"]`);
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[data-generated-canvas="${g2.id}"]')?.classList.contains('is-active')`));
    assert.equal(catalogRequests.length, 1, 'A canvas generated after startup refreshes the catalog once');
    await waitFor(async () => await evaluate(cdp, `!!document.querySelector('.mapping-document-view:not([hidden]) [data-canvas-engine="tldraw"] pre')`));
    await evaluate(cdp, `(window.__firstGeneratedCanvas = document.querySelector('.mapping-document-view:not([hidden]) [data-canvas-engine="tldraw"]'), true)`);
    const other = canvases.find(c => c.generated.stage === 'g2' && c.id !== g2.id);
    for (const id of [other.id, g2.id, other.id, g2.id]) {
      const started = performance.now();
      await click(`[data-generated-canvas="${id}"]`);
      await waitFor(async () => await evaluate(cdp, `document.querySelector('[data-generated-canvas="${id}"]')?.classList.contains('is-active') && !!document.querySelector('.mapping-document-view:not([hidden]) [data-canvas-engine="tldraw"] pre')`));
      console.log(`Generated canvas switch: ${Math.round(performance.now() - started)} ms`);
    }
    assert.equal(catalogRequests.length, 1, 'Cached and already mounted generated canvases switch without fetching the project');
    assert.equal(await evaluate(cdp, `window.__firstGeneratedCanvas === document.querySelector('.mapping-document-view:not([hidden]) [data-canvas-engine="tldraw"]')`), true,
      'Switching back preserves the mounted editor');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[aria-label=\"Canvas view explorer\"]').length"), 0);
    await captureScreenshot(cdp, { output: path.join(root, 'rollup-panel.png') });
    assert.equal((await (await fetch(url + '/api/mapping/generated-canvases')).json()).length, 6);
    assert.deepEqual(errors, []);
    console.log('Passed: legacy migration, AgentContext grouping, prompt removal, automatic two-pass generation, g2 switching without catalog reloads, and persisted outputs.');
  });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1300, chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    await waitFor(async () => await evaluate(cdp, "!!document.querySelector('[role=tab]')"));
    const point = await evaluate(cdp, "(() => {const r=[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent==='Canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', ...point, button:'left',buttons:1,clickCount:1 });
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...point, button:'left',buttons:0,clickCount:1 });
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-generated-canvas]').length === 6"));
    assert.equal((await (await fetch(url + '/api/mapping/generated-canvases')).json()).length, 6);
    console.log('Passed: fresh browser restores six generated canvases without duplicate migration.');
  });
} finally {
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
