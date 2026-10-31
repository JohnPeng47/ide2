import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { analysisArtifactSchema } from '../../domain/core/static-analysis/schema';

const target = fileURLToPath(new URL('../../domain/core/static-analysis/analysis.schema.json', import.meta.url));
const schema = z.toJSONSchema(analysisArtifactSchema, { target: 'draft-2020-12' });
const json = JSON.stringify({ ...schema, $id: 'urn:new-diagram:static-analysis:1',
  description: 'Shape contract. Also run validateAnalysisArtifact for graph, range, identity and metric invariants.' }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== json) throw new Error('Persisted JSON Schema is stale. Run npm run analysis:schema.');
  console.log('Static-analysis JSON Schema matches its TypeScript definition.');
} else {
  await writeFile(target, json);
  console.log(`Wrote ${target}`);
}
