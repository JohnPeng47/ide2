/** Import historical few-shot examples without changing the prompts or outputs of completed runs. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { EvalReferenceService } from '../../application/mapping/evals/evalReferenceService';
import type { EvalReference } from '../../domain/mapping/evals/evalReference';
import type { Judgement } from '../../domain/mapping/evals/judgement';
import type { FewShotReference } from '../../domain/mapping/evals/fewShot';
const root = process.argv[2];
if (!root) throw Error('Usage: import-few-shot-references.ts <store-root>');
const project = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
const library = new EvalReferenceService(new JsonDirectoryStore<EvalReference>(root, 'eval-references'), { loadProject: async () => project });
const store = new JsonDirectoryStore<Judgement>(root, 'judgements');
let count = 0;
for (const report of await store.list()) {
  if (report.kind !== 'few-shot-progress' || !report.data) continue;
  if (report.status === 'generating') throw Error(`Wait for ${report.id} to finish.`);
  const backup = path.join(root, 'eval-migrations', 'few-shot-references');
  await mkdir(backup, { recursive: true });
  await writeFile(path.join(backup, `${report.id}.json`), JSON.stringify(report), { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const save = async (items: FewShotReference[], round: number) => {
    for (const item of items) {
      if (item.referenceId) continue;
      const hash = createHash('sha256').update(JSON.stringify([report.id, round, item.slot, item.title, item.ascii])).digest('hex');
      const requestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const ref = await library.create({ requestId, name: `${item.title.slice(0,65)} · ${report.id.slice(0,8)} · round ${round} slot ${item.slot}`, ascii: item.ascii,
        source: report.canvases[0].source, sourceName: 'Synthetic example inspired by target topology', canvasName: report.canvases[0].canvasName });
      item.referenceId = ref.id; count++;
    }
  };
  await save(report.data.initialReferences, 1);
  for (const round of report.data.rounds) { await save(round.references, round.round); await save(round.nextReferences, round.round + 1); }
  await store.save(report);
}
console.log(`Linked ${count} example occurrences to saved references. Backups retained.`);
