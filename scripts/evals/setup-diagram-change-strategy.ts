/** Prepare only: this script deliberately has no generation or judgement launch calls. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { diagramChangePromptTemplateBase } from '../../domain/mapping/evals/promptTemplateBase';
const base = process.env.EVALS_BASE_URL ?? 'http://127.0.0.1:5191';
const directory = 'artifacts/diagram-change-strategy-2026-11-05';
const api = async (route: string, body?: unknown) => {
  const response = await fetch(`${base}/api/mapping/evals${route}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json(); if (!response.ok) throw Error(JSON.stringify(result)); return result;
};
const save = (name: string, value: unknown) => writeFile(`${directory}/${name}`, JSON.stringify(value, null, 2) + '\n');
await mkdir(directory, { recursive: true });
const contexts = (await api('/contexts?query=ChangeSession%20v2')).items.sort((a: any, b: any) => a.name.localeCompare(b.name));
if (contexts.length !== 7 || contexts.some((c: any) => c.group !== 'ChangeSession evals v2 - 7 contexts')) throw Error('Expected the seven original ChangeSession v2 contexts.');
let ids: { experiment: string; prompt: string; runs: string[] };
try { ids = JSON.parse(await readFile(`${directory}/ids.json`, 'utf8')); }
catch { ids = { experiment: randomUUID(), prompt: randomUUID(), runs: contexts.map(() => randomUUID()) }; await save('ids.json', ids); }
const promptRequest = { requestId: ids.prompt, workflow: 'diagram-change-proposal', name: 'Diagram change strategy · original rules · tree output',
  description: 'Baseline preserves the original four decision rules. Only the requested tree output and explicit pinned-input contract are adapted.',
  templateBase: diagramChangePromptTemplateBase, stages: { proposal: await readFile(`${directory}/prompt-v1.txt`, 'utf8') } };
const cases = contexts.map((c: any, i: number) => ({ id: `context-${i + 1}`, name: c.name, agentContextId: c.agentContextId, contentHash: c.contentHash }));
const experimentRequest = { requestId: ids.experiment, experiment: {
  name: 'Diagram change strategy selection',
  description: 'Baseline of the original four decision rules, using the seven ChangeSession v2 AgentContexts saved November 3, 2026. Three independent samples per case (21 total), gpt-6-sol/high. Output: the Proposed diagram changes ASCII tree only. Decision thresholds are unchanged; input access is adapted to pinned snapshots and the output contract is explicit. Deterministic syntax and strategy-count assessment is separate from generation; no architectural quality score or target strategy frequency.',
  phases: [{ id: 'baseline', name: 'Baseline', description: 'Original decision rules; tree-only output. Seven pinned contexts × three samples. Generation awaits review. The deterministic judgement is planned and must be run separately after generation; it parses tags and reports format errors without repairing outputs.' }],
  workflow: { id: 'diagram-change-proposal', name: 'Propose diagram changes', version: 1, stages: [{ id: 'proposal', name: 'Proposed changes tree', dependsOn: [] }] },
  cases, conditions: [{ id: 'original', name: 'Original decision rules', description: 'No prompt-strengthening or strategy-frequency target. Same gpt-6-sol/high settings for every sample.' }],
  samples: cases.flatMap((c: any) => Array.from({ length: 3 }, (_, i) => ({ id: `${c.id}-sample-${i + 1}`, phaseId: 'baseline', caseId: c.id, conditionId: 'original', number: i + 1, attempt: 1, outputs: [] }))),
  comparisons: [{ id: 'baseline-tree-parse', phaseId: 'baseline', name: 'Strategy selection and tree syntax',
    description: 'Parser v1: validates the root, canvas labels, branch hierarchy and operation tags; counts [1a], [1b], [2], [3], [4] and output incidence for 3/4. Retains raw text and line-level errors, including recognized operations in invalid trees. Does not judge structural correctness, coverage, attachment validity or whether 3/4 should have been chosen.',
    conditionIds: ['original'], caseIds: cases.map((c: any) => c.id), judgementIds: [], evaluator: { kind: 'deterministic', parser: 'diagram-change-tree', version: 1 } }],
  plannedRuns: cases.map((c: any, index: number) => ({ request: { requestId: ids.runs[index], workflow: 'diagram-change-proposal', prompts: [{ promptId: ids.prompt, version: 1 }], inputs: { context: { agentContextId: c.agentContextId } }, passes: 3, model: 'gpt-6-sol', effort: 'high' },
    outputs: Array.from({ length: 3 }, (_, i) => ({ sampleId: `${c.id}-sample-${i + 1}`, stageId: 'proposal', cellKey: `${ids.prompt}:${i + 1}:proposal` })) }))
} };
await save('prompt-request.json', promptRequest); await save('experiment-request.json', experimentRequest); await save('input-contexts.json', contexts);
if (process.argv.includes('--apply')) {
  const beforeRuns = await api('/runs');
  const prompt = await api('/prompts', promptRequest); await save('prompt.json', prompt);
  const experiment = await api('/experiments', experimentRequest); await save('experiment.json', experiment);
  const afterRuns = await api('/runs');
  if (experiment.generationReview?.status !== 'awaiting-approval' || experiment.samples.some((s: any) => s.outputs.length) || experiment.comparisons.some((c: any) => c.judgementIds.length)) throw Error('Expected an unexecuted review plan.');
  if (afterRuns.some((r: any) => ids.runs.includes(r.id))) throw Error('A planned run was unexpectedly launched.');
  await save('review-receipt.json', { experimentId: experiment.id, url: `${base}/evals?experiment=${experiment.id}`, status: experiment.generationReview.status, outputsPlanned: experiment.samples.length,
    model: 'gpt-6-sol', effort: 'high', plannedRunIds: ids.runs, plannedRunsLaunched: 0, judgementsRun: 0, existingRunCountBefore: beforeRuns.length, existingRunCountAfter: afterRuns.length });
  console.log(`${base}/evals?experiment=${experiment.id} — awaiting review; 21 outputs planned; none launched.`);
} else console.log('Prepared request artifacts only. Use --apply to save the review plan; this never launches it.');
