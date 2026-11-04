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
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/evals`);
  await page.getByRole('button', { name: 'New comparison', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New comparison' })).toBeVisible();
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
  const currentSessionId = async () => {
    const params = new URL(page.url()).searchParams;
    return params.get('session') ?? (await fetch(`${url}/api/mapping/evals/judgements/${params.get('judgement')}`).then(r => r.json())).source.id;
  };
  const sessionId = await currentSessionId(); assert.ok(sessionId);
  assert.equal(await readFile(path.join(storeRoot, 'workspace-records.json'), 'utf8'), manifest, 'Evals must not write to the Mapping workspace');
  // Same saved view in both panes: three explicit, ordered camera focuses.
  await page.getByRole('button', { name: 'New comparison', exact: true }).click();
  await page.getByLabel('Session name').fill('Three diagram tour');
  await page.getByLabel('View A', { exact: true }).selectOption({ label: 'CanvasDomain — First view' });
  await page.getByLabel('View B', { exact: true }).selectOption({ label: 'CanvasDomain — First view' });
  await page.getByRole('button', { name: 'Create session', exact: true }).click();
  const focused = async (id) => {
    await expect(paneA).toHaveAttribute('data-focus-diagram', id);
    await expect(paneB).toHaveAttribute('data-focus-diagram', id);
    for (const pane of [paneA, paneB]) {
      await expect.poll(async () => {
        const viewport = await pane.boundingBox(), target = await pane.locator(`[data-native-node="${id}"]`).boundingBox();
        return !!target && target.x >= viewport.x + 20 && target.y >= viewport.y + 20
          && target.x + target.width <= viewport.x + viewport.width - 20 && target.y + target.height <= viewport.y + viewport.height - 20;
      }).toBe(true);
    }
  };
  await focused('grid:overview');
  await paneA.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('ArrowRight'); await focused('grid:relationships');
  await page.keyboard.press('ArrowLeft'); await focused('grid:overview');
  await page.keyboard.press('ArrowLeft'); await focused('grid:overview'); // Stop at the first step.
  await paneB.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('ArrowRight'); await focused('grid:relationships');
  await page.keyboard.press('ArrowRight'); await focused('grid:persistence');
  await page.keyboard.press('ArrowRight'); await focused('grid:persistence'); // Stop at the final step.
  await page.keyboard.press('ArrowLeft'); await focused('grid:relationships');
  await page.keyboard.press('ArrowLeft'); await focused('grid:overview');
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await focused('grid:relationships');
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await focused('grid:persistence');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  const relativeGeometry = async (id) => Promise.all([paneA, paneB].map(pane => pane.evaluate((element, id) => {
    const viewport = element.getBoundingClientRect(), target = element.querySelector(`[data-native-node="${id}"]`).getBoundingClientRect();
    return [target.x - viewport.x, target.y - viewport.y, target.width, target.height];
  }, id)));
  const unchangedCamera = async (id, before) => {
    await expect.poll(async () => {
      const after = await relativeGeometry(id);
      return Math.max(...after.flatMap((pane, i) => pane.map((value, j) => Math.abs(value - before[i][j]))));
    }).toBeLessThan(0.75);
  };
  const resizeBefore = await relativeGeometry('grid:persistence');
  await divider.focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await unchangedCamera('grid:persistence', resizeBefore);
  // Resizing changes the visible area without changing either pane's pan or zoom.
  const handle = await divider.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100); await page.mouse.down();
  await page.mouse.move(handle.x - 130, handle.y + 100, { steps: 8 }); await page.mouse.up();
  await unchangedCamera('grid:persistence', resizeBefore);
  await page.getByRole('button', { name: 'Previous', exact: true }).click(); await focused('grid:relationships');
  const focusedBefore = await paneA.locator('[data-native-node="grid:relationships"]').boundingBox();
  const focusedB = await paneB.locator('[data-native-node="grid:relationships"]').boundingBox();
  const canvasArea = await paneA.boundingBox();
  await page.mouse.move(canvasArea.x + canvasArea.width / 2, canvasArea.y + canvasArea.height / 2);
  await page.mouse.down(); await page.mouse.move(canvasArea.x + canvasArea.width / 2 + 90, canvasArea.y + canvasArea.height / 2 + 50, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await paneA.locator('[data-native-node="grid:relationships"]').boundingBox()).x).not.toBe(focusedBefore.x);
  assert.equal((await paneB.locator('[data-native-node="grid:relationships"]').boundingBox()).x, focusedB.x);
  // Let the hand tool's inertial pan finish before measuring a resize.
  let previousPan = '', stablePanSamples = 0;
  await expect.poll(async () => {
    const current = JSON.stringify((await relativeGeometry('grid:relationships')).flat().map(value => Math.round(value * 100)));
    stablePanSamples = current === previousPan ? stablePanSamples + 1 : 0; previousPan = current;
    return stablePanSamples;
  }).toBeGreaterThanOrEqual(2);
  const pannedBeforeResize = await relativeGeometry('grid:relationships');
  await page.setViewportSize({ width: 1740, height: 1060 });
  await unchangedCamera('grid:relationships', pannedBeforeResize);
  await page.getByRole('region', { name: 'Comparison pane A', exact: true }).getByRole('button', { name: 'Reset focus' }).click();
  await focused('grid:relationships');
  if (process.env.COMPARE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.COMPARE_SCREENSHOT_PATH });
  const tourId = await currentSessionId();
  const tour = await (await fetch(`${url}/api/mapping/compare-sessions/${tourId}`)).json();
  assert.equal(tour.compares[0].points.length, 3);
  assert.equal(tour.canvases[0].view.cameraViews.length, 3);
  assert.equal(await readFile(path.join(storeRoot, 'workspace-records.json'), 'utf8'), manifest);
  // Reload after source deletion: only the session's copies can supply these diagrams.
  await new WorkspaceRecordStore(storeRoot).replace(projectId, { schemaVersion: 3, projectId, documents: [] });
  await page.reload();
  await expect(paneA.locator('[data-native-node="grid:overview"]')).toContainText('First implementation');
  await expect(paneB.locator('[data-native-node="grid:overview"]')).toContainText('First implementation');
  await focused('grid:overview');
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await focused('grid:relationships');
  const sessions = await (await fetch(`${url}/api/mapping/compare-sessions`)).json();
  assert.equal(sessions.length, 2); assert.equal(sessions.find(session => session.id === sessionId).compareCount, 2);
  assert.deepEqual(errors, []);
  if (process.env.COMPARE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.COMPARE_SCREENSHOT_PATH });
  console.log('Compare sessions: creation, three target cameras, framing, cycling, pointer/keyboard resizing, independent pan/reset, reload and source deletion passed.');
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
