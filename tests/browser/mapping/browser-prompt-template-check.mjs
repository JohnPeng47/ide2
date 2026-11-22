// npm run build && node --import tsx tests/browser/mapping/browser-prompt-template-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'prompt-template-'));
let browser, server;
try {
  await seedMappingFixture(root, { ascii: 'Fixture', nodes: [] });
  const port = await new Promise(resolve => {
    const socket = createServer().listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  });
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_USAGE_DB: path.join(root, 'usage.sqlite') }, stdio: 'ignore' });
  await expect.poll(async () => (await fetch(base).catch(() => null))?.ok, { timeout: 30000 }).toBe(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/evals?new-prompt=alternatives');
  const id = 'prompt-snippets/canvas-style-guidance.txt', token = '{{template:' + id + '}}';
  const name = 'Browser template use';
  await page.getByRole('textbox', { name: 'Prompt name' }).fill(name);
  const area = page.getByLabel('Alternative instructions');
  const save = page.getByRole('button', { name: 'Create prompt', exact: true });
  await area.fill('{{template:prompt-snippets/missing.txt}}');
  await expect(page.getByText('Unknown prompt template "prompt-snippets/missing.txt".')).toBeVisible();
  await expect(save).toBeDisabled();
  await area.fill('Before\n\nAfter');
  await area.press('Home'); await area.press('ArrowLeft');
  await page.getByRole('button', { name: 'Insert snippet canvas-style-guidance' }).click();
  await expect(area).toHaveValue('Before\n' + token + '\nAfter');
  await page.getByRole('button', { name: 'Show full prompt preview' }).click();
  const guidance = await readFile(new URL('../../../public/' + id, import.meta.url), 'utf8');
  const expected = 'Before\n' + guidance + '\nAfter';
  assert.equal(await page.getByLabel('Full prompt preview').textContent(), expected);
  await save.click(); await expect(page).toHaveURL(/\?prompt=/);
  const promptId = new URL(page.url()).searchParams.get('prompt');
  const record = await (await fetch(base + '/api/mapping/evals/prompts/' + promptId)).json();
  assert.equal(record.versions[0].stages.alternative, expected);
  assert.equal(record.versions[0].templateSources.alternative, 'Before\n' + token + '\nAfter');
  await page.reload();
  await expect(area).toHaveValue('Before\n' + token + '\nAfter');
  await page.getByRole('button', { name: 'Prompts ▾' }).click();
  await page.getByRole('menuitem', { name: 'canvas-style-guidance', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'canvas-style-guidance' });
  await drawer.getByRole('link', { name: name + ' · v1 · alternative' }).click();
  await expect(drawer).toHaveCount(0); await expect(area).toHaveValue('Before\n' + token + '\nAfter');
  assert.deepEqual(errors, []);
  console.log('PASS: template insertion, unknown ID validation, expanded preview, saved version, reload, and usage navigation.');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
