// npm run build && node --import tsx tests/browser/mapping/browser-compare-diagrams-check.mjs
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

const root = await mkdtemp(path.join(tmpdir(), 'compare-diagrams-browser-'));
let server, browser;
try {
  await seedMappingFixture(root, { ascii: 'Domain\n`-- Shared feature', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const records = new WorkspaceRecordStore(storeRoot);
  const lines = Array.from({ length: 90 }, (_, i) => `|-- Document row ${i + 1} ${'wide content '.repeat(12)}`);
  await records.state(projectId, async () => compareWorkspaceFixture(projectId, lines));
  const manifest = await readFile(path.join(storeRoot, 'workspace-records.json'), 'utf8');
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot }, stdio: 'ignore'
  });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${url}/evals`);
  // Use native keyboard selection rather than setting form state.
  const choose = async (label, option) => {
    const select = page.getByLabel(label, { exact: true });
    await expect(select).toBeVisible();
    const index = await select.locator('option').evaluateAll((options, text) => options.findIndex(option => option.textContent === text), option);
    assert.ok(index >= 0, `Missing option ${option}`);
    await select.focus(); await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
  };
  await expect(page.getByRole('heading', { name: 'New comparison session' })).toBeVisible();
  await choose('Presentation', 'Diagrams');
  await choose('View A', 'CanvasDomain — First view');
  await choose('View B', 'CanvasDomain — Second view');
  await choose('Diagram A', 'Domain'); await choose('Diagram B', 'Domain');
  await page.getByRole('button', { name: 'Add pair to session' }).click();
  await choose('View A', 'CanvasDomain — Second view');
  await choose('View B', 'CanvasDomain — First view');
  await page.getByRole('button', { name: 'Add pair to session' }).click();
  await page.getByRole('button', { name: 'Create session (2 pairs)', exact: true }).click();
  const A = page.getByRole('region', { name: 'Diagram document A', exact: true });
  const B = page.getByRole('region', { name: 'Diagram document B', exact: true });
  await expect(A).toContainText('First implementation'); await expect(B).toContainText('Second implementation');
  await expect(A).not.toContainText('Second implementation'); await expect(B).not.toContainText('First implementation');
  await expect(page.locator('.tl-container')).toHaveCount(0);
  for (const pane of [A, B]) {
    assert.equal(await pane.locator('pre').evaluate(element => getComputedStyle(element).fontSize), '14px');
    assert.ok(await pane.evaluate(element => element.scrollHeight > element.clientHeight && element.scrollWidth > element.clientWidth));
  }
  await A.hover(); await page.mouse.wheel(250, 450);
  await expect.poll(() => A.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => A.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  assert.equal(await B.evaluate(element => element.scrollTop + element.scrollLeft), 0, 'Scrolling A leaves B alone');
  await A.focus(); await page.keyboard.press('ArrowRight');
  await expect(A).toContainText('First implementation'); // Native document arrows must not switch pairs.
  const divider = page.getByRole('separator', { name: 'Resize comparison panes' });
  const width = (await A.boundingBox()).width;
  await divider.focus(); await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '52');
  assert.ok((await A.boundingBox()).width > width);
  await B.hover(); await page.mouse.wheel(0, 300);
  await expect.poll(() => B.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('region', { name: 'Comparison pane A', exact: true }).getByRole('button', { name: 'Top', exact: true }).click();
  await expect.poll(() => A.evaluate(element => element.scrollTop + element.scrollLeft)).toBe(0);
  assert.ok(await B.evaluate(element => element.scrollTop > 0));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(A).toContainText('Second implementation'); await expect(B).toContainText('First implementation');
  assert.equal(await B.evaluate(element => element.scrollTop), 0, 'A new pair starts at the top');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(A).toContainText('First implementation');
  const sessionId = new URL(page.url()).searchParams.get('session'); assert.ok(sessionId);
  const session = await (await fetch(`${url}/api/mapping/compare-sessions/${sessionId}`)).json();
  assert.equal(session.compares.length, 2);
  assert.equal(session.compares[0].A.kind, 'diagram');
  assert.equal(session.compares[0].points, undefined);
  await expect(A).toHaveAttribute('data-diagram-revision', session.compares[0].A.revisionId);
  assert.equal(await readFile(path.join(storeRoot, 'workspace-records.json'), 'utf8'), manifest);
  // Delete only this disposable fixture; the reloaded panes must use their saved copies.
  await records.replace(projectId, { schemaVersion: 3, projectId, documents: [] });
  await page.reload();
  await expect(A).toContainText('First implementation'); await expect(B).toContainText('Second implementation');
  assert.deepEqual(errors, []);
  if (process.env.COMPARE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.COMPARE_SCREENSHOT_PATH });
  console.log('Diagram panes: pinned revisions, independent two-axis scrolling, native arrow keys, resize, Top, pair navigation and reload after source deletion passed.');
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
