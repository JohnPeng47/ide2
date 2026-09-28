// Production-browser creation/deletion benchmark. All writes use a disposable store.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../browser/support/browser-mapping-fixture.mjs';
import { singleDiagramScene } from '../../domain/core/diagrams/projectDiagramCanvas.ts';
import { createDiagram } from '../../domain/core/diagrams/diagram.ts';
import { CanvasHistory } from '../../domain/core/diagrams/canvasHistory.ts';
import { initialCanvasState } from '../../domain/mapping/workspace/mappingWorkspace.ts';
const { evaluate, waitFor, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'workspace-benchmark-'));
const report = path.resolve(process.env.WORKSPACE_REPORT ?? 'artifacts/workspace-persistence/baseline.json');
let server;
try {
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Base', nodes: [] });
  const base = path.join(root, '.diagrams');
  const catalog = JSON.parse(await readFile(path.join(base, 'representations/catalog.json'), 'utf8'));
  const workspace = { schemaVersion: 3, projectId: catalog.projectId, activeDocumentId: 'draft-0', documents: [] };
  for (let i = 0; i < 3; i++) {
    const canvas = initialCanvasState();
    const make = revision => ({ scene: { ...singleDiagramScene('Fixture'), contents: { ...singleDiagramScene('Fixture').contents, overview: createDiagram({ id: 'overview', revision,
      ascii: `Fixture ${i} revision ${revision}\n|-- One\n\x60-- Two`, structureKind: 'tree', evidence: {
        source: { id: 'source', label: 'Captured source', category: 'operation', sourceRanges: [{ id: 'range', path: 'fixture.ts', startLine: 1, endLine: 1, originalLines: ['x'.repeat(65536)] }] }
      } }) } }, edges: [], sections: {} });
    let document = make(0); const history = new CanvasHistory(document, canvas);
    for (let revision = 1; revision <= 20; revision++) { document = make(revision); history.append(document, canvas); }
    workspace.documents.push({ representationId: `draft-${i}`, name: `History fixture ${i}`, savedName: '', savedScene: JSON.stringify(document.scene), savedEdges: '[]', revisionId: '', document, canvas, history: history.export() });
  }
  await writeFile(path.join(base, 'mapping-workspace.json'), JSON.stringify(workspace));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: base, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', d => errors += d);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 30000, message: errors });
  const results = { date: new Date().toISOString(), fixtureBytes: Buffer.byteLength(JSON.stringify(workspace)), measurements: [], exceptions: [] };
  await withHeadlessBrowser({ url, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH ?? path.join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'), arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Performance.enable');
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    cdp.on('Runtime.exceptionThrown', e => results.exceptions.push(e.exceptionDetails.text));
    const click = async (selector, text) => {
      let p; await waitFor(async () => p = await evaluate(cdp, `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!e.disabled&&${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'});if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
    };
    await waitFor(() => evaluate(cdp, "document.body.innerText.includes('Editing history saved')"), { timeoutMs: 60000 });
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const saved = async predicate => { let w; await waitFor(async () => { w = await fetch(url + '/api/mapping/workspace').then(r => r.json()); return predicate(w); }, { timeoutMs: 60000 }); return w; };
    async function measure(kind, action, uiPredicate, diskPredicate) {
      await evaluate(cdp, `(()=>{const s=window.__bench={tasks:[],frames:[],last:performance.now()};s.o=new PerformanceObserver(l=>s.tasks.push(...l.getEntries().map(e=>e.duration)));s.o.observe({type:'longtask'});const tick=t=>{s.frames.push(t-s.last);s.last=t;s.raf=requestAnimationFrame(tick)};s.raf=requestAnimationFrame(tick)})()`);
      const before = await metrics(), start = performance.now(); await action(); const inputMs = performance.now() - start;
      await waitFor(() => evaluate(cdp, uiPredicate), { timeoutMs: 60000 }); const uiMs = performance.now() - start;
      await saved(diskPredicate); const persistedMs = performance.now() - start;
      await evaluate(cdp, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
      const after = await metrics(); const observed = await evaluate(cdp, '(()=>{const s=window.__bench;s.o.disconnect();cancelAnimationFrame(s.raf);return {longTasks:s.tasks,worstFrameMs:Math.max(...s.frames)}})()');
      const row = { kind, inputMs, uiMs, persistedMs, mainThreadMs: (after.TaskDuration - before.TaskDuration) * 1000, ...observed };
      results.measurements.push(row); console.log(JSON.stringify(row));
    }
    for (let trial = 0; trial < Number(process.env.WORKSPACE_TRIALS ?? 3); trial++) {
      const name = `Benchmark canvas ${trial}`;
      await click('.mapping-submenu button', 'New'); await click('[aria-label="New diagram name"]');
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
      await cdp.send('Input.insertText', { text: name });
      await measure('create', () => click('.mapping-create-dialog button[type=submit]'), `document.querySelector('[aria-label="Diagram name"]')?.value===${JSON.stringify(name)}&&!document.querySelector('[role=dialog]')`, w => w?.documents.some(d => d.name === name));
      await measure('delete', () => click(`[aria-label="Delete diagram ${name}"]`), `!document.querySelector('[aria-label="Delete diagram ${name}"]')&&!document.querySelector('.mapping-transfer-busy')`, w => w && !w.documents.some(d => d.name === name));
    }
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(() => evaluate(cdp, "!!document.querySelector('[data-grid-box]')"), { timeoutMs: 60000 });
    assert.equal((await saved(w => w?.documents.length === 3)).documents.length, 3);
    assert.deepEqual(results.exceptions, []);
  });
  await mkdir(path.dirname(report), { recursive: true }); await writeFile(report, JSON.stringify(results, null, 2));
} finally { if (server?.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); } await rm(root, { recursive: true, force: true }); }
