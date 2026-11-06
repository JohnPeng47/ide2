// Production UI, disposable storage and deterministic fake runtime only.
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
const root = await mkdtemp(path.join(tmpdir(), 'experiment-phases-browser-'));
let server, browser;
try {
  await seedMappingFixture(root, { ascii: 'Domain\n`-- Shared feature', nodes: [] });
  const store = path.join(root, '.diagrams');
  const context = await new AgentContextLibrary(new FileAgentContextRepository(store)).create({ requestId: crypto.randomUUID(), name: 'Phase fixture context', context: 'Before local saves. After persistence service.' });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`, e = '/api/mapping/evals';
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
  await expect.poll(async () => (await fetch(base).catch(() => null))?.status, { timeout: 30000 }).toBe(200);
  const api = async (route, body) => { const res = await fetch(base + e + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); const value = await res.json(); assert(res.ok, JSON.stringify(value)); return value; };
  const prompt = await api('/prompts', { requestId: crypto.randomUUID(), workflow: 'diagram-change-proposal', name: 'Fixture tree prompt', stages: { proposal: 'Read context.json. Return {tree}, the Proposed diagram changes ASCII summary.' } });
  const phases = ['baseline', 'revision'].map(id => ({ id, name: id === 'baseline' ? 'Baseline' : 'Revision', description: 'Reviewable output round.' }));
  const samples = phases.map(p => ({ id: p.id, phaseId: p.id, caseId: 'input', conditionId: 'original', number: 1, outputs: [] }));
  const experiment = await api('/experiments', { requestId: crypto.randomUUID(), experiment: {
    name: 'Phase review fixture', phases, workflow: { id: 'diagram-change-proposal', name: 'Proposal tree', version: 1, stages: [{ id: 'proposal', name: 'Tree', dependsOn: [] }] },
    cases: [{ id: 'input', name: context.name, agentContextId: context.agentContextId, contentHash: context.contentHash }], conditions: [{ id: 'original', name: 'Original' }], samples,
    comparisons: phases.map(p => ({ id: `${p.id}-parse`, phaseId: p.id, name: 'Tree syntax', caseIds: ['input'], conditionIds: ['original'], judgementIds: [], evaluator: { kind: 'deterministic', parser: 'diagram-change-tree', version: 1 } })),
    plannedRuns: samples.map(sample => ({ request: { requestId: crypto.randomUUID(), workflow: 'diagram-change-proposal', prompts: [{ promptId: prompt.id, version: 1 }], inputs: { context: { agentContextId: context.agentContextId } }, passes: 1, model: 'test', effort: 'high' }, outputs: [{ sampleId: sample.id, stageId: 'proposal', cellKey: `${prompt.id}:1:proposal` }] }))
  } });
  assert.equal(experiment.generationReview.status, 'awaiting-approval'); assert.equal((await api('/runs')).length, 0); assert.equal((await api('/judgements')).length, 0);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/evals?experiment=${experiment.id}`);
  const phaseSection = page.getByRole('region', { name: 'Phases', exact: true });
  await expect(phaseSection.getByRole('heading', { name: 'Phase 1 · Baseline' })).toBeVisible();
  await expect(phaseSection.getByRole('heading', { name: 'Phase 2 · Revision' })).toBeVisible();
  const review = page.getByRole('region', { name: 'Generation review' });
  await expect(review).toContainText('Generation has not started.');
  await expect(review.locator('.experiment-prompt-source')).toHaveCount(1);
  await expect(review).toContainText('2 planned outputs');
  await expect(review).toContainText('Shared by 2 input runs');
  await expect(review.getByRole('table', { name: 'Planned generation inputs' })).toBeHidden();
  await review.locator('.generation-review-inputs > summary').click();
  await expect(review.getByRole('table', { name: 'Planned generation inputs' }).getByRole('row')).toHaveCount(3);
  await review.locator('.generation-review-inputs > summary').click();
  await review.getByRole('button', { name: 'Edit section', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit proposal section' });
  const revisedText = prompt.versions[0].stages.proposal + '\nKeep the summary concise.';
  await modal.getByRole('textbox', { name: 'proposal section', exact: true }).fill(revisedText);
  await modal.getByRole('button', { name: 'Save section', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(review.getByLabel('proposal pinned prompt')).toHaveValue(revisedText);
  const edited = await api('/experiments/' + experiment.id);
  assert(edited.plannedRuns.every(plan => plan.request.prompts[0].version === 2));
  assert.equal(edited.generationReview.status, 'awaiting-approval');
  assert.equal((await api('/runs')).length, 0);
  await page.reload();
  await expect(review.locator('.experiment-prompt-source')).toHaveCount(1);
  await expect(review.getByLabel('proposal pinned prompt')).toHaveValue(revisedText);

  await expect(review.getByRole('button', { name: 'Approve and start generation' })).toBeDisabled();
  for (const button of await phaseSection.getByRole('button', { name: 'Run deterministic judgement' }).all()) await expect(button).toBeDisabled();
  await page.screenshot({ path: path.join(root, 'phase-overview.png'), fullPage: true });
  await phaseSection.getByRole('button', { name: 'View Revision outputs' }).click();
  await expect(page.getByRole('table', { name: 'Workflow outputs' }).getByRole('row')).toHaveCount(2);
  await expect(page).toHaveURL(/phase=revision/);
  await page.reload(); await expect(page.getByLabel('Output phase')).toHaveValue('revision');
  await page.locator('.experiment-explorer').getByRole('button', { name: 'Overview', exact: true }).click();
  // Only this disposable fixture is launched, through public controls.
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: 'Approve and start generation' }).click();
  await expect.poll(async () => (await api('/runs')).filter(r => r.status === 'finished').length, { timeout: 30000 }).toBe(2);
  const baseline = page.getByRole('region', { name: 'Phase 1: Baseline', exact: true });
  const revision = page.getByRole('region', { name: 'Phase 2: Revision', exact: true });
  await expect(baseline.getByRole('button', { name: 'Run deterministic judgement' })).toBeEnabled();
  await baseline.getByRole('button', { name: 'Run deterministic judgement' }).click();
  await expect(baseline.getByRole('button', { name: /Open report/ })).toBeVisible();
  await expect(revision).toContainText('Planned · not run');
  const saved = await api('/experiments/' + experiment.id);
  assert.equal(saved.comparisons[0].judgementIds.length, 1); assert.equal(saved.comparisons[1].judgementIds.length, 0);
  const report = await api('/judgements/' + saved.comparisons[0].judgementIds[0]);
  assert.equal(report.subjects.length, 1); assert.equal(report.data.validOutputs, 1); assert.equal(report.data.totals['1b'], 1);
  await baseline.getByRole('button', { name: /Open report/ }).click();
  await expect(page.getByRole('heading', { name: 'Diagram change tree · deterministic parse v1' })).toBeVisible();
  await expect(page.locator('.diagram-change-judgement')).toContainText('1 / 1 outputs have valid tree syntax.');
  await page.reload(); await expect(page.locator('.diagram-change-judgement')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS: review starts no jobs; phases render and survive reload; fixture approval generates; deterministic judgement remains scoped to Baseline and retains raw evidence.');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
