// Profile a disposable copy of a real store; the source store is never opened by the app.
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
const { withHeadlessBrowser, evaluate, waitFor } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')));
const source = process.env.STARTUP_STORE;
if (!source) throw Error('Set STARTUP_STORE to the store to copy');
const mode = process.env.STARTUP_MODE ?? 'preview';
const trials = Number(process.env.STARTUP_TRIALS ?? 3);
const profile = process.env.STARTUP_PROFILE === '1';
const output = path.resolve(process.env.STARTUP_REPORT ?? 'artifacts/startup-performance');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(path.join(tmpdir(), 'diagram-startup-'));
const store = path.join(temp, 'store');
const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const origin = `http://127.0.0.1:${port}`;
const results = { date: new Date().toISOString(), mode, profile, trials: [] };
let server;
try {
  await cp(source, store, { recursive: true });
  const start = performance.now();
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', ...(mode === 'preview' ? ['preview'] : []), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: process.cwd(), NEW_DIAGRAMS_DIR: store }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(log); return (await fetch(origin).catch(() => null))?.ok; }, { timeoutMs: 60000 });
  results.serverReadyMs = performance.now() - start;
  console.log(JSON.stringify({ mode, serverReadyMs: results.serverReadyMs }));
  await withHeadlessBrowser({ url: 'about:blank', width: 2300, height: 1400, chromePath: process.env.CHROME_PATH ?? path.join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Performance.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let current;
    const requests = new Map();
    cdp.on('Network.requestWillBeSent', e => { if (current && e.request.url.startsWith(origin)) { const r = { url: e.request.url.slice(origin.length), method: e.request.method, start: e.timestamp * 1000 }; requests.set(e.requestId, r); current.network.push(r); } });
    cdp.on('Network.responseReceived', e => { const r = requests.get(e.requestId); if (r) Object.assign(r, { status: e.response.status, headersMs: e.timestamp * 1000 - r.start, mime: e.response.mimeType }); });
    cdp.on('Network.loadingFinished', e => { const r = requests.get(e.requestId); if (r) Object.assign(r, { durationMs: e.timestamp * 1000 - r.start, bytes: e.encodedDataLength }); });
    cdp.on('Runtime.exceptionThrown', e => current?.errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__startup = { longTasks: [], milestones: {} };
      new PerformanceObserver(l => window.__startup.longTasks.push(...l.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({type:'longtask', buffered:true});
      new MutationObserver(() => {
        const m = window.__startup.milestones;
        if (!m.shell && document.querySelector('.mapping-poc-shell')) m.shell = performance.now();
        if (!m.canvas && document.querySelector('[data-content-node-id]')) m.canvas = performance.now();
        if (!m.saved && document.body?.innerText.includes('Editing history saved')) m.saved = performance.now();
      }).observe(document, {childList:true, subtree:true, characterData:true});
    ` });
    for (let trial = 1; trial <= trials; trial++) {
      current = { trial, network: [], errors: [] }; requests.clear();
      if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
      const started = performance.now();
      await cdp.send('Page.navigate', { url: origin });
      await waitFor(() => evaluate(cdp, 'Boolean(window.__startup?.milestones.canvas && window.__startup?.milestones.saved)'), { timeoutMs: 180000, message: 'Canvas and saved history did not become ready' });
      await evaluate(cdp, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
      current.elapsedMs = performance.now() - started;
      current.browser = await evaluate(cdp, `({ ...window.__startup, now:performance.now(), paints:performance.getEntriesByType('paint').map(e=>e.toJSON()), navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()), resources:performance.getEntriesByType('resource').map(e=>e.toJSON()), nodes:document.querySelectorAll('*').length, contentNodes:document.querySelectorAll('[data-content-node-id]').length })`);
      current.metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      if (profile) await writeFile(path.join(output, `${mode}-${trial}.cpuprofile`), JSON.stringify((await cdp.send('Profiler.stop')).profile));
      results.trials.push(current);
      console.log(JSON.stringify({ trial, elapsedMs: current.elapsedMs, milestones: current.browser.milestones, longTasks: current.browser.longTasks, errors: current.errors, api: current.network.filter(r => r.url.startsWith('/api/')) }));
      await writeFile(path.join(output, `${mode}${profile ? '-profile' : ''}.json`), JSON.stringify(results, null, 2));
      // Each navigation is cache-disabled; later trials retain server/JIT caches and persisted records.
      current = undefined;
      await cdp.send('Page.navigate', { url: 'about:blank' });
    }
  });
  await writeFile(path.join(output, `${mode}-server.log`), log);
} finally {
  if (server?.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); }
  await rm(temp, { recursive: true, force: true });
}
