// Read-only regression against an existing saved output. Example:
// EVAL_OUTPUT_URL='http://localhost:5191/evals?run=...&output=...' node tests/performance/browser-eval-output-drag.mjs
// The 25-second drag crosses the Evals page's 20-second background refresh.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const url = process.env.EVAL_OUTPUT_URL;
assert.ok(url, 'Set EVAL_OUTPUT_URL to a saved multi-canvas output URL.');
const executable = process.env.BROWSER_EXECUTABLE_PATH ?? chromium.executablePath();
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
await withHeadlessBrowser({ url: 'about:blank', width: 1500, height: 1000,
  ...(existsSync(executable) ? { chromePath: executable } : {}), arguments: ['--no-sandbox'] }, async ({ cdp }) => {
  const errors = []; let refreshes = 0;
  await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
  cdp.on('Network.responseReceived', event => { if (new URL(event.response.url).pathname === '/api/mapping/evals/runs') refreshes++; });
  // The app invokes a migration on mount. This performance check never writes application data.
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*api/mapping/*' }] });
  cdp.on('Fetch.requestPaused', event => {
    const reply = event.request.method === 'GET' ? cdp.send('Fetch.continueRequest', { requestId: event.requestId })
      : new URL(event.request.url).pathname === '/api/mapping/evals/migrate'
        ? cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"migrated":0}').toString('base64') })
        : cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
    void reply.catch(() => {});
  });
  await cdp.send('Page.navigate', { url });
  await waitForSelector(cdp, '.output-result-canvas [data-preview-edge]', { timeoutMs: 60000 });
  const point = await evaluate(cdp, `(() => { const r = document.querySelector('[data-diagram-canvas]').getBoundingClientRect(); return {x:r.x+r.width*.7,y:r.y+r.height*.5}; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 1000, modifiers: 2 });
  await waitFor(() => evaluate(cdp, `document.querySelector('output[aria-label="Diagram zoom"]').value === '25%'`));
  await evaluate(cdp, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const initial = await evaluate(cdp, `document.querySelector('.diagram-canvas__surface').style.transform`);
  await evaluate(cdp, `(() => {
    const s = window.__evalDrag = {reads:0, pathChanges:0, frames:[], last:performance.now(), longTasks:[]};
    s.original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() { if(this.matches('.diagram-content-node, [data-grid-box]')) s.reads++; return s.original.call(this); };
    s.mo = new MutationObserver(records => s.pathChanges += records.length);
    s.mo.observe(document.querySelector('.diagram-connections'), {subtree:true, attributes:true, attributeFilter:['d']});
    s.po = new PerformanceObserver(list => s.longTasks.push(...list.getEntries().map(e => e.duration))); s.po.observe({type:'longtask'});
    const tick = time => { s.frames.push(time-s.last); s.last=time; s.raf=requestAnimationFrame(tick); }; s.raf=requestAnimationFrame(tick);
  })()`);
  const before = await metrics(cdp), start = performance.now(), refreshesBefore = refreshes;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'middle', buttons: 4, clickCount: 1 });
  for (let step = 1; step <= 1500; step++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + Math.sin(step / 30) * 100, y: point.y + Math.sin(step / 30) * 30, button: 'middle', buttons: 4 });
    if (step === 30) assert.notEqual(await evaluate(cdp, `document.querySelector('.diagram-canvas__surface').style.transform`), initial, 'The real drag must move the camera');
    const delay = start + step * 1000 / 60 - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'middle', buttons: 0 });
  const after = await metrics(cdp), elapsedMs = performance.now() - start;
  const observation = await evaluate(cdp, `(() => { const s=window.__evalDrag; cancelAnimationFrame(s.raf); s.mo.disconnect(); s.po.disconnect(); Element.prototype.getBoundingClientRect=s.original; return {endpointReads:s.reads, pathChanges:s.pathChanges, frames:s.frames.slice(1), longTasks:s.longTasks}; })()`);
  assert.ok(refreshes > refreshesBefore, 'Exercise at least one background run refresh');
  assert.equal(observation.endpointReads, 0, 'Panning/polling must not remeasure unchanged endpoint geometry');
  assert.equal(observation.pathChanges, 0, 'Panning/polling must not reroute unchanged edges');
  assert.deepEqual(errors, []);
  const frames = [...observation.frames].sort((a,b) => a-b);
  console.log(JSON.stringify({ elapsedMs, mainThreadMs:(after.TaskDuration-before.TaskDuration)*1000,
    frameP95Ms:frames[Math.floor(frames.length*.95)], maxFrameMs:Math.max(...frames),
    endpointReads:observation.endpointReads, pathChanges:observation.pathChanges, longTasks:observation.longTasks, backgroundRefreshes:refreshes-refreshesBefore }, null, 2));
  // Local controls must still invalidate the preview when its contents really change.
  async function click(selector) {
    const p = await evaluate(cdp, `(() => {const el=document.querySelector(${JSON.stringify(selector)}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', ...p, button:'left', buttons:1, clickCount:1 });
    await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...p, button:'left', buttons:0, clickCount:1 });
  }
  const beforeLines = await evaluate(cdp, `document.querySelectorAll('.change-preview-stage .ascii-line').length`);
  const first = '.mapping-subtree-toggle';
  await click(first);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.change-preview-stage .ascii-line').length < ${beforeLines}`), {timeoutMs:10000});
  await click(first);
  await waitFor(() => evaluate(cdp, `document.querySelectorAll('.change-preview-stage .ascii-line').length === ${beforeLines}`), {timeoutMs:10000});
  const canvas = await evaluate(cdp, `document.querySelector('select[aria-label="Output canvas"]').value`);
  await click('button[aria-label="Next canvas"]');
  await waitFor(() => evaluate(cdp, `document.querySelector('select[aria-label="Output canvas"]').value !== ${JSON.stringify(canvas)}`));
  await click('button[aria-label="Previous canvas"]');
  await waitFor(() => evaluate(cdp, `document.querySelector('select[aria-label="Output canvas"]').value === ${JSON.stringify(canvas)}`));
  console.log('PASS: panning through polling, zoom, fold/unfold, canvas navigation; no data writes.');
});
