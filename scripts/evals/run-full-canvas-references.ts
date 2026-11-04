// One full canvas using the latest completed refinement's final five examples.
import { randomUUID } from 'node:crypto';
const base = (process.argv[2] ?? 'http://localhost:5191') + '/api/mapping/evals';
async function api(route: string, body?: unknown) {
  const response = await fetch(base + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await response.json(); if (!response.ok) throw Error(JSON.stringify(data)); return data;
}
const judgements = await api('/judgements');
const latest = judgements.filter((j: any) => j.kind === 'few-shot-progress' && j.status === 'finished').sort((a: any,b: any) => b.createdAt.localeCompare(a.createdAt))[0];
if (!latest) throw Error('No completed few-shot refinement.');
const report = await api(`/judgements/${latest.id}`);
const refs = report.data.rounds.at(-1).nextReferences.sort((a: any,b: any) => a.slot - b.slot);
if (refs.length !== 5 || refs.some((r: any) => !r.referenceId)) throw Error('Import the five latest references first.');
const baseline = await api('/runs/d574746f-91fc-4351-ab7f-f3bb4c292ff5');
// The run service validates and pins the saved template; the baseline also pins its geometry.
if (baseline.layoutTemplate.geometry.slots.length !== 7) throw Error('Expected the complete seven-slot canvas template.');
let body = baseline.prompts[0].stages.alternative
  .replace('This is a baseline generation with no few-shot examples.', 'Use the synthetic references below as structural guidance for the whole canvas. They are fictional examples, not codebase facts. Fill every titled slot and connect the diagrams with meaningful cross-diagram edges.')
  .replace(' This is independent pass {{pass}} of {{passes}}; explore a distinct direction.', '');
body += '\n\nSynthetic subtree references:\n{{references}}';
const prompt = await api('/prompts', { requestId: randomUUID(), workflow: 'alternatives', name: 'Canvas-domain · full canvas · latest five references', stages: { alternative: body } });
const request = { requestId: randomUUID(), workflow: 'alternatives', prompts: [{ promptId: prompt.id, version: prompt.versions.at(-1).version }], inputs: baseline.request.inputs,
  layoutTemplateId: baseline.request.layoutTemplateId, referenceIds: refs.map((r: any) => r.referenceId), passes: 1, model: 'gpt-6-astra', effort: 'high' };
const run = await api('/runs', request);
console.log(JSON.stringify({ runId: run.id, number: run.number, promptId: prompt.id, referenceIds: request.referenceIds, slots: 7, status: run.status }));
