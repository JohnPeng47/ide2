// node --import tsx tests/performance/diagram-content-diff.mjs
// Parsing is outside the timed region: these measurements cover renderer diffing.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildDiagramContent } from '../../domain/core/diagrams/diagramContent.ts';
import { diffDiagramContent } from '../../domain/mapping/changes/diagramContentDiff.ts';

const wide = labels => ['Root', ...labels.map((label, i) => `${i === labels.length - 1 ? '`' : '|'}-- ${label}`)].join('\n');
const chain = suffix => ['Root', ...Array.from({ length: 85 }, (_, i) => `${'    '.repeat(i)}\x60-- Level ${i} ${suffix}`), `${'    '.repeat(85)}\x60-- Leaf`].join('\n');
const field = i => String.fromCharCode(97 + Math.floor(i / 26)).repeat(6) + String.fromCharCode(97 + i % 26).repeat(6);
const cases = [
  ['wide insertion', wide(Array.from({ length: 1300 }, (_, i) => `N${i}`)), wide(['Added', ...Array.from({ length: 1300 }, (_, i) => `N${i}`)]), { added: 1, removed: 0, modified: 0, moved: 0 }],
  ['deep renames', chain('before'), chain('after'), { added: 0, removed: 0, modified: 85, moved: 0 }],
  ['ambiguous repeated deletion', wide(Array(1500).fill('Same')), wide(Array(1499).fill('Same')), { added: 1499, removed: 1500, modified: 0, moved: 0 }],
  ['unrelated replacements', wide(Array.from({ length: 1200 }, (_, i) => `Old${i}`)), wide(Array.from({ length: 1200 }, (_, i) => `New${i}`)), { added: 1200, removed: 1200, modified: 0, moved: 0 }],
  ...[63, 64, 65].map(size => [`field alignment ${size}`, wide(Array.from({ length: size }, (_, i) => `${field(i)}: value`)),
    wide(Array.from({ length: size }, (_, i) => `${field(i)} = value`)), size <= 64
      ? { added: 0, removed: 0, modified: size, moved: 0 } : { added: size, removed: size, modified: 0, moved: 0 }]),
  ['long similar labels', wide(Array.from({ length: 64 }, (_, i) => `${'shared text '.repeat(20)}before ${i}`)),
    wide(Array.from({ length: 64 }, (_, i) => `${'shared text '.repeat(20)}after ${i}`)), { added: 64, removed: 64, modified: 0, moved: 0 }],
];
const results = [];
for (const [name, oldText, newText, counts] of cases) {
  const a = buildDiagramContent(oldText, 'old', 'tree'), b = buildDiagramContent(newText, 'new', 'tree');
  assert.deepEqual(diffDiagramContent(a, b).counts, counts, name);
  const times = [];
  for (let trial = 0; trial < 12; trial++) {
    const start = performance.now();
    diffDiagramContent(a, b);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({ name, chars: Math.max(oldText.length, newText.length), medianMs: +times[6].toFixed(2), maxMs: +times.at(-1).toFixed(2) });
}
console.table(results);
