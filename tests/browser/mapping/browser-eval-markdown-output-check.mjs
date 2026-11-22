// npm run build && node --import tsx tests/browser/mapping/browser-eval-markdown-output-check.mjs
// Disposable saved results only; no model calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { evalOutputFixture } from '../../support/evalOutputResult.ts';
import { captureChangeSessionOutput, summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult.ts';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
import { judgeDiagramChangeTrees } from '../../../domain/mapping/evals/diagramChangeTree.ts';

const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(
  pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'eval-markdown-browser-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Source', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const { run, session } = evalOutputFixture(projectId);
  const result = captureChangeSessionOutput(session), canvasKey = run.cells[0].key;
  run.cells[0].status = 'finished'; delete run.cells[0].error;
  run.cells[0].output = summarizeEvalOutput(result); run.outputResults = { [canvasKey]: result };
  run.cells.unshift({ key: 'plan', stage: 'plan', pass: 1, status: 'failed' });
  run.status = 'partial';
  await new JsonDirectoryStore(storeRoot, 'eval-runs').save(run);
  const experiment = { schemaVersion: 1, id: 'markdown-experiment', projectId, revision: 1,
    createdAt: run.createdAt, updatedAt: run.createdAt, name: 'Plan and execution', description: '',
    workflow: { id: 'plan-execute', name: 'Plan and execute', version: 1,
      stages: [{ id: 'plan', name: 'Plan', dependsOn: [] }, { id: 'execute', name: 'Execute', dependsOn: ['plan'] }] },
    cases: [{ id: 'source', name: 'Pinned source', agentContextId: run.agentContextId }],
    conditions: [{ id: 'baseline', name: 'Baseline', description: '' }],
    samples: [{ id: 'sample', caseId: 'source', conditionId: 'baseline', number: 1, attempt: 1,
      outputs: [{ stageId: 'plan', runId: run.id, cellKey: 'plan' }, { stageId: 'execute', runId: run.id, cellKey: canvasKey }] }],
    comparisons: [], lastRequest: { id: 'fixture', hash: 'fixture' } };
  await new JsonDirectoryStore(storeRoot, 'eval-experiments').save(experiment);
  const judgements = new JsonDirectoryStore(storeRoot, 'judgements');
  const judgement = { schemaVersion: 1, projectId, createdAt: run.createdAt, updatedAt: run.createdAt, runIds: [run.id], subjects: [],
    evaluator: { kind: 'manual' }, status: 'finished', canvases: [], source: { kind: 'experiment', id: experiment.id, fingerprint: 'fixture' } };
  await judgements.save({ ...judgement, id: 'text-report', title: 'Text report', kind: 'comparison-report',
    data: { pages: [{ id: 'summary', title: 'Judge summary', blocks: [{ kind: 'text', text: '## Findings\n\nSaved judge feedback.' }] }] } });
  await judgements.save({ ...judgement, id: 'tree-report', title: 'Tree report', kind: 'diagram-change-tree', data: judgeDiagramChangeTrees([]) });
  await judgements.save({ ...judgement, id: 'progress-report', title: 'Progress report', kind: 'few-shot-progress',
    data: { targetTitle: 'Progress target', targetAscii: 'Target', initialReferences: [], rounds: [] } });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(base).catch(() => null))?.ok, { timeoutMs: 30000 });
  const markdown = '# Saved plan\n\n1. Preserve the source.\n2. Execute the batches.\n\n| Step | Verdict |\n| --- | --- |\n| Review | **Pass** |\n\n```text\nRoot\n  child\n```\n\n```typescript\nconst ready = true;\n```\n\n'
    + Array.from({ length: 30 }, (_, i) => `## Detail ${i + 1}\n\nRecorded evidence for this step.\n`).join('\n');
  const endpoint = `${base}/api/mapping/evals/runs/${run.id}/output-result`;
  const body = JSON.stringify({ cellKey: 'plan', format: 'markdown', markdown });
  const saved = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual(await saved.json(), { format: 'markdown', canvases: [] });
  const savedFile = path.join(storeRoot, 'eval-runs', `${run.id}.json`), before = await readFile(savedFile, 'utf8');

  await withHeadlessBrowser({ url: `${base}/evals?experiment=${experiment.id}`, width: 1440, height: 900,
    chromePath: process.env.CHROME_PATH || chromium.executablePath(), arguments: ['--no-sandbox'] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    const click = async (selector, index = 0) => {
      await waitForSelector(cdp, selector);
      const point = await evaluate(cdp, `(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    await waitFor(async () => (await evaluate(cdp, 'document.body.innerText')).includes('2/2 outputs'));
    await click('[aria-label="Expand phase/plan/variant/baseline/outputs"]');
    assert.match(await evaluate(cdp, 'document.body.innerText'), /Markdown/);
    await click('.experiment-ascii-content > span + .experiment-ascii-status + .experiment-ascii-action');
    const region = '[aria-label="Markdown output"]';
    await waitForSelector(cdp, `${region} h1`);
    assert.equal(await evaluate(cdp, `document.querySelector('${region} h1').textContent`), '# Saved plan');
    await waitForSelector(cdp, `${region}.window-panel [data-rendered-markdown] .terminal-code-block .shiki`);
    assert.equal(await evaluate(cdp, `document.querySelectorAll('${region} ol li').length`), 2);
    assert.equal(await evaluate(cdp, `document.querySelector('${region} td strong').textContent`), 'Pass');
    assert.equal(await evaluate(cdp, `document.querySelector('${region} pre code').textContent`), 'Root\n  child\n');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".output-result-canvas, .output-result-toolbar").length'), 0);
    assert.match(await evaluate(cdp, `document.querySelector('[aria-label="Output navigation"]').textContent`), /1 \/ 2/);
    const panelWidth = () => evaluate(cdp, `document.querySelector('${region}').getBoundingClientRect().width`);
    const originalWidth = await panelWidth();
    const resize = await evaluate(cdp, `(() => { const r = document.querySelector('${region} [aria-label="Resize window width"]').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...resize, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resize.x + 120, y: resize.y, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resize.x + 120, y: resize.y, button: 'left', buttons: 0, clickCount: 1 });
    await waitFor(async () => await panelWidth() < originalWidth - 80);
    const resizedWidth = await panelWidth();
    await click('[aria-label="Close Markdown output"]');
    await waitForSelector(cdp, '.experiment-output-reopen');
    await click('.experiment-output-reopen');
    await waitForSelector(cdp, `${region} h1`);
    assert.ok(Math.abs(await panelWidth() - resizedWidth) < 2, 'Reopening retains the panel size');
    await captureScreenshot(cdp, { output: path.join(root, 'markdown-output.png') });
    await click('[aria-label="Output navigation"] button[aria-keyshortcuts="ArrowRight"]');
    await waitForSelector(cdp, '[aria-label="Output canvas"]');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".experiment-output-panel").length'), 0);
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Output canvas"]').value`), 'existing-canvas');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await waitForSelector(cdp, `${region} h1`);
    assert.ok(Math.abs(await panelWidth() - resizedWidth) < 2, 'Navigation restores the panel size');
    await cdp.send('Page.enable');
    let reloaded = false;
    const offLoad = cdp.on('Page.loadEventFired', () => { reloaded = true; });
    await cdp.send('Page.reload');
    await waitFor(() => reloaded); offLoad();
    await waitForSelector(cdp, `${region} h1`);
    assert.ok(Math.abs(await panelWidth() - resizedWidth) < 2, 'Reload restores the panel size');
    const point = await evaluate(cdp, `(() => { const r = document.querySelector('${region}').getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 600 });
    await waitFor(async () => await evaluate(cdp, `document.querySelector('${region} .experiment-output-scroll').scrollTop > 0`));
    for (const [id, selector] of [['text-report', '.output-markdown[data-rendered-markdown] h2'], ['tree-report', '.diagram-change-judgement table'], ['progress-report', '.few-shot-progress h2']]) {
      await cdp.send('Page.navigate', { url: `${base}/evals?judgements=&judgement=${id}` });
      await waitForSelector(cdp, `.judgements-pane .window-panel ${selector}`);
      assert.equal(await evaluate(cdp, 'document.querySelectorAll(".output-result-canvas").length'), 0);
    }
    assert.deepEqual(errors, []);
  });
  assert.equal(await readFile(savedFile, 'utf8'), before, 'Viewing must not change saved results');
  assert.equal((await (await fetch(`${endpoint}?cell=plan`)).json()).markdown, markdown);
  console.log('PASS: saved Markdown, shared renderer/highlighting, WindowPanel resize/close/reopen/reload, mixed output navigation, scrolling, text/structured judgement panels, immutable evidence.');
} finally {
  if (server && server.exitCode === null) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
