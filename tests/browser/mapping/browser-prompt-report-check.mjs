// npm run build && node --import tsx tests/browser/mapping/browser-judgements-check.mjs
// Judgement migration, both result displays, and run attachments against the fake runtime. Set EVALS_SCREENSHOTS=<dir> to save screenshots.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { compareWorkspaceFixture } from '../../support/compareWorkspace.ts';
import { WorkspaceRecordStore } from '../../../infrastructure/mapping/persistence/workspace/workspaceRecordStore.ts';

const root = await mkdtemp(path.join(tmpdir(), 'evals-browser-'));
const shots = process.env.EVALS_SCREENSHOTS;
if (shots) await mkdir(shots, { recursive: true });
let server, browser, page;
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
try {
  await seedMappingFixture(root, { ascii: 'Domain\n`-- Shared feature', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  await new WorkspaceRecordStore(storeRoot).state(projectId, async () => compareWorkspaceFixture(projectId));
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = ''; server.stdout.on('data', chunk => { serverLog += chunk; }); server.stderr.on('data', chunk => { serverLog += chunk; });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  const nav = page.getByRole('navigation', { name: 'Evals' });
  const tree = nav.getByRole('tree', { name: 'Evals outputs' });
  let expectedTemplateDialog;
  page.on('dialog', dialog => {
    if (expectedTemplateDialog === 'leave-mapping' && dialog.type() === 'beforeunload'
      || expectedTemplateDialog === 'delete-template' && dialog.type() === 'confirm'
        && dialog.message() === 'Delete layout template “Saved arrangement”? Pinned runs keep their copy.') {
      void dialog.accept(); return;
    }
    errors.push(`Unexpected browser dialog: ${dialog.message()}`); void dialog.dismiss();
  });

  await page.goto(`${url}/evals`);
  await expect(page.getByRole('heading', { name: 'Generate, then compare' })).toBeVisible();
  await shot(page, '01-home');

  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'New run' });
  await drawer.getByText('Roll-up', { exact: true }).click();
  await drawer.getByRole('checkbox', { name: 'Default roll-up' }).check();
  const canvases = drawer.getByRole('tree', { name: 'Canvases' });
  await canvases.getByRole('checkbox', { name: /^Second view/ }).check();
  await canvases.getByRole('checkbox', { name: /^First view/ }).check();
  await drawer.getByLabel('Samples').fill('1');
  await drawer.getByRole('button', { name: 'Start run' }).click();
  await expect(tree.locator('.evals-tree-row', { hasText: /Run #.*Default roll-up/ })).toContainText('2/2', { timeout: 30000 });
  await tree.getByRole('button', { name: /^Expand Run #/ }).click();
  await expect(tree.getByRole('button', { name: 'Judgements', exact: true })).toHaveCount(0);
  const selectOutputs = async () => {
    for (const stage of ['r2', 'g2']) await tree.getByRole('checkbox', { name: `Select Default roll-up v1 · sample 1 · ${stage} for comparison` }).check();
  };
  const compare = nav.getByRole('region', { name: 'Compare selected outputs' });

  await selectOutputs();
  await compare.getByRole('button', { name: 'Judge prompt effect', exact: true }).click();
  const judge = page.getByRole('dialog', { name: 'Judge prompt effect' });
  await expect(judge).toContainText('1 baseline · 1 prompted');
  await judge.getByLabel('Exact prompt difference').fill('+ Explicit responsibility for state.');
  await judge.getByLabel('Controlled generation settings').fill('Same source, template, model and settings. Browser fixture.');
  await judge.getByRole('button', { name: 'Start Judge', exact: true }).click();
  let report;
  await expect.poll(async () => {
    const items = await fetch(url + '/api/mapping/evals/judgements').then(r => r.json());
    report = items.find(item => item.kind === 'comparison-report');
    return report?.status;
  }, { timeout: 30000 }).toBe('finished');
  const endpoint = url + '/api/mapping/evals/judgements/' + report.id;
  const saved = await fetch(endpoint).then(r => r.text());
  const record = JSON.parse(saved);
  assert.equal(record.data.pages.length, 2);
  assert.equal(record.data.pages[1].blocks[1].spec.A.camera.transform.scale, .6);
  await page.goto(`${url}/evals?judgements=&judgement=${report.id}`);
  await expect(page.getByRole('article', { name: 'High-level summary' })).toContainText('within-group variability');
  await page.getByRole('button', { name: '2. Canvas-level comparison' }).click();
  const firstFinding = page.locator('.comparison-report-block').first();
  const paneA = firstFinding.getByRole('region', { name: 'Comparison pane A', exact: true });
  const paneB = firstFinding.getByRole('region', { name: 'Comparison pane B', exact: true });
  const shapeA = paneA.locator('[data-native-node^="grid:"]').last();
  const shapeB = paneB.locator('[data-native-node^="grid:"]').last();
  await expect(shapeA).toBeAttached(); await expect(shapeB).toBeAttached();
  const geometry = async pane => pane.evaluate(element => {
    const viewport = element.getBoundingClientRect();
    const target = [...element.querySelectorAll('[data-native-node^="grid:"]')].at(-1).getBoundingClientRect();
    return [target.x - viewport.x, target.y - viewport.y, target.width, target.height];
  });
  let prior = '', stable = 0;
  await expect.poll(async () => { const next = JSON.stringify(await geometry(paneA)); stable = next === prior ? stable + 1 : 0; prior = next; return stable; }).toBeGreaterThan(1);
  const a = await geometry(paneA), b = await geometry(paneB);
  const viewport = await paneA.locator('.compare-canvas').boundingBox();
  await page.mouse.move(viewport.x + 160, viewport.y + 150); await page.mouse.down();
  await page.mouse.move(viewport.x + 240, viewport.y + 200, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => Math.abs((await geometry(paneA))[0] - a[0])).toBeGreaterThan(20);
  assert.deepEqual(await geometry(paneB), b, 'A pan must not change B');
  await paneA.getByRole('button', { name: 'Reset camera' }).click();
  await expect.poll(async () => Math.max(...(await geometry(paneA)).map((v, i) => Math.abs(v - a[i])))).toBeLessThan(1);
  await page.mouse.move(viewport.x + 180, viewport.y + 180);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -180); await page.keyboard.up('Control');
  await expect.poll(async () => Math.abs((await geometry(paneA))[2] - a[2])).toBeGreaterThan(1);
  await paneA.getByRole('button', { name: 'Reset camera' }).click();
  await expect.poll(async () => Math.max(...(await geometry(paneA)).map((v, i) => Math.abs(v - a[i])))).toBeLessThan(1);
  const divider = firstFinding.getByRole('separator', { name: 'Resize comparison panes' });
  await divider.focus(); await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
  assert.equal(await fetch(endpoint).then(r => r.text()), saved, 'Interactions must not mutate the saved report');
  await page.screenshot({ path: path.join(root, 'report.png'), fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: '2. Canvas-level comparison' }).click();
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  await expect.poll(async () => Math.max(...(await geometry(paneA)).map((v, i) => Math.abs(v - a[i])))).toBeLessThan(1);
  assert.equal(await fetch(endpoint).then(r => r.text()), saved);
  await expect(page.getByRole('region', { name: 'Opinion scale' })).toContainText('Estimated prompt-attributable difference');
  await expect(firstFinding).toContainText('Attribution confidence: low');
  await page.getByRole('button', { name: 'Next finding →' }).focus();
  await page.keyboard.press('ArrowRight');
  const detail = page.getByRole('region', { name: 'Corresponding tree details', exact: true });
  await expect(detail).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('Finding 2 of 2', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Align highlights' })).toHaveAttribute('aria-pressed', 'true');
  const aligned = async () => {
    const tops = await detail.locator('.compare-document').evaluateAll(elements => elements.map(element => {
      const start = element.querySelector('[data-compare-slice-start]');
      return start.getBoundingClientRect().top - element.getBoundingClientRect().top;
    }));
    return Math.abs(tops[0] - tops[1]);
  };
  await expect.poll(aligned).toBeLessThan(1);
  await detail.getByRole('button', { name: 'Show full diagrams' }).click();
  await expect.poll(aligned).toBeLessThan(1);
  await shot(page, 'mixed-comparison-diagram');
  await page.keyboard.press('ArrowLeft');
  await expect(firstFinding).toHaveAttribute('aria-current', 'step');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('article', { name: 'High-level summary' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(firstFinding).toHaveAttribute('aria-current', 'step');
  assert.equal(await fetch(endpoint).then(r => r.text()), saved, 'Traversal and alignment must stay local');
  // The same reusable diagram block still serves ordinary slice comparisons.
  await page.goto(`${url}/evals?run=${record.runIds[0]}`);
  const expand = tree.getByRole('button', { name: /^Expand Run #/ });
  if (await expand.count()) await expand.first().click();
  await selectOutputs();
  await compare.getByRole('button', { name: 'LLM comparison', exact: true }).click();
  let diagramReport;
  await expect.poll(async () => {
    const items = await fetch(url + '/api/mapping/evals/judgements').then(r => r.json());
    diagramReport = items.find(item => item.kind === 'diagram-comparison');
    return diagramReport?.status;
  }, { timeout: 30000 }).toBe('finished');
  await page.goto(`${url}/evals?judgements=&judgement=${diagramReport.id}`);
  await expect(page.getByRole('region', { name: 'Diagram document A' })).toBeVisible();
  await page.getByRole('button', { name: 'Show compared slices', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show full diagrams', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show full diagrams', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show compared slices', exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Prompt report: explicit groups, two pages, pinned cameras, independent pan/zoom/reset, local split, arrow traversal, opinion legend, aligned excerpts, immutable persistence and reload passed.');
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
