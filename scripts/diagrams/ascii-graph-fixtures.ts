// Resolve every .expect file and print a summary (or the first error per file).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveExpectation } from '../../domain/core/diagrams/asciiGraph/__tests__/expectation';
const dir = join(import.meta.dirname, '../../domain/core/diagrams/asciiGraph/__tests__/fixtures');
const only = process.argv[2];
let boxes = 0, edges = 0;
for (const file of readdirSync(dir).filter(f => f.endsWith('.expect') && (!only || f.includes(only))).sort()) {
  const name = file.replace('.expect', '');
  try {
    const exp = resolveExpectation(readFileSync(join(dir, `${name}.txt`), 'utf8'), readFileSync(join(dir, file), 'utf8'));
    boxes += exp.boxes.length; edges += exp.edges.length;
    writeFileSync(join(dir, `${name}.expected.json`), JSON.stringify(exp, null, 1) + '\n');
    console.log(`${name}: ${exp.boxes.length} boxes, ${exp.edges.length} edges`);
    if (process.argv.includes('--show')) for (const b of exp.boxes) console.log(`  ${b.id.padEnd(13)} ${b.parent ? '  ' : ''}${JSON.stringify(b.text)}`);
  } catch (error) { console.log(`${name}: ERROR ${(error as Error).message}`); }
}
console.log(`total: ${boxes} boxes, ${edges} edges`);
