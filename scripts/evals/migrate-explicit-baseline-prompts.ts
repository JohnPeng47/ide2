// node --import tsx scripts/evals/migrate-explicit-baseline-prompts.ts <store-root> <baseline-run-id> [--apply]
// Review first. A durable before/after plan makes an interrupted application safely repeatable.
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { explicitBaselineMigration } from '../../application/mapping/evals/explicitBaselineMigration';
import type { EvalRun } from '../../domain/mapping/evals/evalRun';
const [rootArg, baselineId] = process.argv.slice(2);
if (!rootArg || !/^[a-zA-Z0-9-]{1,81}$/.test(baselineId ?? '')) throw Error('Specify store root and baseline run ID.');
const root = path.resolve(rootArg), directory = path.join(root, 'eval-migrations', `explicit-prompts-${baselineId}`);
const planPath = path.join(directory, 'plan.json');
type Change = { file: string; before: string | null; after: string };
type Plan = { baselineId: string; promptId: string; createdAt: string; changes: Change[] };
const read = async (file: string) => readFile(path.join(root, file), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
let plan: Plan | undefined = await readFile(planPath, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return undefined; throw e; });
if (!plan) {
  const filenames = (await readdir(path.join(root, 'eval-runs'))).filter(name => name.endsWith('.json'));
  const originals = new Map(await Promise.all(filenames.map(async name => [name, (await read(`eval-runs/${name}`))!] as const)));
  const runs: EvalRun[] = [...originals.values()].map(text => JSON.parse(text));
  if (runs.some(run => ['queued', 'generating'].includes(run.status))) throw Error('Wait for active eval runs to finish before editing persistence.');
  const source = runs.find(run => run.id === baselineId); if (!source) throw Error('Baseline not found.');
  const catalogBefore = (await read('canvases/catalog.json'))!, createdAt = new Date().toISOString();
  const result = explicitBaselineMigration(source, runs, JSON.parse(catalogBefore), createdAt);
  const promptFile = `eval-prompts/${result.prompt.id}.json`;
  if (await read(promptFile)) throw Error('Destination prompt exists without a migration plan.');
  plan = { baselineId, promptId: result.prompt.id, createdAt, changes: [
    { file: promptFile, before: null, after: JSON.stringify(result.prompt) },
    ...result.runs.map(run => ({ file: `eval-runs/${run.id}.json`, before: originals.get(`${run.id}.json`)!, after: JSON.stringify(run) })),
    { file: 'canvases/catalog.json', before: catalogBefore, after: JSON.stringify(result.catalog) }
  ] };
}
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', promptId: plan.promptId, files: plan.changes.map(c => c.file), backup: planPath }));
if (process.argv.includes('--apply')) {
  // Check every file before any mutation. Existing after-values are completed steps from an earlier attempt.
  for (const change of plan.changes) { const actual = await read(change.file); if (actual !== change.before && actual !== change.after) throw Error(`Concurrent modification: ${change.file}`); }
  await mkdir(directory, { recursive: true });
  await writeFile(planPath, JSON.stringify(plan), { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  for (const change of plan.changes) {
    const actual = await read(change.file); if (actual === change.after) continue;
    if (actual !== change.before) throw Error(`Concurrent modification: ${change.file}`);
    const destination = path.join(root, change.file), temporary = destination + `.${randomUUID()}.tmp`;
    await writeFile(temporary, change.after, { mode: 0o600 }); await rename(temporary, destination);
  }
  console.log('Migration applied. Original records and the exact write plan are retained in the backup.');
}
