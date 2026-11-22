// npm run build && node --import tsx tests/browser/mapping/browser-experiment-prompt-rerun-check.mjs
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary.ts';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository.ts';

const root = await mkdtemp(path.join(tmpdir(), 'experiment-prompt-rerun-'));
let server, browser;
try {
  await seedMappingFixture(root, { ascii: 'Source', nodes: [] });
  const store = path.join(root, '.diagrams');
  const context = await new AgentContextLibrary(new FileAgentContextRepository(store)).create({
    requestId: crypto.randomUUID(), name: 'Source', context: 'A domain and storage service.'
  });
  const port = await new Promise(resolve => {
    const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const { port } = socket.address(); socket.close(() => resolve(port)); });
  });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_USAGE_DB: path.join(root, 'usage.sqlite') }, stdio: 'ignore' });
  await expect.poll(async () => (await fetch(base).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  const api = async (url, body) => {
    const response = await fetch(base + '/api/mapping/evals' + url, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  const templateId = 'prompt-snippets/canvas-style-guidance.txt';
  const token = '{{template:' + templateId + '}}';
  const guidance = await (await fetch(base + '/' + templateId)).text();
  const original = 'Read context.json. Generate ASCII trees with the supplied JSON output schema.\n' + token;
  const expanded = original.replace(token, guidance);
  const prompt = await api('/prompts', { requestId: crypto.randomUUID(), workflow: 'alternatives', name: 'Generate', stages: { alternative: original } });
  const control = await api('/prompts', { requestId: crypto.randomUUID(), workflow: 'alternatives', name: 'Control', stages: { alternative: expanded } });
  const run = await api('/runs', { requestId: crypto.randomUUID(), workflow: 'alternatives', inputs: { context: { agentContextId: context.agentContextId } },
    prompts: [{ promptId: prompt.id, version: 1 }, { promptId: control.id, version: 1 }], passes: 2, model: 'test-model', effort: 'high' });
  await expect.poll(async () => (await api('/runs/' + run.id)).status, { timeout: 30000 }).toBe('finished');
  const experiment = await api('/experiments', { requestId: crypto.randomUUID(), experiment: {
    name: 'Prompt edits', workflow: { id: 'test', name: 'Test', version: 1, stages: [{ id: 'generate', name: 'Generate' }] },
    cases: [{ id: 'source', name: 'Source', agentContextId: context.agentContextId }], conditions: [{ id: 'baseline', name: 'Baseline' }, { id: 'control', name: 'Control' }],
    comparisons: [], samples: run.cells.map(cell => ({ id: cell.promptId + '-' + cell.pass, caseId: 'source', conditionId: cell.promptId === prompt.id ? 'baseline' : 'control', number: cell.pass,
      outputs: [{ stageId: 'generate', runId: run.id, cellKey: cell.key }] }))
  } });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromium.executablePath(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(`${base}/evals?experiment=${experiment.id}`);
  const variants = page.locator('[data-node-id="phase/generate/variants"] > ul');
  const baseline = variants.locator(':scope > li').first();
  const tag = `.prompt-template-tag[title="${templateId}"]`;
  await expect(baseline.locator(':scope > .experiment-ascii-row').locator(tag)).toHaveText('canvas-style-guidance');
  await expect(variants.locator(':scope > li').nth(1).locator(tag)).toHaveCount(0);
  await page.getByRole('button', { name: 'Prompt ancestry' }).click();
  const ancestry = page.getByRole('region', { name: 'Generation prompts' });
  await expect(ancestry.locator(tag)).toHaveCount(1);
  await ancestry.getByRole('button', { name: 'Open Baseline prompt' }).click();
  const ancestor = page.getByRole('dialog', { name: 'Baseline prompt' });
  await expect(ancestor.getByLabel('alternative pinned prompt').locator(tag)).toHaveText('canvas-style-guidance');
  await expect(ancestor).not.toContainText('minimize the edge');
  await ancestor.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('navigation', { name: 'Experiment views' }).getByRole('button', { name: 'Overview' }).click();
  const save = async text => {
    await baseline.getByRole('button', { name: '[prompt]', exact: true }).first().click();
    const raw = page.getByLabel('Raw prompt text');
    await expect(raw.locator(tag)).toHaveText('canvas-style-guidance');
    await expect(raw).toHaveText(original.replace(token, 'canvas-style-guidance'));
    await page.getByRole('button', { name: 'Edit prompt' }).click();
    await expect(page.getByRole('textbox', { name: 'Prompt text' })).toHaveValue(original);
    await page.getByRole('textbox', { name: 'Prompt text' }).fill(text);
    await page.getByRole('button', { name: 'Save prompt' }).click();
    return page.getByRole('dialog', { name: 'Prompt saved' });
  };
  const first = await save(original + '\nShow the inputs.');
  await first.getByRole('button', { name: 'Not now' }).click();
  assert.equal((await api('/runs')).length, 1);
  assert.ok((await api('/prompts')).some(p => p.versions[0].stages.alternative === expanded + '\nShow the inputs.'));
  await page.reload();
  const edited = original + '\nShow ownership.';
  const confirmation = await save(edited);
  await expect(confirmation).toContainText('test-model / high · n=2');
  const savedId = new URL(await confirmation.getByRole('link').getAttribute('href'), base).searchParams.get('prompt');
  await confirmation.getByRole('button', { name: 'Rerun', exact: true }).click();
  const branch = variants.locator(':scope > li').filter({ has: page.getByText(/^\[RERUN\] Baseline/) });
  await expect(branch).toContainText('2/2 outputs', { timeout: 30000 });
  await page.reload();
  await expect(branch).toContainText('2/2 outputs');
  await branch.getByRole('button', { name: /Expand .*\/outputs$/ }).click();
  await expect(branch.getByRole('button', { name: '[output]', exact: true })).toHaveCount(2);
  await branch.getByRole('button', { name: '[prompt]', exact: true }).first().click();
  await expect(page.getByLabel('Raw prompt text')).toHaveText(edited.replace(token, 'canvas-style-guidance'));
  const updated = await api('/experiments/' + experiment.id);
  assert.deepEqual(updated.samples.slice(0, 4), experiment.samples);
  const rerun = await api('/runs/' + updated.samples[4].outputs[0].runId);
  assert.deepEqual(rerun.request, { ...run.request, requestId: rerun.id, parentRunId: run.id, prompts: [{ promptId: savedId, version: 1 }, { promptId: control.id, version: 1 }] });
  assert.equal(updated.samples.length, 8);
  assert.equal(rerun.prompts[1].stages.alternative, expanded);
  assert.equal(rerun.prompts[0].templateSources.alternative, edited);
  assert.equal(rerun.prompts[0].stages.alternative, edited.replace(token, guidance));
  console.log('Verified save-only, confirmed two-pass rerun, pinned prompt, output links and persistence after reload.');
} finally {
  await browser?.close(); server?.kill(); await rm(root, { recursive: true, force: true });
}
