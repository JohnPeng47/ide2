// npm run build && node --import tsx tests/browser/mapping/browser-highlight-selection-check.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { historyFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory.ts';
import { importDiagramRevision } from '../../../domain/core/diagrams/diagramRevisionStore.ts';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace.ts';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController.ts';
const root = await mkdtemp(path.join(tmpdir(), 'highlight-selection-'));
let server, browser;
try {
  await seedMappingFixture(root, { ascii: 'Root\n  |-- Long branch\n  `-- Leaf', nodes: [] });
  // Shopify selections can start on an inter-canvas jump, which receives keyboard focus.
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const revision = catalog.revisions['revision-overview'];
  const history = historyFromRevision(revision), document = documentFromHistory(history);
  Object.values(history.diagramRevisions).forEach(importDiagramRevision);
  const controller = new MappingDocumentController(document, initialCanvasState());
  const content = document.scene.contents.overview.content;
  controller.applyUpdate(0, [{ method: 'setJumps', nodeId: 'grid:overview', jumps: [{ id: 'selection-jump',
    source: { revisionId: content.revisionId, contentHash: content.asciiSha256, line: 2, startColumn: 7, endColumn: 17 },
    target: { representationId: 'representation-overview', displayNodeId: 'grid:overview' } }] }]);
  revision.content = { kind: 'canvas-history', history: controller.exportHistory() };
  await writeFile(catalogPath, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; server.stdout.on('data', c => { logs += c; }); server.stderr.on('data', c => { logs += c; });
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url + '/mapping?diagram=representation-overview');
  const diagram = page.locator('[data-native-node="grid:overview"]');
  await expect(diagram.locator('pre')).toBeVisible();
  const state = async () => {
    const value = await fetch(url + '/api/mapping/workspace').then(r => r.json());
    return (value.workspace ?? value).documents.find(d => d.representationId === 'representation-overview');
  };
  const highlights = async () => Object.values((await state()).document.diagramPresentations ?? {}).flatMap(p => p.highlights ?? []);
  const box = diagram.locator('[data-grid-box="overview"]');
  const geometry = await box.evaluate(el => { const r=el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width / Number(el.dataset.gridColumns),h:r.height / Number(el.dataset.gridRows) }; });
  // A plain drag selects native diagram frames; Ctrl-drag selects text regions.
  const frame = await box.boundingBox();
  await page.mouse.move(frame.x - 35, frame.y - 35);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width + 25, frame.y + frame.height + 25, { steps: 6 });
  await page.mouse.up();
  await expect(box).toHaveAttribute('data-diagram-drag-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(box).toHaveAttribute('data-diagram-drag-selected', 'false');
  const selectRegion = async () => {
    await page.keyboard.down('Control');
    await page.mouse.move(geometry.x + geometry.w * 6.5, geometry.y + geometry.h * 1.5);
    await page.mouse.down();
    await page.mouse.move(geometry.x + geometry.w * 8.5, geometry.y + geometry.h * 2.5, { steps: 6 });
    await page.mouse.up(); await page.keyboard.up('Control');
  };
  await selectRegion();
  await expect(page.locator('[data-diagram-jump-id="selection-jump"]')).toBeFocused();
  await expect.poll(async () => (await state()).canvas.selection.items.length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).canvas.selection.items.length).toBe(0);
  await expect(page.locator('.retained-selection')).toHaveCount(0);
  await selectRegion();
  await page.keyboard.press('a');
  const menu = page.getByRole('dialog', { name: 'Selected node operations' });
  await expect(menu).toBeVisible();
  const highlight = menu.getByRole('button', { name: 'Highlight selection', exact: true });
  await expect(highlight).toHaveAttribute('aria-keyshortcuts', 'H');
  await highlight.click();
  await expect.poll(async () => (await highlights()).length).toBe(1);
  await expect(diagram.locator('[data-highlight-id]').first()).toBeVisible();
  const first = await highlights();
  assert.ok(first[0].contentNodeIds?.length, 'Region uses captured node membership');
  const unhighlight = menu.getByRole('button', { name: 'Unhighlight selection', exact: true });
  await expect(unhighlight).toBeVisible();
  await page.keyboard.press('h'); // The same shortcut removes highlights with button focus.
  await expect.poll(async () => (await highlights()).length).toBe(0);
  await expect(highlight).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect.poll(highlights).toEqual(first);
  if (!await unhighlight.isVisible()) await page.getByRole('button', { name: 'Actions (A)', exact: true }).click();
  await unhighlight.click();
  await expect.poll(async () => (await highlights()).length).toBe(0);
  await page.keyboard.press('h');
  await expect.poll(async () => (await highlights()).length).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await highlights()).length).toBe(0);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).canvas.selection.items.length).toBe(0);
  await expect(page.locator('.retained-selection')).toHaveCount(0);
  // Whole-diagram double click, then keyboard H without opening the menu.
  const rect = await box.boundingBox();
  await page.mouse.dblclick(rect.x + 2, rect.y + rect.height - 4);
  await expect(box).toHaveAttribute('data-diagram-selected', 'true');
  await page.keyboard.press('h');
  await expect.poll(async () => (await highlights()).length).toBe(1);
  assert.equal((await highlights())[0].contentNodeIds, undefined);
  await expect(diagram.locator('pre[data-highlight-id]')).toBeVisible();
  const actions = page.getByRole('button', { name: 'Actions (A)', exact: true });
  if (await actions.getAttribute('aria-expanded') !== 'true') await actions.click();
  const whole = page.getByRole('menu', { name: 'Selection actions' });
  const wholeUnhighlight = whole.getByRole('menuitem', { name: 'Unhighlight (H)', exact: true });
  await expect(wholeUnhighlight).toBeVisible();
  await wholeUnhighlight.click();
  await expect.poll(async () => (await highlights()).length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await highlights()).length).toBe(1);
  await page.keyboard.press('h');
  await expect.poll(async () => (await highlights()).length).toBe(0);
  if (await actions.getAttribute('aria-expanded') !== 'true') await actions.click();
  await whole.getByRole('menuitem', { name: 'Highlight (H)', exact: true }).click();
  await expect.poll(async () => (await highlights()).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await state()).canvas.selection.items.length).toBe(0);
  await expect(box).toHaveAttribute('data-diagram-selected', 'false');
  await expect(whole).toHaveCount(0);
  assert.equal((await highlights()).length, 1, 'Deselecting preserves the saved highlight');
  const filter = page.getByRole('searchbox', { name: 'Filter diagrams' });
  await filter.click(); await page.keyboard.press('h');
  await expect(filter).toHaveValue('h');
  assert.equal((await highlights()).length, 1);
  await page.reload();
  await expect(page.locator('[data-native-node="grid:overview"] pre[data-highlight-id]')).toBeVisible();
  assert.equal((await state()).document.scene.contents.overview.content.ascii, 'Root\n  |-- Long branch\n  `-- Leaf');
  assert.deepEqual(errors, []);
  console.log('PASS: Escape clears native drag frames and regions started on linked text; Highlight/Unhighlight + H, Undo, deselection from menu focus, persisted reload, unchanged content.');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
