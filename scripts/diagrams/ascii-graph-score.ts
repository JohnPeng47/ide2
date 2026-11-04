// Score parseAsciiGraph against every fixture: `node --import tsx scripts/diagrams/ascii-graph-score.ts [filter] [--detail]`.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAsciiGraph } from '../../domain/core/diagrams/asciiGraph/parseAsciiGraph';
import { resolveExpectation, scoreGraph } from '../../domain/core/diagrams/asciiGraph/__tests__/expectation';
const dir = join(import.meta.dirname, '../../domain/core/diagrams/asciiGraph/__tests__/fixtures');
const filter = process.argv[2]?.startsWith('--') ? undefined : process.argv[2];
const detail = process.argv.includes('--detail');
const total = { boxes: 0, boxesMatched: 0, parentsMatched: 0, edges: 0, edgesMatched: 0, edgesPredicted: 0 };
for (const file of readdirSync(dir).filter(f => f.endsWith('.expect') && (!filter || f.includes(filter))).sort()) {
  const name = file.replace('.expect', '');
  const ascii = readFileSync(join(dir, `${name}.txt`), 'utf8');
  const s = scoreGraph(resolveExpectation(ascii, readFileSync(join(dir, file), 'utf8')), parseAsciiGraph(ascii));
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s[k];
  console.log(`${name.padEnd(14)} boxes ${s.boxesMatched}/${s.boxes}  parents ${s.parentsMatched}/${s.boxesMatched}  edges ${s.edgesMatched}/${s.edges} (predicted ${s.edgesPredicted})`);
  if (detail) {
    for (const b of s.missing) console.log(`   - missing ${b.id} ${JSON.stringify(b.text)}`);
    for (const b of s.extra) console.log(`   + extra   ${b.rect.line1}:${b.rect.col1}-${b.rect.line2}:${b.rect.col2} ${JSON.stringify(b.text)}`);
    for (const p of s.wrongParents) console.log(`   ~ parent  ${p}`);
    for (const e of s.missingEdges) console.log(`   - edge    ${e}`);
    for (const e of s.extraEdges) console.log(`   + edge    ${e}`);
  }
}
const pct = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(1)}%`;
console.log(`TOTAL boxes ${total.boxesMatched}/${total.boxes} (${pct(total.boxesMatched, total.boxes)})  parents ${pct(total.parentsMatched, total.boxes)}  edge recall ${pct(total.edgesMatched, total.edges)}  edge precision ${pct(total.edgesMatched, total.edgesPredicted)}`);
