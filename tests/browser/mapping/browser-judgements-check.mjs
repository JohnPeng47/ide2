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
  await drawer.getByLabel('Passes').fill('1');
  await drawer.getByRole('button', { name: 'Start run' }).click();
  await expect(tree.locator('.evals-tree-row', { hasText: /Run #.*Default roll-up/ })).toContainText('2/2', { timeout: 30000 });
  await tree.getByRole('button', { name: /^Expand Run #/ }).click();
  await expect(tree.getByRole('button', { name: 'Judgements', exact: true })).toHaveCount(0);
  const selectOutputs = async () => {
    for (const stage of ['r2', 'g2']) await tree.getByRole('checkbox', { name: `Select Default roll-up v1 · pass 1 · ${stage} for comparison` }).check();
  };
  const compare = nav.getByRole('region', { name: 'Compare selected outputs' });
  await selectOutputs();
  await compare.getByRole('button', { name: 'Side by side', exact: true }).click();
  const pane = page.getByRole('region', { name: 'Judgements', exact: true });
  await expect(pane.getByText('Manual comparison', { exact: true })).toBeVisible();
  await expect(pane.getByRole('region', { name: 'Comparison pane A' })).toBeVisible();
  await expect(pane.locator('.compare-canvas')).toHaveCount(2);
  const runRow = tree.getByRole('button', { name: /^Run #/ }).locator('..').locator('..');
  const judgementLink = runRow.getByRole('button', { name: 'Judgements', exact: true });
  await expect(judgementLink).toBeVisible();
  const canvasChild = runRow.locator('.evals-tree-label').filter({ hasText: /side by side$/ });
  await expect(canvasChild).toBeVisible();
  await runRow.getByRole('button', { name: 'Collapse Judgements', exact: true }).click();
  await expect(canvasChild).toHaveCount(0);
  await runRow.getByRole('button', { name: 'Expand Judgements', exact: true }).click();
  await canvasChild.click();
  await expect(pane.locator('.compare-canvas')).toHaveCount(2);
  await expect(tree.getByRole('button', { name: 'Comparisons', exact: true })).toHaveCount(0);
  const originalUrl = page.url();
  await page.reload();
  await expect(pane.locator('.compare-canvas')).toHaveCount(2);
  await selectOutputs();
  await compare.getByRole('button', { name: 'LLM comparison', exact: true }).click();
  await expect(pane.getByLabel('Judgement').locator('option')).toHaveCount(2, { timeout: 30000 });
  const list = await fetch(url + '/api/mapping/evals/judgements').then(r => r.json());
  const diagram = list.find(item => item.kind === 'diagram-comparison');
  assert.ok(diagram);
  await runRow.locator('.evals-tree-label').filter({ hasText: /LLM comparison$/ }).click();
  await expect(pane.getByRole('region', { name: 'Comparison explanation' })).toBeVisible({ timeout: 30000 });
  await expect(pane.getByRole('region', { name: 'Diagram document A' })).toBeVisible();
  await expect(runRow.locator('[aria-current="page"]')).toContainText('LLM comparison');
  await pane.getByRole('button', { name: 'Show compared slices', exact: true }).click();
  await expect(pane.getByRole('button', { name: 'Show full diagrams', exact: true })).toBeVisible();
  await shot(page, 'judgements-diagram');
  const run = (await fetch(url + '/api/mapping/evals/runs').then(r => r.json()))[0];
  assert.equal(run.judgements.length, 2);
  assert.deepEqual(diagram.runIds, [run.id]);
  assert.ok((await fetch(url + '/api/mapping/evals/judgements/' + diagram.id).then(r => r.json())).data.comparisons.length);
  await page.reload();
  await expect(pane.getByLabel('Judgement', { exact: true })).toHaveValue(diagram.id);
  await expect(pane.getByRole('region', { name: 'Diagram document A' })).toBeVisible();
  await tree.getByRole('button', { name: 'g2', exact: true }).click();
  await judgementLink.click();
  await expect(pane).toBeVisible();
  await pane.getByLabel('Judgement', { exact: true }).selectOption(diagram.id);
  await pane.getByRole('button', { name: 'Delete judgement', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(pane.getByLabel('Judgement').locator('option')).toHaveCount(1);
  await expect(pane.locator('.compare-canvas')).toHaveCount(2);
  await page.reload();
  await expect(pane.getByLabel('Judgement').locator('option')).toHaveCount(1);
  await page.goto(originalUrl);
  await expect(pane.locator('.compare-canvas')).toHaveCount(2);
  await shot(page, 'judgements-canvas');
  assert.deepEqual(errors, []);
  console.log('PASS: optional run attachment, expandable Explorer judgements and single display pane, both typed views, model provenance, persisted navigation, deletion and reload.');
} catch (error) {
  console.error(error); process.exitCode = 1;
  if (page) await shot(page, 'failure').catch(() => {});
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
