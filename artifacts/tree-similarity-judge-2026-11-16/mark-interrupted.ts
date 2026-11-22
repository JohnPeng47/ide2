// Record judge calls interrupted when the runner was stopped (disk full). No model calls.
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(dir, '../..');
const config = JSON.parse(await readFile(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'), 'utf8'));
const runs = new JsonDirectoryStore<any>(config.storeRoot, 'eval-runs'), plan = JSON.parse(await readFile(path.join(dir, 'plan.json'), 'utf8'));
const has = async (f: string) => access(f).then(() => true, () => false);
const error = 'Interrupted: runner stopped when the disk filled during parallel checkouts; the model session started but no response was saved.';
for (const job of plan.jobs) {
  const d = path.join(dir, 'jobs', job.key);
  if (!await has(path.join(d, 'model-started.json')) || await has(path.join(d, 'response.json')) || await has(path.join(d, 'status.json'))) continue;
  const run = await runs.read(job.runId); if (!run || run.status !== 'generating') continue;
  run.status = 'failed'; run.error = error; Object.assign(run.cells[0], { status: 'failed', error, completedAt: new Date().toISOString() }); await runs.save(run);
  await writeFile(path.join(d, 'status.json'), JSON.stringify({ status: 'failed', phase: 'interrupted', key: job.key, runId: job.runId, error }, null, 2) + '\n');
  console.log('marked', job.key);
}
