// Save prompt.txt as the next prompt version when it changed; re-pin the unlaunched build runs to it.
// v2: dropped the HierGraph-to-canvas mapping section. v3: added the diagram style guidance and few-shot references.
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaultPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
const d = import.meta.dirname, API = 'http://127.0.0.1:5191/api/mapping/evals';
const read = async (f: string) => JSON.parse(await readFile(path.join(d, f), 'utf8'));
const write = (f: string, x: unknown) => writeFile(path.join(d, f), JSON.stringify(x, null, 2) + '\n');
async function api(route: string, body?: unknown) {
  const r = await fetch(API + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw Error(`${route} ${r.status} ${JSON.stringify(j)}`); return j;
}
const ids = await read('ids.json'), receipt = await read('prompt-receipt.json'), text = await readFile(path.join(d, 'prompt.txt'), 'utf8');
const NOTES: Record<number, string> = {
  2: 'Removed the HierGraph-to-canvas mapping section; the output format alone governs canvas, edge and jump structure.',
  3: 'Added diagram style guidance (60/40 code refs to natural language, tree validation) and two synthetic few-shot style references.' };
const prompt = await api(`/prompts/${receipt.promptId}`);
let latest = prompt.versions.at(-1);
if (latest.stages.linked !== text) {
  const version = latest.version + 1;
  ids.versions ??= {}; ids.versions[version] ??= { prompt: randomUUID(), design: randomUUID(), runs: [randomUUID(), randomUUID(), randomUUID()] }; await write('ids.json', ids);
  const saved = await api('/prompts', { requestId: ids.versions[version].prompt, promptId: receipt.promptId, baseVersion: latest.version, workflow: 'linked-canvases', name: prompt.name, description: prompt.description,
    note: NOTES[version], templateBase: defaultPromptTemplateBase, derivation: { parent: { promptId: receipt.promptId, version: latest.version }, kind: 'revision' }, stages: { linked: text } });
  latest = saved.versions.at(-1); assert.equal(latest.version, version);
}
assert.equal(latest.stages.linked, text, 'Saved latest version differs from prompt.txt');
const target = latest.version, slot = ids.versions?.[target] ?? ids.v2;
await write('prompt-receipt.json', { promptId: receipt.promptId, version: target, contentHash: latest.contentHash,
  history: prompt.versions.map((v: any) => ({ version: v.version, contentHash: v.contentHash })).concat(prompt.versions.some((v: any) => v.version === target) ? [] : [{ version: target, contentHash: latest.contentHash }]) });
// Cell keys are promptId:pass:stage; the version lives in the request, not the key.
const cellKey = `${receipt.promptId}:1:linked`;
const current = await api(`/experiments/${(await read('plan.json')).experimentId}`);
assert.equal(current.generationReview?.status, 'awaiting-approval', 'Build runs are no longer awaiting approval');
const old = new Set(ids.runs as string[]);
assert(!old.has(slot.runs[0]), 'Planned runs already pinned to this version');
const plannedRuns = current.plannedRuns.filter((p: any) => !old.has(p.request.requestId)).concat(slot.runs.map((runId: string, i: number) => {
  const prev = current.plannedRuns.find((p: any) => p.request.requestId === ids.runs[i]);
  return { request: { ...prev.request, requestId: runId, prompts: [{ promptId: receipt.promptId, version: target }] }, outputs: prev.outputs.map((o: any) => ({ ...o, cellKey })) };
}));
const { id, projectId, revision, createdAt, updatedAt, lastRequest, approvalRequest, generationReview, startedRunIds, preparedRuns, schemaVersion, ...design } = current;
const conditions = design.conditions.map((c: any) => c.id === 'single-agent' ? { ...c, description: c.description.replace(/prompt v\d+/, `prompt v${target}`) } : c);
const r = await api('/experiments', { requestId: slot.design, experimentId: id, expectedRevision: revision, experiment: { ...design, conditions, plannedRuns } });
await write('plan.json', { experimentId: r.id, revision: r.revision, review: r.generationReview?.status, runs: r.generationReview?.runs?.map((x: { id: string }) => x.id) });
ids.runs = slot.runs; await write('ids.json', ids);
console.log(`Prompt v${target} ${latest.contentHash.slice(0, 12)}; experiment rev ${r.revision}: ${r.generationReview?.status}, runs ${r.generationReview?.runs?.map((x: any) => `${x.id.slice(0, 8)}@v${x.request.prompts[0].version}`).join(', ')}`);
