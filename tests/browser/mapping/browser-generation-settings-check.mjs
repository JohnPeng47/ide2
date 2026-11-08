// Build first. Tests only a disposable project; never launches generation.
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
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary.ts';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository.ts';

const root = await mkdtemp(path.join(tmpdir(), 'generation-settings-browser-'));
let server, browser;
try {
  await seedMappingFixture(root, { ascii: 'Overview\n`-- Evidence', nodes: [] });
  const store = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(store, 'project.json'), 'utf8'));
  await new WorkspaceRecordStore(store).state(projectId, async () => compareWorkspaceFixture(projectId));
  const context = await new AgentContextLibrary(new FileAgentContextRepository(store)).create({ requestId: crypto.randomUUID(), name: 'Pinned canvas set', context: 'Overview and detail.' });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.resume(); server.stderr.resume();
  await expect.poll(async () => (await fetch(url).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  const api = async (route, body) => { const response = await fetch(url + '/api/mapping/evals' + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result; };
  const prompts = await api('/prompts'), prompt = prompts.find(p => p.id === 'builtin-linked-canvases');
  const runId = crypto.randomUUID();
  const experiment = await api('/experiments', { requestId: crypto.randomUUID(), experiment: {
    name: 'Review settings fixture', workflow: { id: 'linked', name: 'Linked set', version: 1, stages: [{ id: 'generate', name: 'Generate', dependsOn: [] }] },
    cases: [{ id: 'input', name: context.name, agentContextId: context.agentContextId, contentHash: context.contentHash }],
    conditions: [{ id: 'base', name: 'Default' }], samples: [{ id: 'sample', caseId: 'input', conditionId: 'base', number: 1, outputs: [] }], comparisons: [],
    plannedRuns: [{ request: { requestId: runId, workflow: 'linked-canvases', prompts: [{ promptId: prompt.id, version: 1 }], inputs: { context: { agentContextId: context.agentContextId } }, passes: 1, model: 'gpt-6-astra', effort: 'high' },
      outputs: [{ sampleId: 'sample', stageId: 'generate', cellKey: `${prompt.id}:1:linked` }] }]
  } });
  const runIdsBefore = (await api('/runs')).map(r => r.id);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [], launched = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (r.method() === 'POST' && (/\/approve$/.test(r.url()) || /\/evals\/runs$/.test(r.url()))) launched.push(r.url()); });
  await page.goto(`${url}/evals?experiment=${experiment.id}&view=overview`);
  const review = page.getByRole('region', { name: 'Generation review', exact: true });
  const settings = review.getByRole('group', { name: 'Generation settings for Pinned canvas set', exact: true });
  await expect(settings.getByLabel('Outputs', { exact: true })).toHaveValue('1');
  await expect(settings.getByLabel('Model', { exact: true }).locator('option')).toHaveText(['Astra · High', 'Sol 6.1 · High', 'Sol 6.1 · Low']);
  const approved = review.getByRole('checkbox', { name: 'I have reviewed these prompts and settings' });
  const launch = review.getByRole('button', { name: 'Approve and start generation' });
  await approved.check(); await expect(launch).toBeEnabled();
  await settings.getByLabel('Outputs', { exact: true }).fill('3');
  await settings.getByLabel('Model', { exact: true }).selectOption('sol-6-1-low');
  await expect(launch).toBeDisabled(); await expect(approved).not.toBeChecked();
  const approvalControls = review.getByRole('group', { name: 'Generation approval', exact: true });
  await approvalControls.scrollIntoViewIfNeeded();
  await expect(approvalControls).toContainText('Save them to enable the review checkbox');
  await expect(approved).toBeDisabled();
  await approvalControls.getByRole('button', { name: 'Save settings to continue', exact: true }).click();
  await expect(approved).toBeEnabled();
  await expect(approved).not.toBeChecked();
  await approved.check(); await expect(launch).toBeEnabled();
  await approved.uncheck();
  await expect(review.getByText('3 planned outputs', { exact: true })).toBeVisible();
  let saved = await api('/experiments/' + experiment.id);
  assert.equal(saved.generationReview.status, 'awaiting-approval');
  assert.equal(saved.samples.length, 3); assert.equal(saved.generationReview.runs[0].cells.length, 3);
  assert.equal(saved.plannedRuns[0].request.model, 'gpt-6.1-sol'); assert.equal(saved.plannedRuns[0].request.effort, 'low');
  assert.deepEqual(saved.plannedRuns[0].request.inputs, experiment.plannedRuns[0].request.inputs);
  assert.deepEqual(saved.plannedRuns[0].request.prompts, experiment.plannedRuns[0].request.prompts);
  await page.reload();
  await expect(settings.getByLabel('Outputs', { exact: true })).toHaveValue('3');
  await expect(settings.getByLabel('Model', { exact: true })).toHaveValue('sol-6-1-low');
  await settings.getByLabel('Outputs', { exact: true }).fill('0');
  await expect(settings.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
  await expect(approvalControls.getByRole('button', { name: 'Save settings to continue', exact: true })).toBeDisabled();
  await settings.getByRole('button', { name: 'Reset settings', exact: true }).click();
  await settings.getByLabel('Model', { exact: true }).selectOption('sol-6-1-high');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Save settings', exact: true })).toBeDisabled();
  await settings.getByLabel('Outputs', { exact: true }).fill('2');
  await settings.getByLabel('Model', { exact: true }).selectOption('astra-high');
  await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(review.getByText('2 planned outputs', { exact: true })).toBeVisible();
  saved = await api('/experiments/' + experiment.id);
  assert.equal(saved.samples.length, 2); assert.equal(saved.plannedRuns[0].request.model, 'gpt-6-astra');
  assert.equal(saved.plannedRuns[0].request.effort, 'high');
  assert.deepEqual((await api('/runs')).map(r => r.id), runIdsBefore);
  assert.deepEqual(launched, []); assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(root, 'review-settings.png') });
  // The same three presets are offered when creating a new run.
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New run' }).getByLabel('Model', { exact: true }).locator('option')).toHaveText(['Astra · High', 'Sol 6.1 · High', 'Sol 6.1 · Low']);
  console.log('PASS: increase/decrease outputs; all three presets; save/reload; invalid count; approval reset; pinned inputs and prompts preserved; no generation launched.');
} finally {
  await browser?.close();
  if (server) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await exited; }
  await rm(root, { recursive: true, force: true });
}
