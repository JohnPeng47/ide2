// npm run build && node --import tsx tests/browser/mapping/browser-output-node-comments-check.mjs
// Real Ctrl gestures and persistence in disposable storage; no generation or active project writes.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { evalOutputFixture } from '../../support/evalOutputResult.ts';
import { captureChangeSessionOutput, summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult.ts';
import { CanvasHistory } from '../../../domain/core/diagrams/canvasHistory.ts';
import { CanvasCatalogStore } from '../../../infrastructure/core/persistence/canvasCatalogStore.ts';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = await mkdtemp(path.join(tmpdir(), 'output-node-comments-'));
let server;
const screenshots = process.env.EVAL_COMMENT_SCREENSHOTS || root;
await mkdir(screenshots, { recursive: true });
try {
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Source', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const { run: seed, session } = evalOutputFixture(projectId);
  const result = captureChangeSessionOutput(session);
  const runs = ['a', 'b'].map((id, index) => ({ ...structuredClone(seed), id: `run-${id}`, number: index + 1, contextName: `Output ${id.toUpperCase()}`, status: 'finished',
    cells: [{ key: 'output', stage: 'proposal', status: 'finished', pass: 1, candidateName: `Output ${id.toUpperCase()}`, output: summarizeEvalOutput(result) }], outputResults: { output: result } }));
  // Cover the original generated-output viewer as well as the multi-canvas result viewer.
  const doc = result.canvases[0].proposed;
  const history = new CanvasHistory(doc.document, doc.canvas).export(true);
  const generated = { key: 'fixture-a', agentContextId: seed.agentContextId, contextName: 'Output A', stage: 'alternative', workflow: 'alternatives', runId: runs[0].id, pass: 1 };
  const pinned = { id: 'existing-canvas', name: 'Existing architecture', generated, history };
  const published = await new CanvasCatalogStore(storeRoot).saveMappingDiagram(projectId, { name: pinned.name, type: 'generated',
    history, scene: doc.document.scene, edges: doc.document.edges, generated });
  pinned.id = published.representation.id;
  delete runs[0].cells[0].output; delete runs[0].outputResults;
  Object.assign(runs[0].cells[0], { canvasId: pinned.id, checkpointId: history.headId });
  runs[0].outputSnapshots = { [pinned.id]: pinned };
  const experiment = { schemaVersion: 1, id: 'comment-study', projectId, revision: 1, name: 'Node comment study', description: '', createdAt: seed.createdAt, updatedAt: seed.createdAt,
    workflow: { id: 'study', name: 'Study', version: 1, stages: [{ id: 'generate', name: 'Generate', dependsOn: [] }] },
    phases: [{ id: 'first', name: 'First phase', description: '' }, { id: 'second', name: 'Second phase', description: '' }],
    cases: [{ id: 'source', name: 'Architecture', agentContextId: seed.agentContextId }], conditions: [{ id: 'variant', name: 'Variant', description: '' }],
    samples: runs.map((run, i) => ({ id: run.id, phaseId: i ? 'second' : 'first', caseId: 'source', conditionId: 'variant', number: i + 1, attempt: 1,
      outputs: [{ stageId: 'generate', runId: run.id, cellKey: 'output' }] })), comparisons: [], lastRequest: { id: 'fixture', hash: 'fixture' } };
  for (const run of runs) await new JsonDirectoryStore(storeRoot, 'eval-runs').save(run);
  await new JsonDirectoryStore(storeRoot, 'eval-experiments').save(experiment);
  const readExperiment = async () => JSON.parse(await readFile(path.join(storeRoot, 'eval-experiments/comment-study.json'), 'utf8'));
  const runFiles = runs.map(run => path.join(storeRoot, 'eval-runs', `${run.id}.json`));
  const before = await Promise.all(runFiles.map(file => readFile(file, 'utf8')));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_USAGE_DB: path.join(root, 'usage.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs); return (await fetch(base).catch(() => null))?.ok; }, { timeoutMs: 30000 });
  const startedRead = performance.now();
  const pinnedReply = await fetch(`${base}/api/mapping/evals/canvases/${pinned.id}?${new URLSearchParams({ checkpoint: history.headId, run: 'run-a', cell: 'output' })}`);
  assert.equal(pinnedReply.status, 200); assert.equal((await pinnedReply.json()).history.headId, history.headId);
  console.log(`Direct pinned output read: ${Math.round(performance.now() - startedRead)}ms`);
  await withHeadlessBrowser({ url: 'about:blank', width: 1553, height: 826, chromePath: process.env.CHROME_PATH || chromium.executablePath(), arguments: ['--no-sandbox'] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1553, height: 826, deviceScaleFactor: 1, mobile: false });
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    const frames = () => evaluate(cdp, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const mouse = (type, point, modifiers = 0, clickCount = 1) => cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount, modifiers });
    const click = async (selector, text) => {
      const point = await evaluate(cdp, `(()=>{const el=${text ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)})` : `document.querySelector(${JSON.stringify(selector)})`};if(!el)throw Error('Missing '+${JSON.stringify(text || selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await mouse('mousePressed', point); await mouse('mouseReleased', point); await frames();
    };
    const key = async (key, code) => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code }); await frames(); };
    const selected = () => evaluate(cdp, `[...document.querySelectorAll('.compare-canvas [data-content-node-id].is-selected')].map(el=>el.textContent.trim())`);
    const ready = async () => { await waitForSelector(cdp, '.compare-canvas [data-content-node-id]', { timeoutMs: 30000 }); await frames(); };
    const gesture = async () => {
      const points = await evaluate(cdp, `(()=>{const els=[...document.querySelectorAll('[data-native-node="grid:overview"] [data-content-node-id]')].slice(1,3);const rects=els.map(el=>el.getBoundingClientRect());return{a:{x:Math.min(...rects.map(r=>r.left))-3,y:rects[0].top+2},b:{x:Math.max(...rects.map(r=>r.right))+3,y:rects.at(-1).bottom-2}}})()`);
      await mouse('mouseMoved', points.a, 2); await mouse('mousePressed', points.a, 2);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', { x: points.a.x + (points.b.x - points.a.x) * i / 8, y: points.a.y + (points.b.y - points.a.y) * i / 8 }, 2); await frames(); }
      assert.equal(await evaluate(cdp, `!!document.querySelector('[aria-label="Comment on selected nodes"]')`), false, 'Popup waits for release');
      await mouse('mouseReleased', points.b, 2);
      await waitForSelector(cdp, '[aria-label="Node comment"]');
      assert.ok((await selected()).length >= 2, 'Existing node membership is highlighted');
    };
    await cdp.send('Page.navigate', { url: `${base}/evals?run=run-a&output=output&nav=comment-study:*` });
    await ready();
    await gesture();
    await cdp.send('Input.insertText', { text: 'Cancel this draft' });
    await key('Escape', 27);
    assert.deepEqual(await selected(), []);
    assert.equal((await readExperiment()).comments, undefined);
    assert.equal(await evaluate(cdp, `!!document.querySelector('[aria-label="Node comment"]')`), false);
    const rootPoint = await evaluate(cdp, `(()=>{const r=document.querySelector('[data-native-node="grid:overview"] [data-content-node-id]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await mouse('mousePressed', rootPoint, 2); await mouse('mouseReleased', rootPoint, 2);
    await mouse('mousePressed', rootPoint, 2, 2); await mouse('mouseReleased', rootPoint, 2, 2);
    await waitFor(async () => (await selected()).length >= 3);
    await key('Escape', 27); assert.deepEqual(await selected(), []);
    await gesture();
    const firstNodes = await selected();
    await cdp.send('Input.insertText', { text: 'Clarify ownership here' });
    await captureScreenshot(cdp, { output: path.join(screenshots, 'selection-comment.png') });
    await click('button', 'Save comment');
    await waitFor(async () => (await readExperiment()).comments?.length === 1);
    await waitForSelector(cdp, '.output-active-comment');
    const first = (await readExperiment()).comments[0];
    assert.equal(first.anchor.runId, 'run-a'); assert.ok(first.excerpts[0].ascii.includes(firstNodes[0]));
    await click('.view-tree-label', 'Output B'); await ready();
    await click('[aria-label="Next canvas"]'); await ready();
    await gesture(); await cdp.send('Input.insertText', { text: 'Second output review' }); await click('button', 'Save comment');
    await waitFor(async () => (await readExperiment()).comments?.length === 2);
    const saved = await readExperiment(), second = saved.comments[1];
    assert.equal(second.anchor.canvasId, 'new-canvas');
    await waitFor(() => evaluate(cdp, `new URLSearchParams(location.search).get('comment')===${JSON.stringify(second.id)}`));
    await click('.output-navigation [aria-label="Next"]');
    await waitFor(() => evaluate(cdp, `new URLSearchParams(location.search).get('comment')===${JSON.stringify(first.id)}`));
    await ready(); assert.deepEqual(await selected(), firstNodes);
    await key('ArrowLeft', 37);
    await waitFor(() => evaluate(cdp, `new URLSearchParams(location.search).get('comment')===${JSON.stringify(second.id)}`));
    await ready();
    await click('.output-comments-panel button', 'Copy comments');
    const copied = await evaluate(cdp, 'navigator.clipboard.readText()');
    assert.ok(copied.includes('Clarify ownership here') && copied.includes('Second output review') && copied.includes(firstNodes[0]));
    assert.ok(copied.includes('Sample 1') && copied.includes('Sample 2'));
    let loaded = false; const off = cdp.on('Page.loadEventFired', () => { loaded = true; });
    await cdp.send('Page.reload'); await waitFor(() => loaded, { timeoutMs: 30000 }); off(); await ready();
    await waitFor(async () => (await selected()).length >= 2);
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Output canvas"]').value`), 'new-canvas');
    assert.equal(await evaluate(cdp, `new URLSearchParams(location.search).get('comment')`), second.id);
    await captureScreenshot(cdp, { output: path.join(screenshots, 'saved-comment.png') });
    await click('.output-active-comment button', 'Back to output');
    await waitFor(() => evaluate(cdp, `!new URLSearchParams(location.search).has('comment')`));
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Output canvas"]').value`), 'new-canvas', 'Leaving a comment retains its canvas');
    const center = await evaluate(cdp, `(()=>{const r=document.querySelector('.compare-canvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await mouse('mouseMoved', center); await mouse('mousePressed', center);
    for(let step=1;step<=8;step++){await mouse('mouseMoved',{x:center.x+step*10,y:center.y+step*6});await frames();}
    await mouse('mouseReleased',{x:center.x+80,y:center.y+48}); await frames();
    const rect = () => evaluate(cdp, `(()=>{const r=document.querySelector('[data-native-node="grid:overview"] .mapping-poc-ascii').getBoundingClientRect();return{x:r.x,y:r.y}})()`);
    const panned = await rect();
    await click('[aria-label="Output view"] button', 'Changes');
    await waitForSelector(cdp, '.change-preview-stage');
    await click('[aria-label="Output view"] button', 'Result'); await ready();
    const restored = await rect();
    assert.ok(Math.abs(restored.x-panned.x)<2 && Math.abs(restored.y-panned.y)<2, 'Result camera survives switching to Changes and back');
    await click('.output-navigation [aria-label="Previous"]');
    await waitFor(()=>evaluate(cdp, `new URLSearchParams(location.search).get('run')==='run-a'`)); await ready();
    assert.equal(await evaluate(cdp, `new URLSearchParams(location.search).get('run')`), 'run-a');
    assert.equal(await evaluate(cdp, `new URLSearchParams(location.search).has('comment')`), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(await Promise.all(runFiles.map(file => readFile(file, 'utf8'))), before, 'Comments never mutate saved output runs');
    console.log('PASS: Ctrl-drag/release, Escape, save, two output sets across phases, isolated closed navigation, clipboard excerpts, reload highlights, immutable outputs.');
  });
} finally {
  server?.kill('SIGTERM');
  if (server && server.exitCode === null) await new Promise(resolve => server.once('exit', resolve));
  await rm(root, { recursive: true, force: true });
}
