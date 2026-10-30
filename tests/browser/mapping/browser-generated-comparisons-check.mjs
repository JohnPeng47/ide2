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
const root = await mkdtemp(path.join(tmpdir(), 'generated-comparisons-browser-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Domain\n`-- Shared feature', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const records = new WorkspaceRecordStore(storeRoot), fixture = compareWorkspaceFixture(projectId);
  fixture.documents[0].representationId = 'draft-comparison-fixture'; fixture.activeDocumentId = 'draft-comparison-fixture';
  const views = fixture.documents[0].history.canvasViews;
  const originals = Object.values(views.saved);
  for (let i = 0; i < 2; i++) { const view = { ...originals[i], id: `comparison-fixture-${i}`, name: `Extra alternative ${i + 1}` }; views.saved[view.id] = view; }
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
    await click('.canvas-comparisons button', 'Compare alternatives…');
    const checked = () => evaluate(cdp, "document.querySelectorAll('.canvas-compare-choice input:checked').length");
    assert.equal(await checked(), 4);
    await click('.canvas-compare-choice input'); await waitFor(async () => await checked() === 3);
    await click('.canvas-compare-choice input'); await waitFor(async () => await checked() === 4);
    await click('.canvas-comparisons button', 'Generate comparisons (4)');
    try { await waitFor(async () => await evaluate(cdp, "!!document.querySelector('.canvas-comparison-run a')"), { timeoutMs: 10000 }); } catch(e) { console.log(await evaluate(cdp, "document.body.innerText")); console.log(await (await fetch(url+'/api/mapping/comparison-runs')).json()); throw e; }
    const href = await evaluate(cdp, "document.querySelector('.canvas-comparison-run a').href");
    const sessionId = new URL(href).searchParams.get('session');
    const session = await (await fetch(`${url}/api/mapping/compare-sessions/${sessionId}`)).json();
    assert.equal(session.canvases.length, 4); assert.equal(session.compares.length, 3);
    await cdp.send('Page.navigate', { url: href });
    const counts = () => evaluate(cdp, "['A','B'].map(side => document.querySelectorAll('[data-compare-pane='+side+'] .ascii-line').length)");
    await waitFor(async () => (await counts()).every(n => n === 3));
    await click('button', 'Show compared slices');
    await waitFor(async () => (await counts()).every(n => n === 2));
    await click('button', 'Show full diagrams');
    await waitFor(async () => (await counts()).every(n => n === 3));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.compare-slice.is-start').length"), 4);
    assert.equal(await evaluate(cdp, "getComputedStyle(document.querySelector('.compare-slice')).borderLeftWidth"), '1px');
    if (process.env.COMPARE_SCREENSHOT_PATH) await captureScreenshot(cdp, { output: process.env.COMPARE_SCREENSHOT_PATH });
    await click('button', 'Next');
    await waitFor(async () => (await counts()).every(n => n === 3));
    await click('button', 'Show compared slices');
    await waitFor(async () => (await counts()).every(n => n === 2));
    await cdp.send('Page.reload'); await waitFor(async () => (await counts()).every(n => n === 3));
    assert.deepEqual(errors, []);
    const ascii = await (await fetch(`${url}/api/mapping/comparison-runs/${sessionId}/ascii/D1.txt`)).text();
    assert.ok(ascii.startsWith('Domain\n'));
    console.log('Passed: four-view toggles, ASCII-only generation, persisted comparison link, disconnected slices, both-pane expand/borders, navigation reset, reload, ASCII endpoint.');
  });
} finally {
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
