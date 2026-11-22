// npm run build && node --import tsx tests/browser/mapping/browser-linked-canvases-check.mjs
// Only a disposable project and deterministic fake runtime; no paid model calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { compareWorkspaceFixture } from '../../support/compareWorkspace.ts';
import { WorkspaceRecordStore } from '../../../infrastructure/mapping/persistence/workspace/workspaceRecordStore.ts';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary.ts';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository.ts';

const root = await mkdtemp(path.join(tmpdir(), 'linked-canvases-browser-'));
let server, browser;
const errors = [];
try {
  await seedMappingFixture(root, { ascii: 'Overview\n`-- Evidence', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  await new WorkspaceRecordStore(storeRoot).state(projectId, async () => compareWorkspaceFixture(projectId));
  await new AgentContextLibrary(new FileAgentContextRepository(storeRoot)).create({ requestId: crypto.randomUUID(), name: 'Linked evidence', context: 'Overview and detail share supporting evidence.' });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', c => { log += c; }); server.stderr.on('data', c => { log += c; });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '/evals');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Workflow' }).locator('label').filter({ hasText: 'Linked canvases' }).click();
  await expect(page.getByRole('radio', { name: 'Linked canvases', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Linked evidence', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Default linked canvases', exact: true }).check();
  const inputs = page.getByRole('tree', { name: 'Input canvases', exact: true });
  await expect(inputs.getByRole('checkbox').first()).toBeVisible();
  await inputs.getByRole('checkbox').first().check();
  await expect(page.getByText('1 pinned canvas inputs', { exact: true })).toBeVisible();
  const launch = page.getByRole('button', { name: /Start.*run|Generate/i }).last();
  await expect(launch).toBeEnabled();
  await launch.click();
  const preview = page.getByRole('region', { name: 'Execution result', exact: true });
  // If the run view opens at its summary, select the finished output from the tree.
  await expect.poll(async () => {
    const runs = await fetch(url + '/api/mapping/evals/runs').then(r => r.json());
    return runs.find(r => r.workflow === 'linked-canvases')?.status;
  }, { timeout: 20000 }).toBe('finished');
  const runs = await fetch(url + '/api/mapping/evals/runs').then(r => r.json());
  const run = runs.find(r => r.workflow === 'linked-canvases');
  assert.equal(run.cells.length, 1); assert.equal(run.cells[0].output.canvases.length, 2);
  // Navigate via the public output URL to test saved result hydration independently of launch selection.
  await page.goto(`${url}/evals?run=${run.id}&output=${encodeURIComponent(run.cells[0].key)}`);
  await expect(preview.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Changes', exact: true })).toBeVisible();
  const savedFile = path.join(storeRoot, 'eval-runs', run.id + '.json');
  const before = await readFile(savedFile, 'utf8');
  await preview.locator('[data-diagram-jump-id="jump-1"]').click();
  await expect(preview.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(preview.getByLabel('Output canvas')).toHaveValue(run.cells[0].output.canvases[1].id);
  await page.reload();
  await expect(preview.getByText('2 / 2', { exact: true })).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(preview.getByText('1 / 2', { exact: true })).toBeVisible();
  await preview.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Changes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: path.join(root, 'linked-result.png') });
  await preview.getByRole('button', { name: 'Result', exact: true }).click();
  await preview.getByRole('button', { name: 'Promote output set…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Promote output', exact: true });
  await dialog.getByLabel('Project name', { exact: true }).fill('Shopify promoted');
  await dialog.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Promoted 2 canvases.');
  const promotedLinks = await dialog.getByRole('link').evaluateAll(links => links.map(a => ({ name: a.textContent, url: a.href })));
  const mapping = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await mapping.goto(promotedLinks[0].url);
  await expect(mapping.locator('summary.repository-heading', { hasText: 'Shopify promoted' })).toBeVisible();
  await mapping.reload();
  await expect(mapping.locator('summary.repository-heading', { hasText: 'Shopify promoted' })).toBeVisible();
  await mapping.locator('[data-diagram-jump-id="jump-1"]').first().click();
  await expect(mapping).toHaveURL(promotedLinks[1].url);
  await mapping.close();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await preview.getByRole('button', { name: 'Next canvas', exact: true }).click();
  await preview.getByRole('button', { name: /^Promote diagram / }).first().click();
  await dialog.getByLabel('Promotion destination').selectOption('existing-canvas');
  const targetId = new URL(promotedLinks[0].url).searchParams.get('diagram');
  await dialog.getByLabel('Destination canvas').selectOption(targetId);
  await dialog.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Promoted 1 canvas.');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await preview.getByRole('button', { name: 'Promote canvas…', exact: true }).click();
  await dialog.getByLabel('Canvas name', { exact: true }).fill('Standalone detail');
  const projectOption = dialog.getByLabel('Destination project').getByRole('option', { name: 'Shopify promoted', exact: true });
  await expect(projectOption).toHaveCount(1);
  await dialog.getByLabel('Destination project').selectOption(await projectOption.getAttribute('value'));
  await dialog.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Promoted 1 canvas.');
  await page.reload();
  assert.equal(await readFile(savedFile, 'utf8'), before);
  assert.deepEqual(errors, []);
  console.log('PASS: launcher pins a canvas, fake generation saves one linked result, span click navigates, reload restores the selected canvas, Changes works without a ChangeSession, promotion creates a persistent project, promotes a diagram into an existing canvas and a standalone canvas, and preserves evidence.');
} finally {
  await browser?.close();
  if (server) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await exited; }
  await rm(root, { recursive: true, force: true });
}
