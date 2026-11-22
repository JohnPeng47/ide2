import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiagramStore } from '../../../infrastructure/core/persistence/store';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { publishJson } from '../../../infrastructure/core/persistence/immutableRecords';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { EvalPromptService } from '../../../application/mapping/evals/evalPromptService';
import { historyPrompts } from './prompts';
import { historyBaseline, type CapturedHistoryCanvas } from '../../../application/mapping/history/historyBaseline';
import { WorkspaceRecordStore } from '../../../infrastructure/mapping/persistence/workspace/workspaceRecordStore';
import { canvasInput } from '../../../application/mapping/history/historyMaterializer';
import type { EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import { sha256 } from '../../../domain/core/sha256';

const root = process.cwd(), directory = path.resolve(process.argv[2] ?? 'artifacts/diagram-history-2026-11-10');
const base = '03f2168deba364103c2450ca9b8168cd1fc9ddc5', head = '81f05a2bf9efa2334985d2298dcbd7b044dc4c1e';
const store = new DiagramStore(root, process.env.NEW_DIAGRAMS_DIR ?? '.diagrams-local/canvas-domain-model');
const project = await store.loadProject(); if (!project) throw Error('No project');
await mkdir(directory, { recursive: true });
const configFile = path.join(directory, 'config.json');
try { const existing = JSON.parse(await readFile(configFile, 'utf8')); console.log(JSON.stringify({ alreadyPrepared: true, ...existing.experiments })); process.exit(0); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 150 * 1024 * 1024 });
const commits = git('rev-list', '--first-parent', '--reverse', `${base}..${head}`).trim().split('\n');
const captured = JSON.parse(await readFile('artifacts/changesession-agent-contexts-2026-11-03/inputs/canvases.json', 'utf8')) as CapturedHistoryCanvas[];
const workspace = await new WorkspaceRecordStore(store.storeRoot).load(project.id);
if (!workspace) throw Error('Saved workspace is unavailable');
const recovered = historyBaseline(captured, workspace.documents, 'history-baseline-v2');
const baselines = recovered.canvases;
await publishJson(path.join(directory, 'baseline-provenance.json'), recovered.provenance);
const timeline = new FileCanvasTimeline(store.storeRoot);
const contexts = new AgentContextLibrary(new FileAgentContextRepository(store.storeRoot));
const contextId = randomUUID();
const parent = { promptId: '6a9c0f27-0b23-422f-965d-cc8ca56212e3', version: 1 };
const prompts = new EvalPromptService(new JsonDirectoryStore<EvalPrompt>(store.storeRoot, 'eval-prompts'), store);
const previous = await prompts.read(parent.promptId), priorText = previous.versions.find(v => v.version === parent.version)!.stages.proposal;
const inputIndex = [];
const files: Record<string, unknown> = {};
for (const [i, commit] of commits.entries()) {
  const paths = git('diff-tree', '--no-commit-id', '--name-only', '-r', `${commit}^1`, commit).trim().split('\n').filter(p => /^(application|domain|infrastructure|src|scripts|tests)\//.test(p) && /\.(ts|tsx|js|mjs|py|md)$/.test(p));
  const name = `commit-${String(i + 1).padStart(3, '0')}.json`;
  const sources = Object.fromEntries(paths.flatMap(p => { try { return [[p, git('show', `${commit}:${p}`)]]; } catch { return []; } }));
  const diff = git('diff', '--no-ext-diff', '--unified=3', `${commit}^1`, commit, '--', ...paths.length ? paths : ['__no_source_files__']);
  const summary = git('show', '-s', '--format=%s', commit).trim();
  const value = { commit, parent: git('rev-parse', `${commit}^1`).trim(), summary, diff, sources };
  await publishJson(path.join(directory, name), value); files[name] = { sha256: sha256(JSON.stringify(value)), bytes: Buffer.byteLength(JSON.stringify(value)) };
  inputIndex.push({ commit, summary, file: name, changedPaths: paths });
}
const context = await contexts.create({ requestId: contextId, name: 'Pinned commit sequence', group: 'Diagram history experiments',
  description: 'Shared chronological evidence and archived diagram text for both history conditions.', context: JSON.stringify({ base, head, order: 'first-parent ancestry; merge diffs include merged code', commits: inputIndex,
    baseline: 'Verified saved canvas checkpoints match the archived diagram hashes and edge identities. Original positions and content-node connections are preserved identically for both conditions.', evidenceFiles: files }) });
await publishJson(path.join(directory, 'commits.json'), inputIndex);
await publishJson(path.join(directory, 'canvases.json'), canvasInput(baselines));
await publishJson(path.join(directory, 'baseline-evidence.json'), captured);
const basePaths = git('ls-tree', '-r', '--name-only', base, '--', 'domain', 'application', 'infrastructure', 'src').trim().split('\n').filter(p => /\.(ts|tsx)$/.test(p));
await publishJson(path.join(directory, 'base-sources.json'), { revision: base, sources: Object.fromEntries(basePaths.map(p => [p, git('show', `${base}:${p}`)])) });
const experiments: Record<string, any> = {};
const structureName = (mode: string) => mode === 'structure-first' ? 'History · structure first' : 'History · standard';
const replaces = process.argv[3] ? JSON.parse(await readFile(path.resolve(process.argv[3]), 'utf8')) : undefined;
const firstBatchCommits = replaces ? JSON.parse(await readFile(path.join(replaces.directory, 'structure-first', 'plan.json'), 'utf8')).batches[0].commits : commits.slice(0, 4);
await publishJson(path.join(directory, 'first-batch.json'), firstBatchCommits);
for (const mode of ['history', 'structure-first']) {
  const experimentId = randomUUID(), promptId = randomUUID();
  const prompt = await prompts.save({ requestId: promptId, workflow: 'diagram-history', name: structureName(mode),
    description: 'Full-sequence planning followed by serial execution; n=1 per step.', templateBase: { id: 'history', version: 1, name: 'Diagram history', tags: ['agent context','task','output format'].map(name => ({name,parent:null})) },
    stages: historyPrompts(priorText, mode === 'structure-first'), derivation: { parent, kind: 'variation', dimension: { id: 'history-structure-timing', name: 'Structure timing', value: mode } } });
  const refs = Object.values(baselines).map(c => ({ documentId: c.id, name: c.name, viewId: c.history.canvasViews!.activeViewId!, checkpointId: c.history.headId }));
  await timeline.append(experimentId, project.id, 0, { id: 'baseline', phase: 'baseline', title: 'Pinned starting diagrams', commits: [], agentContextId: context.agentContextId, planId: `${promptId}:1`, canvases: refs }, Object.fromEntries(Object.values(baselines).map(c => [c.id,c.history])));
  const setup = { id: experimentId, experimentId: replaces?.experiments[mode].id ?? experimentId, mode, promptId, promptVersion: 1, context, status: 'prepared' };
  experiments[mode] = setup; await publishJson(path.join(directory, `${mode}.json`), setup); await publishJson(path.join(directory, `${mode}-prompt.json`), prompt);
}
const config = { root, directory, storeRoot: store.storeRoot, projectId: project.id, base, head, commits: inputIndex, parent,
  baseline: Object.fromEntries(Object.entries(baselines).map(([key,c])=>[key,{id:c.id,name:c.name,diagramIds:c.diagramIds}])), context, experiments, model:'gpt-6-astra', effort:'high', passes:1,
  executionBatchLimit: 1, firstBatchCommits, baselineNote: 'Saved baseline geometry and connections preserved; all diagram hashes verified against the original experiment.' };
await publishJson(configFile, config); console.log(JSON.stringify({directory,commits:commits.length,canvases:captured.length,experiments}));
