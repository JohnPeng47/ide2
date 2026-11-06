import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { diagramChangePromptTemplateBase } from '../../domain/mapping/evals/promptTemplateBase';
import type { EvalPrompt } from '../../domain/mapping/evals/evalPrompt';
import type { EvalRun } from '../../domain/mapping/evals/evalRun';
import { DiagramStore } from '../../infrastructure/core/persistence/store';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { FileAgentContextSources } from '../../infrastructure/core/persistence/fileAgentContextSources';
import { FileCompareSessionStore } from '../../infrastructure/mapping/compare/fileCompareSessionStore';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { CompareSessionService } from '../../application/mapping/compare/compareSessionService';
import { GeneratedCanvasCatalog } from '../../application/mapping/evals/generatedCanvasCatalog';
import { EvalPromptService } from '../../application/mapping/evals/evalPromptService';
import { EvalRunService } from '../../application/mapping/evals/evalRunService';
import { ExperimentService, type StoredExperiment } from '../../application/mapping/evals/experimentService';
import { sha256 } from '../../domain/core/sha256';

// Offline review preparation: no server restart, model runtime, launch method, or judgement executor.
const directory = 'artifacts/diagram-change-strategy-2026-11-05';
const evidenceDirectory = 'artifacts/changesession-agent-contexts-v2-2026-11-03';
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const save = (name: string, value: unknown) => writeFile(`${directory}/${name}`, JSON.stringify(value, null, 2) + '\n');
const ids = await json(`${directory}/ids.json`);
const store = new DiagramStore(process.cwd(), process.env.NEW_DIAGRAMS_DIR ?? '.diagrams-local/canvas-domain-model');
const sources = new FileAgentContextSources(store.storeRoot, async id => ({ kind: 'git-worktree', root: await store.repositories.resolveCheckoutRoot(id) }));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(store.storeRoot), sources);
const experimentStore = new JsonDirectoryStore<StoredExperiment>(store.storeRoot, 'eval-experiments');
const current = await experimentStore.read(ids.experiment);
if (!current || current.generationReview?.status !== 'awaiting-approval' || current.startedRunIds?.length
  || current.samples.some(s => s.outputs.length) || current.comparisons.some(c => c.judgementIds.length))
  throw Error('Expected an entirely unlaunched experiment in review.');

const manifest = await json(`${evidenceDirectory}/manifest.json`);
const audit = [];
for (const input of current.cases) {
  const group = manifest.groups.find((group: any) => group.agentContextId === input.agentContextId);
  if (!group) throw Error('Input is not one of the original seven contexts');
  const saved = await contexts.read(input.agentContextId);
  if (saved.contentHash !== input.contentHash) throw Error('Input hash changed');
  const resolved = AgentContext.fromSnapshot(saved.resolvedSnapshot ?? saved.snapshot);
  resolved.toPiMessages(); // Reject unresolved references or an invalid conversation before approval.
  const blocks = saved.snapshot.messages.flatMap(m => m.content);
  const captures = blocks.flatMap(b => b.type === 'text' && b.text.startsWith('Captured baseline input, not an expected output:')
    ? [JSON.parse(b.text.slice(b.text.indexOf('{')))] : []);
  const diagrams = captures.flatMap(c => c.diagrams);
  for (const key of group.owned) if (!diagrams.some(d => d.key === key && sha256(d.ascii) === d.asciiSha256))
    throw Error(`Missing or changed owned diagram: ${key}`);
  const sourceManifest = await json(`${evidenceDirectory}/${group.key}/source-manifest.json`);
  const references = blocks.filter(b => b.type === 'sourceRange');
  for (const source of sourceManifest) if (!references.some(ref => ref.path === source.path && ref.startLine === source.startLine
    && ref.endLine === source.endLine && ref.version.kind === 'git' && ref.version.commit === source.revision))
    throw Error(`Missing pinned source: ${source.path}`);
  const delta = await json(`${evidenceDirectory}/${group.key}/code-delta.json`);
  const deltaBlock = blocks.find(b => b.type === 'text' && b.text.startsWith('Pinned net source-change evidence:'));
  const embeddedDelta = deltaBlock?.type === 'text' ? JSON.parse(deltaBlock.text.slice(deltaBlock.text.indexOf('{'))) : undefined;
  if (embeddedDelta?.head !== manifest.head || embeddedDelta?.comparisonBase !== manifest.comparisonBase
    || JSON.stringify(embeddedDelta?.deltas) !== JSON.stringify(delta))
    throw Error(`Missing code-change evidence for ${group.key}`);
  audit.push({ case: group.key, name: saved.name, agentContextId: input.agentContextId, originalHash: saved.contentHash,
    resolvedHash: resolved.contentHash, resolvedBytes: Buffer.byteLength(JSON.stringify(resolved.toSnapshot())),
    ownedDiagramsPresent: group.owned.length, capturedCanvases: captures.length, sourceReferencesResolved: references.length,
    changedFiles: delta.length, assignedFeatures: group.features });
}
await save('session-context-audit.json', { cases: audit, originalContextsUnchanged: true,
  scope: 'All declared source ranges, owned baseline diagrams, and scoped code-change evidence are present. This checks the supplied snapshot scope, not whole-repository completeness.',
  historicalInstructions: 'The new visible prompt supersedes historical category, ownership/output, and preselected-strategy constraints.' });

const unavailable = async (): Promise<never> => { throw Error('Review-only setup cannot execute, mutate runs, or read canvas state.'); };
const runStore = new JsonDirectoryStore<EvalRun>(store.storeRoot, 'eval-runs');
const beforeRuns = await runStore.list();
if (beforeRuns.some(run => ids.runs.includes(run.id))) throw Error('A planned run already exists');
const canvases = new GeneratedCanvasCatalog(store), workspace = { loadRecords: unavailable };
const comparisons = new CompareSessionService(workspace, new FileCompareSessionStore(store.storeRoot), canvases);
const prompts = new EvalPromptService(new JsonDirectoryStore<EvalPrompt>(store.storeRoot, 'eval-prompts'), store);
// Empty startup list avoids the normal run-recovery constructor changing other active jobs.
const runs = new EvalRunService(comparisons, workspace, store, contexts, prompts, canvases,
  { list: async () => [], read: id => runStore.read(id), save: unavailable, delete: unavailable }, { generate: unavailable });
const experiments = new ExperimentService(experimentStore, { read: unavailable, prepareForReview: request => runs.prepareForReview(request) }, store, contexts);
const source = await prompts.read(ids.prompt), text = await readFile(`${directory}/prompt-v3.txt`, 'utf8');
const existingVersion = source.versions.find(v => v.stages.proposal === text);
const promptRequest = { requestId: randomUUID(), promptId: source.id, baseVersion: source.versions.at(-1)!.version,
  workflow: source.workflow, name: source.name, description: source.description, templateBase: diagramChangePromptTemplateBase,
  stages: { proposal: text }, note: 'Prepared AgentContext history replaces per-sample context.json reads. Decision rules unchanged.' };
await save('session-prompt-request.json', promptRequest);
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ auditedContexts: audit.length, promptVersionPlanned: existingVersion?.version ?? promptRequest.baseVersion + 1,
    mode: 'dry-run', experimentUnchanged: true, modelCalls: 0 }));
} else {
  const prompt = existingVersion ? source : await prompts.save(promptRequest);
  const version = prompt.versions.find(v => v.stages.proposal === text)!.version;
  const publicExperiment = await experiments.read(current.id);
  const { id, projectId: _, schemaVersion: __, revision, createdAt: ___, updatedAt: ____, generationReview: _____, ...design } = publicExperiment;
  design.plannedRuns = design.plannedRuns!.map(plan => ({ ...plan, request: { ...plan.request, contextDelivery: 'session',
    prompts: plan.request.prompts.map(p => p.promptId === source.id ? { ...p, version } : p) } }));
  const request = { requestId: randomUUID(), experimentId: id, expectedRevision: revision, experiment: design };
  await save('session-experiment-request.json', request);
  const experiment = await experiments.save(request);
  if (JSON.stringify(await runStore.list()) !== JSON.stringify(beforeRuns)) throw Error('Unexpected run-store changes');
  await save('prompt.json', prompt); await save('experiment.json', experiment);
  await save('session-review-receipt.json', { experimentId: id, revision: experiment.revision, status: experiment.generationReview?.status,
    promptVersion: version, contextDelivery: 'session', model: 'gpt-6-sol', effort: 'high', plannedOutputs: experiment.samples.length,
    contextsAudited: audit.length, plannedRunsLaunched: 0, judgementsRun: 0, modelCalls: 0, serverReloaded: false });
  console.log(JSON.stringify({ experimentId: id, promptVersion: version, contextDelivery: 'session', status: experiment.generationReview?.status,
    plannedOutputs: experiment.samples.length, modelCalls: 0, serverReloaded: false }));
}
runs.dispose();
