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

  const api = async (route, body) => { const res = await fetch(url + '/api/mapping/evals' + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const value = await res.json(); assert(res.ok, JSON.stringify(value)); return value; };
  const text = '<agent context>Read context.json.</agent context>\n<task>Split the diagram.</task>\n<diagram-style><diagram-guidelines></diagram-guidelines><references></references></diagram-style>\n<canvas-style><canvas-guidelines></canvas-guidelines><references></references></canvas-style>\n<output format>Return JSON.</output format>';
  const prompt = await api('/prompts', { requestId: crypto.randomUUID(), workflow: 'alternatives', name: 'Structured fixture', stages: { alternative: text } });
  await page.goto(`${url}/evals?prompt=${prompt.id}`);
  const area = page.getByLabel('Alternative instructions', { exact: true });
  await expect(area).toHaveValue(text);
  await expect(page.locator('.template-editor .prompt-tag').first()).toBeVisible();
  await area.fill(text + '\n<unsupported>bad</unsupported>');
  await expect(page.getByText('Unsupported tag <unsupported> in Canvas prompt structure.', { exact: true }).first()).toBeVisible({ timeout: 4500 });
  await expect(page.getByRole('button', { name: 'Save as v2' })).toBeDisabled();
  await area.fill(text);
  await expect(page.getByText('Unsupported tag <unsupported> in Canvas prompt structure.', { exact: true })).toHaveCount(0, { timeout: 4500 });
  await expect(page.getByRole('button', { name: 'Collapsible sections' })).toHaveCount(0);
  await area.fill(text.replace('Split the diagram.', 'Split into a connected canvas.'));
  await page.getByRole('button', { name: 'Show full prompt preview' }).click();
  await expect(page.getByLabel('Full prompt preview')).not.toContainText('diagram-style');
  await expect(page.getByLabel('Full prompt preview')).not.toContainText('canvas-style');
  await page.getByRole('button', { name: 'Save as v2' }).click();
  await expect(page.getByLabel('Prompt version')).toHaveValue('2');
  await page.reload(); await expect(area).toHaveValue(/Split into a connected canvas/);
  await page.getByRole('button', { name: 'Fork prompt' }).click();
  await page.getByLabel('Prompt name').fill('Forked fixture');
  await page.getByRole('button', { name: 'Create prompt', exact: true }).click();
  await expect(page.getByLabel('Prompt version')).toHaveValue('1');
  const fork = (await api('/prompts')).find(p => p.name === 'Forked fixture');
  assert.deepEqual(fork.versions[0].parents, [{ promptId: prompt.id, version: 2, relation: 'fork' }]);
  await page.getByRole('button', { name: 'Snapshot project prompts' }).click();
  await expect(page.getByRole('status')).toContainText('Project prompt snapshot saved');
  assert.equal((await api('/prompt-snapshots')).length, 1);
  await shot(page, 'prompt-base-editor');
  assert.deepEqual(errors, []);
  console.log('Prompt templates: delayed tag validation, highlighting, full-text editing, empty-section preview, save/reload, fork and project snapshot passed.');
} finally {
  await browser?.close(); if (server) { server.kill('SIGTERM'); await new Promise(resolve => { server.once('close', resolve); setTimeout(resolve, 5000).unref(); }); }
  await rm(root, { recursive: true, force: true });
}
