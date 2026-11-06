/** Prepare Phase 2 for review. This script never launches generation or judgement. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { diagramChangePromptTemplateBase } from '../../domain/mapping/evals/promptTemplateBase';
import { composePrompt, evalWorkflows } from '../../domain/mapping/evals/evalWorkflows';
import { experimentDesignSchema } from '../../domain/mapping/evals/experiment';

const base = process.env.EVALS_BASE_URL ?? 'http://127.0.0.1:5191';
const directory = 'artifacts/diagram-change-strategy-2026-11-05/phase-2';
const experimentId = 'f1ee9846-f13d-448d-9628-99e7c3bd6d1a';
const parent = { promptId: '8bff8fea-3f1e-4c54-bebe-e82a0adf2de8', version: 3 };
const phaseId = 'phase-2';
const conditionId = 'revised-strategy';
const parseId = 'phase-2-tree-parse';
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = async (name: string, value: unknown) => writeFile(`${directory}/${name}`, JSON.stringify(value, null, 2) + '\n');
const api = async (route: string, body?: unknown) => {
  const response = await fetch(`${base}/api/mapping/evals${route}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Error(`${route}: ${JSON.stringify(result)}`);
  return result;
};
const unchanged = (before: unknown, after: unknown, label: string) => {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error(`${label} changed`);
};

await mkdir(directory, { recursive: true });
const current = await api(`/experiments/${experimentId}`);
const originalCases = current.cases.filter((c: any) => /^context-[1-7]$/.test(c.id));
if (originalCases.length !== 7 || current.phases?.[0]?.id !== 'baseline') throw Error('Expected the seven original baseline cases.');
const contexts = (await Promise.all(['context-results-01-03.json', 'context-results-04-07.json']
  .map(file => json(`${directory}/${file}`)))).flat();
if (contexts.length !== 7) throw Error('Expected seven derived AgentContexts.');
const byOriginal = new Map(contexts.map((c: any) => [c.originalAgentContextId, c]));
if (byOriginal.size !== 7) throw Error('Derived contexts must have distinct original AgentContexts.');
for (const original of originalCases) {
  const c: any = byOriginal.get(original.agentContextId);
  if (!c || c.originalContentHash !== original.contentHash || !c.agentContextId || !c.contentHash
    || c.agentContextId === original.agentContextId || c.contentHash === original.contentHash)
    throw Error(`Derived context does not match pinned original ${original.id}.`);
  if ((c.sourceReferenceCount ?? 0) < 1 || (c.canvasCount ?? 0) < 1
    || (c.diagramCount ?? c.canvasDiagramCount ?? 0) < 1)
    throw Error(`Derived context lacks source or captured diagram evidence for ${original.id}.`);
}
const text = await readFile(`${directory}/prompt.txt`, 'utf8');
if (!text.includes('[STEPS]') || !text.includes('[EXTRA-GUIDANCE]') || !text.includes('[OUTPUT]'))
  throw Error('Approved prompt is missing its visible template sections.');
if (composePrompt(evalWorkflows['diagram-change-proposal'], 'proposal', text, {}, diagramChangePromptTemplateBase) !== text)
  throw Error('Template composition changed the approved prompt.');
const sourcePrompt = await api(`/prompts/${parent.promptId}`);
if (!sourcePrompt.versions.some((v: any) => v.version === parent.version)) throw Error('Baseline prompt v3 is unavailable.');

let ids: { prompt: string; update: string; runs: string[] };
try { ids = await json(`${directory}/ids.json`); }
catch {
  ids = { prompt: randomUUID(), update: randomUUID(), runs: originalCases.map(() => randomUUID()) };
  await save('ids.json', ids);
}
if (ids.runs.length !== 7 || new Set([ids.prompt, ids.update, ...ids.runs]).size !== 9) throw Error('Invalid saved request IDs.');
const promptRequest = { requestId: ids.prompt, workflow: 'diagram-change-proposal',
  name: 'Diagram change strategy · revised rules · Phase 2',
  description: 'Visible Phase 2 strategy rules for seven derived ChangeSession contexts. Prompt and context both change from baseline.',
  note: 'Variation from the exact baseline v3. Separates patch/redraw from existing/new canvas and removes the rule to exhaust [1a]/[1b]/[2]/[3] before redraw.',
  templateBase: diagramChangePromptTemplateBase, stages: { proposal: text },
  derivation: { parent, kind: 'variation', dimension: { id: 'diagram-change-strategy-rules', name: 'Diagram change strategy rules', value: 'phase-2-revised' } } };
const newCases = originalCases.map((original: any) => {
  const c: any = byOriginal.get(original.agentContextId)!;
  return { id: `phase-2-${original.id}`, name: `${original.name} · revised context`, agentContextId: c.agentContextId, contentHash: c.contentHash };
});
const newSamples = newCases.flatMap((c: any) => Array.from({ length: 3 }, (_, i) => ({
  id: `${c.id}-sample-${i + 1}`, phaseId, caseId: c.id, conditionId, number: i + 1, attempt: 1, outputs: [] })));
const newPlans = newCases.map((c: any, index: number) => ({ request: { requestId: ids.runs[index], workflow: 'diagram-change-proposal',
  prompts: [{ promptId: ids.prompt, version: 1 }], inputs: { context: { agentContextId: c.agentContextId } },
  passes: 3, model: 'gpt-6-sol', effort: 'high', contextDelivery: 'session' },
  outputs: Array.from({ length: 3 }, (_, i) => ({ sampleId: `${c.id}-sample-${i + 1}`, stageId: 'proposal',
    cellKey: `${ids.prompt}:${i + 1}:proposal` })) }));
const phase = { id: phaseId, name: 'Phase 2 · revised strategy',
  description: 'Seven derived contexts × three independent samples, gpt-6-sol/high, session context delivery. The visible prompt first decides patch versus redraw for each existing diagram using cumulative changes, then decides existing versus new canvas for additional detail. The rule to exhaust [1a]/[1b]/[2]/[3] before redraw and historical N-detail diagram plans are removed. Prompt and input context both changed from baseline, so this comparison is descriptive rather than an isolated causal test. Generation and deterministic assessment require separate review.' };
const condition = { id: conditionId, name: 'Revised strategy and derived contexts',
  description: 'Prompt variation from baseline v3 and freshly derived AgentContexts. Historical diagram assignments and preselected detail-diagram plans are superseded by visible instructions. Model and sampling match baseline.' };
const comparison = { id: parseId, phaseId, name: 'Phase 2 strategy selection and tree syntax',
  description: 'Deterministic diagram-change-tree parser v1, scoped only to Phase 2 outputs. Validates tree syntax and counts [1a], [1b], [2], [3], [4]. Reports errors and raw operations without repairing outputs or judging architectural correctness.',
  conditionIds: [conditionId], caseIds: newCases.map((c: any) => c.id), judgementIds: [],
  evaluator: { kind: 'deterministic', parser: 'diagram-change-tree', version: 1 } };
const { id: _, projectId: __, schemaVersion: ___, revision: ____, createdAt: _____, updatedAt: ______,
  generationReview: _______, ...design } = current;
const already = design.phases?.some((p: any) => p.id === phaseId);
if (already) {
  unchanged(design.phases.find((p: any) => p.id === phaseId), phase, 'Phase 2 description');
  unchanged(design.conditions.find((c: any) => c.id === conditionId), condition, 'Phase 2 condition');
  unchanged(design.comparisons.find((c: any) => c.id === parseId), comparison, 'Phase 2 comparison');
  unchanged(design.cases.filter((c: any) => c.id.startsWith('phase-2-')), newCases, 'Phase 2 cases');
  unchanged(design.samples.filter((s: any) => s.phaseId === phaseId), newSamples, 'Phase 2 samples');
  unchanged(design.plannedRuns.filter((p: any) => ids.runs.includes(p.request.requestId)), newPlans, 'Phase 2 plans');
  const savedPrompt = await api(`/prompts/${ids.prompt}`);
  if (savedPrompt.versions[0]?.stages?.proposal !== text
    || JSON.stringify(savedPrompt.versions[0]?.derivation) !== JSON.stringify(promptRequest.derivation))
    throw Error('Saved Phase 2 prompt differs from approved text or lineage.');
  console.log(JSON.stringify({ mode: 'already-prepared', experimentId, revision: current.revision,
    status: current.generationReview?.status, plannedPhase2Outputs: 21 }));
} else {
  const next = { ...design,
    description: `${design.description}\n\nPhase 2 adds seven derived contexts and 21 planned outputs using revised visible strategy rules. It separates patch versus redraw decisions from existing versus new canvas decisions, judges cumulative changes per diagram, and removes the rule to exhaust [1a]/[1b]/[2]/[3] before redraw along with historical N-detail diagram plans. Both prompt and input changed, so phase comparisons describe observed outcomes rather than an isolated prompt effect.`,
    phases: [...design.phases, phase], cases: [...design.cases, ...newCases],
    conditions: [...design.conditions, condition], samples: [...design.samples, ...newSamples],
    comparisons: [...design.comparisons, comparison], plannedRuns: [...design.plannedRuns, ...newPlans] };
  experimentDesignSchema.parse(next);
  const request = { requestId: ids.update, experimentId, expectedRevision: current.revision, experiment: next };
  await save('prompt-request.json', promptRequest);
  await save('experiment-request.json', request);
  await save('context-mapping.json', originalCases.map((original: any, index: number) => ({
    originalCaseId: original.id, phase2CaseId: newCases[index].id, originalAgentContextId: original.agentContextId,
    originalContentHash: original.contentHash, phase2AgentContextId: newCases[index].agentContextId,
    phase2ContentHash: newCases[index].contentHash,
    sourceReferenceCount: (byOriginal.get(original.agentContextId) as any).sourceReferenceCount })));
  if (process.argv.includes('--apply')) {
    const beforeRuns = await api('/runs');
    const prompt = await api('/prompts', promptRequest);
    if (prompt.id !== ids.prompt || prompt.versions[0]?.stages?.proposal !== text
      || JSON.stringify(prompt.versions[0]?.derivation) !== JSON.stringify(promptRequest.derivation))
      throw Error('Saved prompt does not match approved text and lineage.');
    const saved = await api('/experiments', request);
    for (const field of ['workflow', 'promptTree'] as const) unchanged(design[field], saved[field], field);
    for (const field of ['phases', 'cases', 'conditions', 'samples', 'comparisons', 'plannedRuns'] as const)
      unchanged(design[field], saved[field].slice(0, design[field].length), `baseline ${field}`);
    if (saved.generationReview?.status !== 'awaiting-approval' || saved.generationReview.runs.length !== 7
      || saved.generationReview.runs.some((r: any) => !ids.runs.includes(r.id))
      || saved.samples.filter((s: any) => s.phaseId === phaseId).some((s: any) => s.outputs.length)
      || saved.comparisons.find((c: any) => c.id === parseId)?.judgementIds.length)
      throw Error('Expected only the 21 new outputs in review, with no Phase 2 execution.');
    const afterRuns = await api('/runs');
    if (afterRuns.length !== beforeRuns.length || afterRuns.some((r: any) => ids.runs.includes(r.id)))
      throw Error('A Phase 2 planned run was unexpectedly launched.');
    await save('prompt.json', prompt); await save('experiment.json', saved);
    await save('review-receipt.json', { experimentId, revision: saved.revision,
      url: `${base}/evals?experiment=${experimentId}&phase=${phaseId}`, status: saved.generationReview.status,
      promptId: ids.prompt, promptVersion: 1, promptParent: parent, contextDelivery: 'session',
      plannedPhase2Outputs: 21, pendingRunIds: ids.runs, newRunsLaunched: 0, phase2JudgementsRun: 0,
      baselineJudgementIds: design.comparisons.find((c: any) => c.id === 'baseline-tree-parse')?.judgementIds ?? [] });
    console.log(JSON.stringify({ mode: 'applied', experimentId, revision: saved.revision,
      status: saved.generationReview.status, plannedPhase2Outputs: 21, launched: 0 }));
  } else console.log(JSON.stringify({ mode: 'dry-run', experimentId, revision: current.revision,
    plannedPhase2Outputs: 21, promptId: ids.prompt, modelCalls: 0 }));
}
