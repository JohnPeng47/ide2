// npm run build && node --import tsx tests/browser/mapping/browser-experiment-history-check.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { evalOutputFixture } from '../../support/evalOutputResult.ts';
import { captureChangeSessionOutput, summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult.ts';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';

const root = await mkdtemp(path.join(tmpdir(), 'experiment-history-'));
let browser, server, page;
try {
  await seedMappingFixture(root, { ascii: 'Fixture', nodes: [] });
  const store = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(store, 'project.json'), 'utf8'));
  const { run, session } = evalOutputFixture(projectId);
  const canvases = captureChangeSessionOutput(session);
  const markdown = { schemaVersion: 1, format: 'markdown', markdown: 'Second output', canvases: [], diagramRevisions: {} };
  run.status = 'finished';
  run.outputResults = { a: canvases, b: markdown };
  run.cells = Object.entries(run.outputResults).map(([key, result]) => ({ key, stage: 'proposal', pass: 1, status: 'finished', output: summarizeEvalOutput(result) }));
  await new JsonDirectoryStore(store, 'eval-runs').save(run);
  const experiment = { schemaVersion: 1, id: 'history-study', projectId, revision: 1, name: 'History study', description: '', createdAt: run.createdAt, updatedAt: run.createdAt,
    workflow: { id: 'study', name: 'Study', version: 1, stages: [{ id: 'generate', name: 'Generate', dependsOn: [] }] },
    phases: [{ id: 'review', name: 'Review', description: '' }], cases: [{ id: 'input', name: 'Input', agentContextId: run.agentContextId }],
    conditions: [{ id: 'v', name: 'Variant', description: '' }], comparisons: [], lastRequest: { id: 'fixture', hash: 'fixture' },
    samples: run.cells.map((cell, index) => ({ id: cell.key, phaseId: 'review', caseId: 'input', conditionId: 'v', number: index + 1, attempt: 1,
      outputs: [{ stageId: 'generate', runId: run.id, cellKey: cell.key }] })) };
  await new JsonDirectoryStore(store, 'eval-experiments').save(experiment);
  const report = { schemaVersion: 1, id: 'history-report', projectId, kind: 'comparison-report', title: 'History report',
    createdAt: run.createdAt, updatedAt: run.createdAt, runIds: [run.id], subjects: [], evaluator: { kind: 'manual' },
    status: 'finished', canvases: [], source: { kind: 'experiment', id: experiment.id, fingerprint: 'fixture' },
    data: { pages: ['Summary', 'Details'].map(title => ({ id: title.toLowerCase(), title, blocks: [{ kind: 'text', text: title + ' evidence' }] })) } };
  await new JsonDirectoryStore(store, 'judgements').save(report);
  const port = await new Promise(resolve => { const s = createServer().listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_USAGE_DB: path.join(root, 'usage.sqlite') }, stdio: 'ignore' });
  await expect.poll(async () => (await fetch(base).catch(() => null))?.ok, { timeout: 30000 }).toBe(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/evals?experiment=history-study');
  const overview = page.getByRole('region', { name: 'Experiment workflow' });
  const expand = overview.locator('button[aria-label^="Expand "][aria-label$="/outputs"]').first();
  await expand.click();
  const first = overview.getByRole('button', { name: '[output]', exact: true }).first();
  const row = await first.evaluate(el => el.closest('[data-node-id]').dataset.nodeId);
  await first.click();
  const selector = page.getByLabel('Output canvas', { exact: true });
  const source = () => expect(selector).toHaveValue('existing-canvas');
  const destination = () => expect(selector).toHaveValue('new-canvas');
  await source();
  const jump = page.locator('[data-diagram-jump-id="to-new-canvas"]').first();
  const geometry = () => page.locator('.compare-canvas [data-native-node="grid:overview"] .mapping-poc-ascii').first().evaluate(el => {
    const box = el.getBoundingClientRect(), pane = el.closest('.compare-canvas').getBoundingClientRect();
    return { x: box.x - pane.x, y: box.y - pane.y, width: box.width };
  });
  const settledCamera = async () => {
    let previous, matches = 0;
    await expect.poll(async () => {
      const current = await geometry();
      matches = JSON.stringify(current) === JSON.stringify(previous) ? matches + 1 : 0;
      previous = current;
      return matches;
    }, { intervals: [60] }).toBeGreaterThanOrEqual(3);
    return previous;
  };
  const pan = async (dx, dy) => {
    const pane = page.locator('.compare-canvas').first();
    const r = await pane.boundingBox(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const before = await geometry();
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => Math.abs((await geometry()).x - before.x)).toBeGreaterThan(10);
    return settledCamera();
  };
  const atCamera = async box => {
    await expect.poll(async () => { const r = await geometry(); return r ? Math.max(Math.abs(r.x - box.x), Math.abs(r.y - box.y), Math.abs(r.width - box.width)) : Infinity; }).toBeLessThan(2);
  };
  const originalCamera = await pan(40, 25);
  await jump.click(); await destination();
  await expect(page.locator('[data-focus-diagram="grid:overview"]')).toBeVisible();
  const beforeZoom = await pan(-50, 30);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 140);
  await page.keyboard.up('Control');
  await expect.poll(async () => Math.abs((await geometry()).width - beforeZoom.width)).toBeGreaterThan(2);
  const linkedCamera = await settledCamera();
  await page.keyboard.press('ArrowRight');
  const second = page.getByText('Second output', { exact: true });
  await expect(second).toBeVisible();
  // Perform history gestures on an actionable header button. They must never open its dropdown.
  const prompts = page.getByRole('button', { name: 'Prompts ▾' });
  const clickHistory = (direction, target = prompts) => target.click({ button: direction === 'back' ? 'left' : 'right', modifiers: ['Alt'] });
  await clickHistory('back'); await destination();
  await expect(page.locator('[data-focus-diagram="grid:overview"]')).toBeVisible();
  await atCamera(linkedCamera);
  await clickHistory('back', page.locator('.compare-canvas').first()); await source(); await atCamera(originalCamera);
  await clickHistory('back'); await expect(overview).toBeVisible();
  await expect(page.locator(`[data-node-id="${row}"] > .experiment-ascii-row`)).toBeFocused();
  await clickHistory('forward'); await source();
  await clickHistory('forward', jump); await destination();
  await clickHistory('forward'); await expect(second).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.goBack(); await destination();
  await page.reload(); await destination(); await atCamera(linkedCamera);
  await page.keyboard.press('Alt+ArrowLeft'); await source();
  // A different destination after Back replaces the old forward path.
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  const changes = page.getByRole('button', { name: 'Changes', exact: true });
  await clickHistory('forward'); await expect(changes).toHaveAttribute('aria-pressed', 'true');
  await prompts.click(); await page.getByRole('menuitem', { name: 'diagrams-style', exact: true }).click();
  const snippet = page.getByRole('dialog', { name: 'diagrams-style' });
  await expect(snippet).toBeVisible(); await clickHistory('back', snippet.getByRole('button', { name: 'Close' }));
  await expect(snippet).toHaveCount(0); await page.goForward(); await expect(snippet).toBeVisible();
  await snippet.getByRole('button', { name: 'Close' }).click();
  await expect(snippet).toHaveCount(0);
  await prompts.click(); await page.getByRole('menuitem', { name: '+ New alternatives prompt' }).click();
  const editor = page.getByLabel('Alternative instructions'); await editor.fill('An unsaved draft');
  await page.goBack();
  const confirm = page.getByRole('dialog', { name: 'Discard edits' });
  await confirm.getByRole('button', { name: 'Cancel' }).click(); await expect(editor).toHaveValue('An unsaved draft');
  await clickHistory('back'); await confirm.getByRole('button', { name: 'Discard' }).click();
  await expect(changes).toHaveAttribute('aria-pressed', 'true');
  await page.goto(base + '/evals?judgements=&judgement=' + report.id);
  const summary = page.getByText('Summary evidence', { exact: true });
  const details = page.getByText('Details evidence', { exact: true });
  await expect(summary).toBeVisible(); await page.keyboard.press('Shift+ArrowRight'); await expect(details).toBeVisible();
  await clickHistory('back'); await expect(summary).toBeVisible();
  await page.goForward(); await expect(details).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: overview → output → linked canvas → tree arrow, bidirectional mouse and browser history, reload, branching, inspectors and draft guards.');
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => ''));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
