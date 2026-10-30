// npm run build && node --import tsx tests/browser/mapping/browser-projection-folder-check.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { CanvasHistory, documentFromHistory } from '../../../domain/core/diagrams/canvasHistory.ts';
import { prepareDiagramProjection } from '../../../domain/core/diagrams/highlightProjection.ts';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace.ts';

const root = await mkdtemp(path.join(tmpdir(), 'projection-folder-'));
let server, browser, page;
try {
  await seedMappingFixture(root, { ascii: 'Services\n`-- API', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const catalog = JSON.parse(await readFile(path.join(storeRoot, 'representations/catalog.json'), 'utf8'));
  const sourceId = 'representation-overview', firstId = 'draft-first', secondId = 'draft-second';
  const saved = catalog.revisions['revision-overview'].content.history;
  // Seed the workspace with the same presentation defaults its live controller uses.
  saved.snapshots[saved.headId].view = initialCanvasState();
  const history = new CanvasHistory(documentFromHistory(saved), initialCanvasState(), saved).export();
  const project = (history, sourceId, destinationId) => prepareDiagramProjection(history, {
    sourceId, sourceAliases: [sourceId], destinationId,
    selectedIds: [`grid:${documentFromHistory(history).scene.root.children[0].id}`], destinationView: initialCanvasState()
  });
  const first = project(history, sourceId, firstId), second = project(first.destination.history, firstId, secondId);
  const projection = (id, name, state) => ({ representationId: id, name, revisionId: '', savedName: '',
    savedScene: JSON.stringify(state.document.scene), savedEdges: JSON.stringify(state.document.edges),
    document: state.document, canvas: state.view, history: state.history });
  await writeFile(path.join(storeRoot, 'mapping-workspace.json'), JSON.stringify({
    schemaVersion: 3, projectId: catalog.projectId, activeDocumentId: secondId, transfers: [first.transaction, second.transaction],
    documents: [
      { representationId: sourceId, name: 'Source canvas', savedName: 'Source canvas', revisionId: 'revision-overview',
        savedScene: JSON.stringify(first.source.document.scene), savedEdges: '[]', document: first.source.document,
        canvas: initialCanvasState(), history: first.source.history },
      { ...projection(firstId, 'First projection', first.destination), parentCanvasId: sourceId },
      { ...projection(secondId, 'Second projection', second.destination), type: 'projection' }
    ]
  }));
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot }, stdio: 'ignore'
  });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/')) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${url}/mapping?diagram=${secondId}`);
  const folder = page.locator('[data-repository-group="canvas-projections"]');
  const firstLink = folder.locator(`[data-project-diagram="${firstId}"]`), secondLink = folder.locator(`[data-project-diagram="${secondId}"]`);
  await expect(firstLink).toBeVisible({ timeout: 30000 }); await expect(secondLink).toBeVisible();
  await expect(secondLink).toHaveAttribute('aria-current', 'page');
  await expect(folder.locator(':scope > details > ul > li')).toHaveCount(2);
  await expect(folder.locator(`[data-project-diagram="${sourceId}"]`)).toHaveCount(0);
  const persisted = async () => { const value = await (await fetch(`${url}/api/mapping/workspace`)).json(); return value.workspace ?? value; };
  await expect.poll(async () => (await persisted()).documents.find(doc => doc.representationId === firstId)?.type).toBe('projection');
  assert.equal((await persisted()).documents.find(doc => doc.representationId === firstId).parentCanvasId, undefined);
  await folder.locator('summary').click(); await expect(firstLink).toBeHidden();
  await folder.locator('summary').click(); await expect(firstLink).toBeVisible();
  const filter = page.getByRole('searchbox', { name: 'Filter diagrams' });
  await filter.fill('First projection'); await expect(firstLink).toBeVisible(); await expect(secondLink).toHaveCount(0);
  await expect(page.locator(`[data-project-diagram="${sourceId}"]`)).toHaveCount(0);
  await filter.fill('Projections'); await expect(firstLink).toBeVisible(); await expect(secondLink).toBeVisible();
  await filter.fill('');
  // Creation undo hides only the projected canvas, then redo restores its folder entry.
  await secondLink.click();
  await page.keyboard.press('Control+z');
  await expect(secondLink).toHaveCount(0); await expect(firstLink).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(secondLink).toBeVisible();
  await firstLink.click();
  await expect(firstLink).toHaveAttribute('aria-current', 'page');
  await page.reload(); await expect(firstLink).toHaveAttribute('aria-current', 'page', { timeout: 30000 });
  await expect(folder.locator(':scope > details > ul > li')).toHaveCount(2);
  // Removing the former parent must retain both typed projections in the same folder.
  await page.getByRole('button', { name: 'Delete diagram Source canvas', exact: true }).click();
  await expect(page.locator(`[data-project-diagram="${sourceId}"]`)).toHaveCount(0);
  await expect(firstLink).toBeVisible(); await expect(secondLink).toBeVisible();
  if (process.env.PROJECTION_SCREENSHOT) await page.screenshot({ path: process.env.PROJECTION_SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log('Projection folder: legacy migration, flat grouping, filtering, collapse/open, creation undo/redo, reload and source deletion passed.');
} catch (error) {
  console.error(await page?.locator('body').innerText());
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
