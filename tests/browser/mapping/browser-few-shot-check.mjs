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
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary.ts';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository.ts';
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
  await new AgentContextLibrary(new FileAgentContextRepository(storeRoot)).create({ requestId: crypto.randomUUID(), name: 'Canvas domain source', context: 'Pinned test source for diagram generation.' });
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
  await drawer.getByText('Few-shot refinement', { exact: true }).click();
  await drawer.getByRole('checkbox', { name: 'Five-slot refinement', exact: true }).check();
  await drawer.getByRole('checkbox', { name: /^Canvas domain source/ }).check();
  const target = drawer.getByLabel('Target canvas', { exact: true });
  await expect(target.locator('option')).not.toHaveCount(1);
  const option = await target.locator('option').filter({ hasText: 'First view' }).getAttribute('value');
  await target.selectOption(option);
  await expect(drawer.getByLabel('Task', { exact: true })).toHaveCount(0);
  await expect(drawer.getByLabel('Model', { exact: true })).toHaveValue('gpt-6-astra');
  await expect(drawer.getByLabel('Effort', { exact: true })).toHaveValue('high');
  await drawer.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(tree.locator('.evals-tree-row', { hasText: /Run #.*Five-slot refinement/ })).toContainText('13/13', { timeout: 30000 });
  await tree.getByRole('button', { name: /^Expand Run #/ }).click();
  await expect(tree.getByRole('button', { name: 'Round 3', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: 'Judgements', exact: true }).click();
  const report = page.getByRole('article', { name: 'Few-shot progress report' });
  await expect(report.getByRole('table', { name: 'Progress by round' }).locator('tbody tr')).toHaveCount(3);
  await report.getByText('Slot 1: Parcel pattern 1', { exact: true }).first().click();
  await expect(report.locator('pre').filter({ hasText: 'ParcelRoute1' }).first()).toBeVisible();
  await expect(report.getByRole('heading', { name: 'Further improvements · untested', exact: true })).toBeVisible();
  await shot(page, 'few-shot-progress');
  await page.reload();
  await expect(report.getByRole('table', { name: 'Progress by round' }).locator('tbody tr')).toHaveCount(3);
  assert.deepEqual(errors, []);
  console.log('Few-shot refinement UI passed: launch, nine outputs, three judged rounds, reference inspection and reload.');
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
