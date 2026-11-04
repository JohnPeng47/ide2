// npm run build && node --import tsx tests/browser/mapping/browser-evals-date-delete-check.mjs
// Date deletion uses descendant resources and preserves other dates. Uses disposable data and the fake runtime.
import assert from 'node:assert/strict';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
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
  await new JsonDirectoryStore(storeRoot, 'eval-runs').save({
    schemaVersion: 1, projectId, id: 'earlier-run', requestHash: 'fixture', workflow: 'alternatives',
    agentContextId: 'earlier-context', contextName: 'Earlier context', name: 'Keep this run',
    createdAt: '2020-01-02T12:00:00Z', status: 'failed', prompts: [], inputs: {},
    request: { requestId: 'earlier-run', workflow: 'alternatives', prompts: [], inputs: {}, passes: 1, model: 'test', effort: 'high' },
    cells: [{ key: 'earlier-output', pass: 1, stage: 'alternative', status: 'failed', error: 'Fixture failure' }]
  });
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
  page.on('dialog', dialog => { errors.push(`Unexpected browser dialog: ${dialog.message()}`); void dialog.dismiss(); });

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
  const currentDate = tree.locator(':scope > li').last();
  await expect(currentDate.locator('.evals-tree-row', { hasText: /Run #.*Default roll-up/ })).toContainText('2/2', { timeout: 30000 });
  const dateLabel = await currentDate.locator(':scope > .evals-tree-row > .evals-tree-label').innerText();
  await currentDate.getByRole('button', { name: /^Expand Run #/ }).click();
  await currentDate.getByRole('button', { name: 'g2', exact: true }).click();
  await expect(tree.locator('[aria-current="page"]')).toBeVisible();
  await currentDate.getByRole('button', { name: 'Collapse ' + dateLabel, exact: true }).click();
  const deleteDate = tree.getByRole('button', { name: 'Delete everything under ' + dateLabel, exact: true });
  await deleteDate.click();
  const confirmation = page.getByRole('dialog', { name: 'Confirm deletion' });
  await expect(confirmation).toContainText('Runs: 1; outputs: 2; judgements: 0');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteDate).toBeVisible();
  await deleteDate.click();
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect(deleteDate).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Generate, then compare' })).toBeVisible();
  await expect(tree.getByRole('button', { name: /^Run #.*Keep this run$/ })).toBeVisible();
  assert.deepEqual((await fetch(url + '/api/mapping/evals/runs').then(r => r.json())).map(run => run.id), ['earlier-run']);
  assert.deepEqual(await fetch(url + '/api/mapping/evals/canvases').then(r => r.json()), []);
  await page.reload();
  await expect(tree.getByRole('button', { name: /^Run #.*Keep this run$/ })).toBeVisible();
  await expect(deleteDate).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS: collapsed date deletion, cancel/confirm, output cleanup, route reset, other dates preserved, and reload.');
} catch (error) {
  console.error(error); process.exitCode = 1;
  if (page) await shot(page, 'failure').catch(() => {});
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
