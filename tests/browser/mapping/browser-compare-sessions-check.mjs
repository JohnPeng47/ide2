// npm run build && node --import tsx tests/browser/mapping/browser-compare-sessions-check.mjs
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

const root = await mkdtemp(path.join(tmpdir(), 'compare-sessions-browser-'));
let server, browser;
try {
  await seedMappingFixture(root, { ascii: 'Domain\n`-- Shared feature', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  await new WorkspaceRecordStore(storeRoot).state(projectId, async () => compareWorkspaceFixture(projectId));
  const manifest = await readFile(path.join(storeRoot, 'workspace-records.json'), 'utf8');
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = ''; server.stdout.on('data', chunk => { serverLog += chunk; }); server.stderr.on('data', chunk => { serverLog += chunk; });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/evals`);
  await expect(page.getByRole('heading', { name: 'New comparison session' })).toBeVisible();
  await page.getByLabel('View A', { exact: true }).selectOption({ label: 'CanvasDomain — First view' });
  await page.getByLabel('View B', { exact: true }).selectOption({ label: 'CanvasDomain — Second view' });
  await page.getByRole('button', { name: 'Add pair to session' }).click();
  await page.getByLabel('View A', { exact: true }).selectOption({ label: 'CanvasDomain — Second view' });
  await page.getByLabel('View B', { exact: true }).selectOption({ label: 'CanvasDomain — First view' });
  await page.getByRole('button', { name: 'Add pair to session' }).click();
  await page.getByRole('button', { name: 'Create session (2 pairs)', exact: true }).click();
  const paneA = page.locator('[data-compare-pane="A"]'), paneB = page.locator('[data-compare-pane="B"]');
  await expect(paneA.locator('[data-native-node="grid:overview"]')).toContainText('First implementation');
  await expect(paneB.locator('[data-native-node="grid:overview"]')).toContainText('Second implementation');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const divider = page.getByRole('separator', { name: 'Resize comparison panes' });
  const leftBefore = await paneA.boundingBox();
  await divider.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '54');
  assert.ok((await paneA.boundingBox()).width > leftBefore.width);
  const shapeA = paneA.locator('[data-native-node="grid:overview"]');
  const shapeB = paneB.locator('[data-native-node="grid:overview"]');
  const aBefore = await shapeA.boundingBox(), bBefore = await shapeB.boundingBox();
  const area = await paneA.boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height * .7);
  await page.mouse.down(); await page.mouse.move(area.x + area.width / 2 + 80, area.y + area.height * .7 + 40, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await shapeA.boundingBox())?.x).not.toBe(aBefore.x);
  assert.equal((await shapeB.boundingBox()).x, bBefore.x, 'Panning A must leave B alone');
  await page.getByRole('region', { name: 'Comparison pane A', exact: true }).getByRole('button', { name: 'Reset camera' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(paneA.locator('[data-native-node="grid:overview"]')).toContainText('Second implementation');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(paneA.locator('[data-native-node="grid:overview"]')).toContainText('First implementation');
  const sessionId = new URL(page.url()).searchParams.get('session'); assert.ok(sessionId);
  assert.equal(await readFile(path.join(storeRoot, 'workspace-records.json'), 'utf8'), manifest, 'Evals must not write to the Mapping workspace');
  // Reload after source deletion: only the session's copies can supply these diagrams.
  await new WorkspaceRecordStore(storeRoot).replace(projectId, { schemaVersion: 3, projectId, documents: [] });
  await page.reload();
  await expect(paneA.locator('[data-native-node="grid:overview"]')).toContainText('First implementation');
  await expect(paneB.locator('[data-native-node="grid:overview"]')).toContainText('Second implementation');
  const sessions = await (await fetch(`${url}/api/mapping/compare-sessions`)).json();
  assert.equal(sessions.length, 1); assert.equal(sessions[0].compareCount, 2);
  assert.deepEqual(errors, []);
  if (process.env.COMPARE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.COMPARE_SCREENSHOT_PATH });
  console.log('Compare sessions: creation, rendering, navigation, resizing, independent pan, reload and source deletion passed.');
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
