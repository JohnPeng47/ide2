// npm run build && node --import tsx tests/browser/mapping/browser-eval-output-result-check.mjs
// Saved fixtures only: no experiment or model generation, including the fake runtime.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { evalOutputFixture } from '../../support/evalOutputResult.ts';
import { compareWorkspaceFixture } from '../../support/compareWorkspace.ts';
import { captureChangeSessionOutput, summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult.ts';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';

const root = await mkdtemp(path.join(tmpdir(), 'eval-output-browser-'));
let server, browser, page;
const errors = [], requests = [];
try {
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Source', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const { run, session } = evalOutputFixture(projectId);
  const result = captureChangeSessionOutput(session), key = run.cells[0].key;
  run.status = 'finished'; run.cells[0].status = 'finished'; delete run.cells[0].error;
  run.cells[0].output = summarizeEvalOutput(result); run.outputResults = { [key]: result };
  const store = new JsonDirectoryStore(storeRoot, 'eval-runs');
  await store.save(run);
  const savedFile = path.join(storeRoot, 'eval-runs', `${run.id}.json`), savedBefore = await readFile(savedFile, 'utf8');
  // Deliberately never save the source ChangeSession: the preview must be self-contained.
  const legacy = structuredClone(run), history = compareWorkspaceFixture(projectId).documents[0].history;
  legacy.id = 'single-canvas-run'; legacy.number = 2; delete legacy.outputResults;
  legacy.cells = [{ key: 'legacy', stage: 'proposal', pass: 1, status: 'finished', canvasId: 'old-output', checkpointId: history.headId }];
  legacy.outputSnapshots = { 'old-output': { id: 'old-output', name: 'Legacy output', history,
    generated: { key: 'legacy', agentContextId: run.agentContextId, contextName: 'Legacy output', stage: 'proposal' } } };
  await store.save(legacy);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', chunk => { log += chunk; }); server.stderr.on('data', chunk => { log += chunk; });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000, message: 'Disposable preview server' }).toBe(200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/api/')) requests.push({ url: request.url(), method: request.method() }); });
  const open = `${url}/evals?run=${run.id}&output=${encodeURIComponent(key)}`;
  await page.goto(open);
  const preview = page.getByRole('region', { name: 'Execution result', exact: true });
  await expect(preview.getByLabel('Output canvas')).toHaveValue('existing-canvas', { timeout: 15000 });
  await expect(preview.locator('[data-diff-diagram="overview"]')).toContainText('New execution implementation');
  await expect(preview.locator('[data-diff-diagram="relationships"]')).toHaveCount(0);
  await expect(preview.locator('[data-diff-status]')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(preview.locator('[data-diff-status="removed"]').first()).toBeVisible();
  await expect(preview.locator('[data-diff-status="added"]').first()).toBeVisible();
  await expect(preview.locator('[data-diff-diagram="relationships"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept all changes' })).toHaveCount(0);
  const bounds = await preview.boundingBox(); assert.ok(bounds.width > 500 && bounds.height > 350);
  await page.screenshot({ path: path.join(root, 'changes-preview.png') });
  const surface = preview.locator('.diagram-canvas__surface');
  const beforePan = await surface.evaluate(element => element.style.transform);
  const canvasBounds = await preview.locator('[data-diagram-canvas]').boundingBox();
  const panX = Math.min(1400, canvasBounds.x + canvasBounds.width - 100), panY = Math.min(800, canvasBounds.y + canvasBounds.height - 120);
  await page.mouse.move(panX, panY);
  await page.mouse.down(); await page.mouse.move(panX - 70, panY + 30, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => surface.evaluate(element => element.style.transform)).not.toBe(beforePan);
  const panned = await surface.evaluate(element => element.style.transform);
  await preview.getByRole('button', { name: 'Next canvas', exact: true }).click();
  await expect(preview.getByLabel('Output canvas')).toHaveValue('new-canvas');
  await expect(preview.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(preview.getByText('New canvas', { exact: true })).toBeVisible();
  await expect(preview.locator('[data-diff-status="added"]').first()).toBeVisible();
  await preview.getByRole('button', { name: 'Next canvas', exact: true }).click();
  await expect(preview.getByLabel('Output canvas')).toHaveValue('existing-canvas');
  await expect.poll(() => surface.evaluate(element => element.style.transform)).toBe(panned);
  await preview.getByRole('button', { name: 'Previous canvas', exact: true }).click();
  await expect(preview.getByLabel('Output canvas')).toHaveValue('new-canvas');
  // Native selector keyboard interaction and toolbar arrows stay inside this output.
  await preview.getByLabel('Output canvas').focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(preview.getByLabel('Output canvas')).toHaveValue('existing-canvas');
  await preview.getByRole('button', { name: 'Next canvas', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(preview.getByLabel('Output canvas')).toHaveValue('new-canvas'); assert.equal(page.url(), open);
  await preview.getByRole('button', { name: 'Previous canvas', exact: true }).click();
  await preview.getByRole('button', { name: 'Result', exact: true }).click();
  await preview.locator('[data-diagram-jump-id="to-new-canvas"]').click();
  await expect(preview.getByLabel('Output canvas')).toHaveValue('new-canvas');
  await expect(preview.getByRole('button', { name: 'Result', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(preview.getByLabel('Output canvas')).toHaveValue('new-canvas');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(preview.locator('[data-diff-diagram="overview"]')).toContainText('New execution implementation');
  assert.equal(await readFile(savedFile, 'utf8'), savedBefore, 'Browsing must not modify saved evidence');
  assert.equal(requests.filter(request => request.url.includes('/change-sessions/')).length, 0, 'No live session requests or polling');
  // Evals' existing startup migration is independent of preview navigation.
  assert.deepEqual(requests.filter(request => request.method !== 'GET' && !new URL(request.url).pathname.endsWith('/evals/migrate')), [], 'Preview is read-only and never launches generation');
  // Historical single-canvas outputs, including deleted originals, retain their pinned preview.
  await page.goto(`${url}/evals?run=${legacy.id}&output=legacy`);
  await expect(page.getByRole('region', { name: 'Canvas Legacy output', exact: true }).locator('[data-native-node]').first()).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: multi-canvas cycling/selection, Result/Changes, additions/removals, cross-canvas links, reload, immutable evidence, no live requests, legacy preview.');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error('Browser page:', await page?.locator('body').innerText().catch(() => 'unavailable'));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
