// Build phase · prompt v5: v4 layout rules plus a jump budget (2–3 per canvas, ~20–25 total).
//   node --import tsx v5.ts design   save v4 and add 3 planned runs (zero model calls)
//   node --import tsx v5.ts launch   approve them
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaultPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
import { composePrompt, evalWorkflows } from '../../../domain/mapping/evals/evalWorkflows';
import { materializeLinkedCanvases } from '../../../application/mapping/evals/linkedCanvasesMaterializer';
const mode = process.argv[2]; assert(['design', 'launch'].includes(mode));
const d = import.meta.dirname, API = 'http://127.0.0.1:5191/api/mapping/evals';
const read = async (f: string) => JSON.parse(await readFile(path.join(d, f), 'utf8'));
const write = (f: string, x: unknown) => writeFile(path.join(d, f), JSON.stringify(x, null, 2) + '\n');
async function api(route: string, body?: unknown) {
  const r = await fetch(API + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(`${route} ${r.status} ${JSON.stringify(j)}`); return j;
}
const ids = await read('ids.json'), receipt = await read('prompt-receipt.json'), text = await readFile(path.join(d, 'prompt.txt'), 'utf8');
ids.jumps ??= { prompt: randomUUID(), design: randomUUID(), approval: randomUUID(), runs: [randomUUID(), randomUUID(), randomUUID()] }; await write('ids.json', ids);
const PROMPT = receipt.promptId, CONDITION = 'single-agent-jumps', cellKey = `${PROMPT}:1:linked`;
const experimentId = (await read('plan.json')).experimentId;

if (mode === 'design') {
  // Zero-call checks: the guidelines compose, and an edge-free 2D output materializes.
  const composed = composePrompt(evalWorkflows['linked-canvases'] as any, 'linked', text, {}, defaultPromptTemplateBase);
  for (const s of ['<canvas-guidelines>', 'No edges between diagrams', 'Periphery', 'Spacing.', '20–25 across the whole set', '60/40', '<output format>']) assert(composed.includes(s), 'missing ' + s);
  const probe = { explanation: 'probe', rootCanvas: 'a', canvases: ['a', 'b'].map(id => ({ kind: 'new', id, name: id, edges: [],
    diagrams: [{ id: 'center', ascii: 'Center\n|\n`-- part', position: { column: 20, row: 10 } }, { id: 'side', ascii: 'Side\n|\n`-- detail', position: { column: 0, row: 0 } }] })),
    jumps: [{ source: { canvas: 'a', diagram: 'center', line: 3, startColumn: 5, endColumn: 8 }, target: { canvas: 'b', diagram: 'center', line: 1 } }] };
  const { result } = materializeLinkedCanvases(probe, [], 'probe');
  assert.equal(result.canvases[0].proposed.document.edges.length, 0);
  const prompt = await api(`/prompts/${PROMPT}`);
  let latest = prompt.versions.at(-1);
  if (latest.stages.linked !== text) {
    assert.equal(latest.version, 4, 'Expected v4 as the parent');
    const saved = await api('/prompts', { requestId: ids.jumps.prompt, promptId: PROMPT, baseVersion: 4, workflow: 'linked-canvases', name: prompt.name, description: prompt.description,
      note: 'Jump budget: 2–3 jumps out of each canvas on average, about 20–25 in total; entrances first, then the most important cross-canvas relations; other cross-canvas links stay annotated lines.',
      templateBase: defaultPromptTemplateBase, derivation: { parent: { promptId: PROMPT, version: 4 }, kind: 'revision' }, stages: { linked: text } });
    latest = saved.versions.at(-1);
  }
  assert.equal(latest.version, 5); assert.equal(latest.stages.linked, text);
  await write('prompt-receipt.json', { ...receipt, version: 5, contentHash: latest.contentHash, history: [...(receipt.history ?? []).filter((h: any) => h.version !== 5), { version: 5, contentHash: latest.contentHash }] });
  const current = await api(`/experiments/${experimentId}`);
  if (current.conditions.some((c: any) => c.id === CONDITION)) { console.log('Variant already added'); process.exit(0); }
  const base = current.plannedRuns.find((p: any) => p.request.prompts[0].promptId === PROMPT).request;
  const samples = ids.jumps.runs.map((_: string, i: number) => ({ id: `ghostty-build-jumps-${i + 1}`, phaseId: 'build', caseId: 'ghostty-build', conditionId: CONDITION, number: i + 1, attempt: 1, outputs: [] }));
  const { id, projectId, revision, createdAt, updatedAt, lastRequest, approvalRequest, generationReview, startedRunIds, preparedRuns, schemaVersion, ...design } = current;
  const conditions = [...design.conditions.map((c: any) => c),
    { id: CONDITION, name: 'Single agent · jumps v5', description: 'Variant 1 with prompt v5: v4 layout rules plus a jump budget of 2–3 per canvas (about 20–25 total), entrances first. Same merged-plan input, gpt-6-astra/high.' }];
  const plannedRuns = [...design.plannedRuns, ...ids.jumps.runs.map((runId: string, i: number) => ({
    request: { ...base, requestId: runId, prompts: [{ promptId: PROMPT, version: 5 }] }, outputs: [{ sampleId: samples[i].id, stageId: 'build', cellKey }] }))];
  const r = await api('/experiments', { requestId: ids.jumps.design, experimentId: id, expectedRevision: revision,
    experiment: { ...design, conditions, samples: [...design.samples, ...samples], plannedRuns } });
  await write('plan-v5.json', { experimentId: r.id, revision: r.revision, review: r.generationReview?.status, runs: ids.jumps.runs });
  console.log(`Prompt v5 ${latest.contentHash.slice(0, 12)}; experiment rev ${r.revision}: ${r.generationReview?.status}; zero model calls.`);
}
if (mode === 'launch') {
  const plan = await read('plan-v5.json');
  const r = await api(`/experiments/${plan.experimentId}/approve`, { requestId: ids.jumps.approval, expectedRevision: plan.revision });
  console.log(`Approval: ${r.generationReview.status}; started ${(r.startedRunIds ?? []).filter((x: string) => ids.jumps.runs.includes(x)).length}/3 v5 runs.`);
}
