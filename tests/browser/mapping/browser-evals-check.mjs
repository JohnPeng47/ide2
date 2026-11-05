// npm run build && node --import tsx tests/browser/mapping/browser-evals-check.mjs
// End-to-end Evals flow against the fake agent runtime. Set EVALS_SCREENSHOTS=<dir> to save screenshots.
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

  // Prompt editor: template validation, variable insertion, preview, create.
  await page.getByRole('button', { name: 'Prompts ▾' }).click();
  await expect(page.getByRole('menu', { name: 'Prompts' }).getByRole('menuitem', { name: /Default alternative/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /Template alternative/ }).click();
  await expect(page.getByLabel('Alternative instructions')).toHaveValue(/Read layout-template\.json\./);
  await expect(page.getByLabel('Alternative instructions')).toHaveValue(/template-slots-v1/);
  await expect(page.getByRole('button', { name: 'Insert {{task}}', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show full prompt preview' }).click();
  await expect(page.getByLabel('Full prompt preview')).toContainText('Read layout-template.json.');
  await shot(page, '01-template-prompt');
  await page.reload();
  await expect(page.getByLabel('Alternative instructions')).toHaveValue(/Read layout-template\.json\./);
  await page.getByRole('button', { name: 'Prompts ▾' }).click();
  await page.getByRole('menuitem', { name: '+ New roll-up prompt' }).click();
  await page.getByLabel('Prompt name').fill('Terse roll-up');
  const r2 = page.getByLabel('r2 · Roll up instructions');
  await r2.fill('Compress {{child}} for {{parnt}}.');
  await expect(page.getByText('Unknown variable {{parnt}}.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create prompt' })).toBeDisabled();
  await shot(page, '02-prompt-error');
  await r2.fill('Compress {{child}} tersely for ');
  await page.getByRole('button', { name: 'Insert {{parent}}' }).click();
  await expect(r2).toHaveValue('Compress {{child}} tersely for {{parent}}');
  await page.getByRole('tab', { name: /g2/ }).click();
  await page.getByLabel('g2 · Attach instructions').fill('Attach tersely. Pass {{pass}} of {{passes}}.');
  await page.getByRole('button', { name: 'Show full prompt preview' }).click();
  await expect(page.getByLabel('Full prompt preview')).toContainText('Pass 1 of 1');
  await expect(page.getByLabel('Full prompt preview')).toHaveText('Attach tersely. Pass 1 of 1.');
  await page.getByRole('button', { name: 'Create prompt' }).click();
  await expect(page.getByLabel('Prompt version')).toBeVisible();

  // Editing hotkeys and cross-stage undo.
  await r2.fill('');
  await r2.pressSequentially('line one');
  await page.waitForTimeout(1100); // A pause ends one coalesced typing step.
  await r2.press('Enter'); await r2.pressSequentially('line two');
  await r2.press('Control+z'); await expect(r2).toHaveValue('line one');
  await r2.press('Control+Shift+z'); await expect(r2).toHaveValue('line one\nline two');
  await r2.press('Control+z'); await r2.press('Control+y'); await expect(r2).toHaveValue('line one\nline two');
  await r2.press('Alt+ArrowUp'); await expect(r2).toHaveValue('line two\nline one');
  await r2.press('Shift+Alt+ArrowDown'); await expect(r2).toHaveValue('line two\nline two\nline one');
  await r2.press('Control+z'); await r2.press('Control+z'); await expect(r2).toHaveValue('line one\nline two');
  await r2.press('Home'); await r2.press('Tab'); await expect(r2).toHaveValue('line one\n  line two');
  await r2.press('Shift+Tab'); await expect(r2).toHaveValue('line one\nline two');
  await page.getByRole('button', { name: 'Insert {{child}}' }).click();
  await expect(r2).toHaveValue('line one\n{{child}}line two');
  await r2.press('Control+z'); await expect(r2).toHaveValue('line one\nline two');
  await page.getByRole('tab', { name: /g2/ }).click();
  const g2 = page.getByLabel('g2 · Attach instructions');
  await g2.fill('Attach very tersely. Pass {{pass}}.');
  await page.getByRole('tab', { name: /r2/ }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('tab', { name: /g2/ })).toHaveAttribute('aria-selected', 'true');
  await expect(g2).toHaveValue('Attach tersely. Pass {{pass}} of {{passes}}.');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(g2).toHaveValue('Attach very tersely. Pass {{pass}}.');
  await g2.press('Escape'); await g2.press('Tab');
  await expect(g2).not.toBeFocused();
  // Selected text must stay readable: the textarea's selection sits over the highlighted mirror.
  await g2.focus(); await g2.press('Control+a');
  const selection = await g2.evaluate(element => getComputedStyle(element, '::selection').backgroundColor);
  assert.match(selection, /rgba?\(.*,\s*0?\.\d+\)|color\(srgb .* \/ 0?\.\d+\)|oklab\(.* \/ 0?\.\d+\)/, `selection must be translucent, got ${selection}`);
  await shot(page, '03a-selection');
  await g2.press('End');
  await shot(page, '03-shortcuts');
  await page.keyboard.press('Control+s');
  await expect(page.getByLabel('Prompt version')).toContainText('v2 (latest)');

  // Roll-up run: tick a child, then a parent, in the canvas tree.
  await page.getByRole('button', { name: 'Run…' }).click();
  const drawer = page.getByRole('dialog', { name: 'New run' });
  await drawer.getByRole('checkbox', { name: 'Default roll-up' }).check();
  await expect(drawer.getByText('Tick a child and a parent canvas in the tree.')).toBeVisible();
  const canvases = drawer.getByRole('tree', { name: 'Canvases' });
  await canvases.getByRole('checkbox', { name: /^Second view/ }).check();
  await canvases.getByRole('checkbox', { name: /^First view/ }).check();
  await expect(canvases.getByRole('checkbox', { name: /^Current saved canvas/ })).toBeDisabled();
  await drawer.getByRole('button', { name: '⇅ Swap child and parent' }).click();
  const slots = drawer.getByRole('region', { name: 'Prompt context' });
  await expect(slots.locator('.prompt-context-slot').first()).toContainText('First view');
  await drawer.getByLabel('Samples').fill('1');
  await expect(drawer.getByText('= 4 canvases')).toBeVisible();
  await shot(page, '04-roll-up-tree');
  await drawer.getByRole('button', { name: 'Start run' }).click();
  // Runs are tree nodes: prompt · sample groups hold the r2 and g2 outputs.
  const runRow = (name) => tree.locator('.evals-tree-row', { hasText: name });
  await expect(runRow('Run #1 ·')).toContainText('4/4', { timeout: 30000 });
  await tree.getByRole('button', { name: 'Expand Run #1 · Default roll-up v1, Terse roll-up v2' }).click();
  const stageLeaf = (group, stage) => tree.getByRole('treeitem').filter({ hasText: group }).last().getByRole('button', { name: stage, exact: true });
  await stageLeaf('Terse roll-up v2 · sample 1', 'g2').click();
  // The output includes collapsible generation details and native canvas tools.
  const output = page.getByRole('region', { name: 'Canvas Terse roll-up v2 · sample 1 · g2' });
  const node = output.locator('[data-native-node]').first();
  await expect(node).toBeVisible({ timeout: 15000 });
  await expect(output.getByRole('button', { name: 'Fit' })).toBeVisible();
  await shot(page, '05-output');
  // Panning survives page re-renders (here: ticking an output for comparison).
  const area = await output.boundingBox(), start = await node.boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height - 60);
  await page.mouse.down(); await page.mouse.move(area.x + area.width / 2 - 120, area.y + area.height - 20, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox()).x).toBeLessThan(start.x - 60);
  // Let the hand tool's inertial pan finish before measuring.
  let last = NaN, stable = 0;
  await expect.poll(async () => { const x = Math.round((await node.boundingBox()).x); stable = x === last ? stable + 1 : 0; last = x; return stable; }).toBeGreaterThanOrEqual(2);
  const panned = await node.boundingBox();
  await tree.getByRole('checkbox', { name: 'Select Terse roll-up v2 · sample 1 · r2 for comparison' }).check();
  await page.waitForTimeout(500);
  const after = await node.boundingBox();
  assert.ok(Math.abs(after.x - panned.x) < 2, `Re-rendering the page must not reset the camera (${start.x} → ${panned.x} → ${after.x})`);
  await nav.getByRole('region', { name: 'Compare selected outputs' }).getByRole('button', { name: 'Clear' }).click();

  // Alternatives run: tick an AgentContext (the roll-up run created one).
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const alt = page.getByRole('dialog', { name: 'New run' });
  await alt.getByText('Alternatives', { exact: true }).click();
  await alt.getByRole('checkbox', { name: 'Default alternative' }).check();
  await expect(alt.getByText('Tick an AgentContext in the tree.')).toBeVisible();
  await alt.getByLabel('Filter AgentContexts').fill('roll-up');
  await alt.getByRole('tree', { name: 'AgentContexts' }).getByRole('checkbox', { name: /^Roll-up: First view/ }).check();
  await alt.getByLabel('Samples').fill('2');
  await alt.getByRole('button', { name: 'Start run' }).click();
  await expect(runRow('Run #2 ·')).toContainText('2/2', { timeout: 30000 });

  // Earlier alternatives sit under their context; ticking one selects the context and attaches it.
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const next = page.getByRole('dialog', { name: 'New run' });
  await next.getByText('Alternatives', { exact: true }).click();
  const contexts = next.getByRole('tree', { name: 'AgentContexts' });
  await expect(contexts.getByRole('button', { name: 'Collapse Roll-up: First view' })).toBeVisible();
  await contexts.getByRole('button', { name: /Expand Run #2/ }).click();
  await contexts.getByRole('checkbox', { name: /^Default alternative v1 · sample 1/ }).check();
  await expect(contexts.getByRole('checkbox', { name: /^Roll-up: First view/ })).toBeChecked();
  await expect(next.getByRole('region', { name: 'Prompt context' })).toContainText('previous-1.json');
  await shot(page, '06-alternatives-tree');
  await page.keyboard.press('Escape');

  // Sidebar tree: date → workflow → AgentContext → run → outputs, collapsible and resizable.
  await expect(tree.locator(':scope > li > .evals-tree-row').first()).toContainText(/\d{4}-\d{2}-\d{2}/);
  const rollUps = tree.getByRole('treeitem', { name: /Roll-ups/ }).first();
  await expect(tree.getByRole('button', { name: /^Run #2 · Default alternative v1/ })).toBeVisible();
  await expect(stageLeaf('Default roll-up v1 · sample 1', 'r2')).toBeVisible();
  await tree.getByRole('button', { name: 'Collapse Roll-ups' }).click();
  await expect(tree.getByRole('button', { name: /^Run #1 ·/ })).toBeHidden();
  await tree.getByRole('button', { name: 'Expand Roll-ups' }).click();
  await stageLeaf('Default roll-up v1 · sample 1', 'r2').click();
  await expect(page.getByRole('region', { name: 'Canvas Default roll-up v1 · sample 1 · r2' })).toBeVisible();
  const divider = page.getByRole('separator', { name: 'Resize sidebar' });
  const before = (await nav.boundingBox()).width;
  await divider.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await nav.boundingBox()).width).toBeGreaterThan(before + 20);
  // Right-click an AgentContext to start a run from it.
  await tree.getByRole('button', { name: 'Roll-up: First view' }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New run from this context…' }).click();
  const fromContext = page.getByRole('dialog', { name: 'New run' });
  await expect(fromContext.getByRole('tree', { name: 'AgentContexts' }).getByRole('checkbox', { name: /^Roll-up: First view/ })).toBeChecked();
  await page.keyboard.press('Escape');
  // Right-click a run to edit one of its prompts, opened at the version the run used.
  await tree.getByRole('button', { name: /^Run #1 ·/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Edit prompt “Terse roll-up”/ }).click();
  await expect(page.getByLabel('Prompt name')).toHaveValue('Terse roll-up');
  await expect(page.getByLabel('Prompt version')).toHaveValue('2');
  await page.goBack();
  await shot(page, '06b-sidebar-tree');

  // Tick outputs in the tree to compare them side by side, with provenance and prompt diff.
  await tree.getByRole('checkbox', { name: 'Select Default roll-up v1 · sample 1 · g2 for comparison' }).check();
  await tree.getByRole('checkbox', { name: 'Select Terse roll-up v2 · sample 1 · g2 for comparison' }).check();
  await nav.getByRole('region', { name: 'Compare selected outputs' }).getByRole('button', { name: 'Side by side' }).click();
  await expect(page.getByRole('region', { name: 'Comparison pane A' }).locator('.compare-pane-heading strong')).toHaveText('Default roll-up v1 · sample 1 · g2');
  await expect(page.getByRole('region', { name: 'Comparison pane B' }).locator('.compare-pane-heading strong')).toHaveText('Terse roll-up v2 · sample 1 · g2');
  await shot(page, '07-compare');
  await page.getByRole('button', { name: 'Prompt diff A ↔ B' }).click();
  await expect(page.getByRole('dialog', { name: 'Prompt diff' }).locator('.is-added').first()).toBeVisible();
  await shot(page, '08-prompt-diff');
  await page.keyboard.press('Escape');

  // LLM comparison of two alternatives.
  await tree.getByRole('button', { name: 'Expand Run #2 · Default alternative v1' }).click();
  for (const pass of [1, 2]) await tree.getByRole('checkbox', { name: `Select Default alternative v1 · sample ${pass} for comparison` }).check();
  await nav.getByRole('region', { name: 'Compare selected outputs' }).getByRole('button', { name: 'LLM comparison' }).click();
  // One Judgements entry opens a pane directly under the evaluated run.
  const judgedRun = tree.getByRole('treeitem').filter({ has: page.getByRole('button', { name: /^Run #2 ·/ }) }).last();
  const llm = judgedRun.getByRole('button', { name: 'Judgements', exact: true });
  await llm.click();
  await expect(page.getByRole('region', { name: 'Comparison explanation' })).toBeVisible({ timeout: 30000 });
  await expect(judgedRun.getByRole('button', { name: 'Collapse Judgements', exact: true })).toBeVisible();
  await shot(page, '09-llm-compare');
  // Delete icons: an output, then a comparison.
  const deleteOutput = tree.getByRole('button', { name: 'Delete output Default alternative v1 · sample 2' });
  await deleteOutput.click();
  const confirmation = page.getByRole('dialog', { name: 'Delete output' });
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0); await expect(deleteOutput).toBeFocused();
  await expect(tree.getByRole('button', { name: 'Default alternative v1 · sample 2', exact: true })).toBeVisible();
  await deleteOutput.click();
  await shot(page, '09a-delete-modal');
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Default alternative v1 · sample 2', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete judgement', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(llm).toHaveCount(0);
  await expect(page.getByText('No judgements are attached.', { exact: true })).toBeVisible();

  // Rerun fills the launcher from the run and files the new run under it.
  await tree.getByRole('button', { name: /^Run #2 ·/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rerun…' }).click();
  const rerun = page.getByRole('dialog', { name: 'Rerun #2' });
  await expect(rerun.getByLabel('Task', { exact: true })).toHaveCount(0);
  await expect(rerun.getByLabel('Samples')).toHaveValue('2');
  await expect(rerun.getByRole('checkbox', { name: 'Default alternative', exact: true })).toBeChecked();
  await expect(rerun.getByRole('tree', { name: 'AgentContexts' }).getByRole('checkbox', { name: /^Roll-up: First view/ })).toBeChecked();
  await expect(rerun.getByRole('radio', { name: 'Roll-up' })).toBeDisabled();
  await shot(page, '09b-rerun');
  await rerun.getByLabel('Samples').fill('1');
  await rerun.getByRole('button', { name: 'Start rerun' }).click();
  const original = tree.getByRole('treeitem').filter({ has: page.getByRole('button', { name: /^Run #2 ·/ }) }).last();
  await expect(original.getByRole('button', { name: /^Rerun #3 · Default alternative v1/ })).toBeVisible();
  await expect(runRow('Rerun #3 ·')).toContainText('1/1', { timeout: 30000 });
  // Rename sets the run's label in the tree; an empty name restores the prompt names.
  await tree.getByRole('button', { name: /^Rerun #3 ·/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await tree.getByRole('textbox', { name: /^Rename Rerun #3/ }).fill('Layered retry');
  await page.keyboard.press('Enter');
  await expect(tree.getByRole('button', { name: 'Rerun #3 · Layered retry', exact: true })).toBeVisible();
  await tree.getByRole('button', { name: /^Rerun #3 ·/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.keyboard.press('Escape');
  await expect(tree.getByRole('button', { name: 'Rerun #3 · Layered retry', exact: true })).toBeVisible();

  // Cross-workflow prompt diffs include B's alternative stage and survive reload.
  await tree.getByRole('checkbox', { name: 'Select Default roll-up v1 · sample 1 · r2 for comparison' }).check();
  await tree.getByRole('checkbox', { name: 'Select Default alternative v1 · sample 1 for comparison' }).first().check();
  await nav.getByRole('region', { name: 'Compare selected outputs' }).getByRole('button', { name: 'Side by side' }).click();
  await page.getByRole('button', { name: 'Prompt diff A ↔ B' }).click();
  for (const stage of ['r2', 'g2', 'alternative']) await expect(page.getByRole('region', { name: `Stage ${stage} diff`, exact: true })).toBeVisible();
  await shot(page, '09c-cross-workflow-diff');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Prompt diff A ↔ B' }).click();
  await expect(page.getByRole('region', { name: 'Stage alternative diff', exact: true })).toContainText('Earlier alternatives');
  await page.keyboard.press('Escape');
  await expect(tree.getByRole('button', { name: 'Judgements', exact: true }).first()).toBeVisible();

  // References live behind the header button: capture selections from one diagram, then tick which to promote.
  assert.equal(await nav.getByRole('tab').count(), 0, 'The Experiments explorer has no tabs');
  await page.getByRole('button', { name: 'References', exact: true }).click();
  await nav.getByRole('tab', { name: /Canvas/ }).click();
  const diagrams = nav.getByRole('tree', { name: 'Diagrams' });
  await expect(diagrams.getByRole('button', { name: /^Expand/ }).first()).toBeVisible({ timeout: 15000 });
  for (let expand = diagrams.getByRole('button', { name: /^Expand/ }); await expand.count();) await expand.first().click();
  await diagrams.locator('[role=treeitem]:not([aria-expanded]) .evals-tree-label').first().click();
  // Only the chosen diagram is on the canvas.
  const grid = page.locator('.reference-canvas [data-grid-box]:not(.is-container)');
  await expect(grid).toHaveCount(1, { timeout: 15000 });
  const box = await grid.boundingBox(), columns = Number(await grid.getAttribute('data-grid-columns')), rows = Number(await grid.getAttribute('data-grid-rows'));
  const cell = (column, row) => ({ x: box.x + (column + .5) * box.width / columns, y: box.y + (row + .5) * box.height / rows });
  const from = cell(0, 0), to = cell(Math.min(columns - 1, 12), Math.min(rows - 1, 1));
  await page.keyboard.down('Control');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
  await page.keyboard.up('Control');
  await expect(page.getByLabel('Selection preview')).toBeVisible();
  const excerpt = await page.getByLabel('Selection preview').textContent();
  assert.ok(excerpt.trim().length > 0 && excerpt.split('\n').length <= 2, `excerpt: ${excerpt}`);
  await page.getByRole('button', { name: 'Capture selection' }).click();
  await expect(page.getByRole('button', { name: 'Already captured' })).toBeDisabled();
  await shot(page, '09c-new-reference');
  await page.getByRole('complementary', { name: 'Reference captures' }).getByLabel('Reference name').fill('Overview top');
  await page.getByLabel('Group for promoted references').selectOption({ label: 'New group…' });
  await page.getByLabel('New group name').fill('Top excerpts');
  await page.getByRole('button', { name: /^Promote 1 to reference$/ }).click();
  await page.getByRole('button', { name: 'Open Overview top' }).click();
  await expect(page.getByText('{{ref:overview-top}}').first()).toBeVisible();
  assert.equal(await page.getByLabel('Reference text').textContent(), excerpt);
  await expect(page.getByLabel('Reference group')).toHaveValue('top-excerpts');
  const library = nav.getByRole('tree', { name: 'References' });
  await expect(library.getByRole('treeitem', { name: /Top excerpts/ }).getByRole('button', { name: 'Overview top' })).toBeVisible();
  // Prompts cite it from the References picker; the preview shows the frozen text in place.
  await page.getByRole('button', { name: 'Prompts ▾' }).click();
  await page.getByRole('menuitem', { name: '+ New alternatives prompt' }).click();
  const instructions = page.getByLabel('Alternative instructions');
  await instructions.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nMatch this shape:\n');
  await page.getByRole('button', { name: 'Insert reference Overview top' }).click();
  await expect(instructions).toHaveValue(/Match this shape:\n\{\{ref:overview-top\}\}$/);
  await page.getByRole('button', { name: 'Show full prompt preview' }).click();
  await expect(page.getByLabel('Full prompt preview')).toContainText('Match this shape:\n```text\n' + excerpt.trimEnd() + '\n```');
  await instructions.press('End'); await page.keyboard.type(' {{ref:missing}}');
  await expect(page.locator('.prompt-issues')).toContainText('Unknown reference {{ref:missing}}');
  for (let i = 0; i < 16; i++) await page.keyboard.press('Backspace');
  await shot(page, '09d-prompt-reference');
  await page.getByRole('button', { name: 'Create prompt' }).click();
  await page.getByRole('button', { name: 'References', exact: true }).click();
  await nav.getByRole('button', { name: 'Overview top', exact: true }).click();
  await expect(page.locator('.reference-facts')).toContainText('New alternatives prompt');
  await nav.getByRole('button', { name: '← Experiments' }).click();

  // Manual comparisons can pick generated canvases; Mapping links to Evals.
  await page.getByRole('button', { name: 'New comparison', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New comparison' }).getByLabel('View A')).toContainText('Terse roll-up v2 · sample 1 · g2');
  await page.keyboard.press('Escape');
  await page.goto(url);
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await expect(page.getByRole('link', { name: /Generate and compare in Evals/ })).toBeVisible({ timeout: 15000 });
  await shot(page, '10-mapping-canvas-tab');
  await page.getByRole('list', { name: 'Recent generated canvases' }).getByRole('button', { name: /Default alternative v1 · sample 1/ }).first().click();
  await expect(page.locator('[data-native-node]').filter({ hasText: 'Overview' }).first()).toBeVisible();
  // Capture the currently rendered Mapping canvas, without sending its text or edges.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Save layout as template', exact: true }).click();
  const saveLayout = page.getByRole('dialog', { name: 'Save layout as template' });
  await expect(saveLayout.getByRole('img', { name: 'Empty layout template slots' })).toBeVisible();
  const slotCount = await saveLayout.locator('[data-layout-slot]').count();
  assert.equal(slotCount, 2);
  await saveLayout.getByLabel('Template name').fill('Reusable arrangement');
  await saveLayout.getByLabel('Slot 1 description').fill('System overview\nShow the main components.');
  await expect(saveLayout.getByLabel('Slot 2 description')).toHaveValue('');
  await shot(page, '11-template-save');
  await saveLayout.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(saveLayout).toHaveCount(0);
  expectedTemplateDialog = 'leave-mapping';
  await page.goto(`${url}/evals`);
  expectedTemplateDialog = undefined;
  await page.getByRole('button', { name: 'Layout templates', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Layout templates' });
  await expect(manager.getByRole('heading', { name: 'Reusable arrangement' })).toBeVisible();
  await expect(manager.locator('dd')).toHaveText(['System overview\nShow the main components.']);
  await manager.getByRole('button', { name: 'Edit descriptions', exact: true }).click();
  await expect(manager.getByLabel('Slot 1 description')).toHaveValue('System overview\nShow the main components.');
  await manager.getByLabel('Slot 1 description').fill('');
  await manager.getByLabel('Slot 2 description').fill('Request flow\nTrace a request through the system.');
  await manager.getByRole('button', { name: 'Save descriptions', exact: true }).click();
  await expect(manager.locator('dd')).toHaveText(['Request flow\nTrace a request through the system.']);
  await manager.getByRole('button', { name: 'Rename', exact: true }).click();
  await manager.getByLabel('New template name').fill('Saved arrangement');
  await manager.getByRole('button', { name: 'Save name' }).click();
  await expect(manager.getByRole('heading', { name: 'Saved arrangement' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const templateRun = page.getByRole('dialog', { name: 'New run' });
  await templateRun.getByText('Alternatives', { exact: true }).click();
  await templateRun.getByRole('checkbox', { name: 'Template alternative', exact: true }).check();
  await templateRun.getByRole('tree', { name: 'AgentContexts' }).getByRole('checkbox', { name: /^Roll-up: First view/ }).check();
  await templateRun.getByLabel('Samples').fill('2');
  await templateRun.getByRole('combobox', { name: 'Layout template', exact: true }).selectOption({ label: 'Saved arrangement' });
  await expect(templateRun.locator('[data-layout-slot]')).toHaveCount(slotCount);
  await expect(templateRun.locator('dd')).toHaveText(['Request flow\nTrace a request through the system.']);
  await shot(page, '12-template-launch');
  await templateRun.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(runRow('Run #4 ·')).toContainText('2/2', { timeout: 30000 });
  await tree.getByRole('button', { name: /^Run #4 ·/ }).click();
  await page.getByText(/^Layout template: Saved arrangement/).click();
  await expect(page.getByRole('img', { name: 'Generated layout positions' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Generated layout positions' }).locator('[data-layout-slot]')).toHaveCount(slotCount);
  await expect(page.getByRole('img', { name: 'Generated layout positions' }).locator('[data-moved="true"]')).toHaveCount(1);
  await shot(page, '13-template-result');
  await page.getByText(/^Layout template: Saved arrangement/).click();
  // Deleting the library template must not invalidate the pinned rerun.
  await page.getByRole('button', { name: 'Layout templates', exact: true }).click();
  expectedTemplateDialog = 'delete-template';
  await manager.getByRole('button', { name: 'Delete template', exact: true }).click();
  await expect(manager.getByText('No layout templates yet.')).toBeVisible();
  expectedTemplateDialog = undefined;
  await page.keyboard.press('Escape');
  await page.reload();
  await tree.getByRole('button', { name: /^Run #4 ·/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rerun…' }).click();
  const pinnedRerun = page.getByRole('dialog', { name: 'Rerun #4' });
  await expect(pinnedRerun.getByRole('combobox', { name: 'Layout template', exact: true }).locator('option:checked')).toContainText('Saved arrangement');
  await expect(pinnedRerun.locator('[data-layout-slot]')).toHaveCount(slotCount);
  await expect(pinnedRerun.locator('dd')).toHaveText(['Request flow\nTrace a request through the system.']);
  await pinnedRerun.getByLabel('Samples').fill('1');
  await pinnedRerun.getByRole('button', { name: 'Start rerun' }).click();
  await expect(runRow('Rerun #5 ·')).toContainText('1/1', { timeout: 30000 });
  await shot(page, '15-template-rerun');
  assert.deepEqual(errors, []);
  console.log('Evals: prompt editing and hotkeys, run inputs, roll-up and alternatives, comparisons, layout capture/rename/generation and pinned rerun after template deletion passed.');
} catch (error) {
  console.error(error); process.exitCode = 1;
  if (page) await shot(page, 'failure').catch(() => {});
} finally {
  await browser?.close();
  if (server) { const closed = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive: true, force: true });
}
