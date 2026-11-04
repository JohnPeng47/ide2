import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAsciiGraph } from '../parseAsciiGraph';
import { resolveExpectation, scoreGraph } from './expectation';

const dir = join(import.meta.dirname, 'fixtures');
const names = readdirSync(dir).filter(f => f.endsWith('.expect')).map(f => f.replace('.expect', '')).sort();

describe('parseAsciiGraph on generated canvas fixtures', () => {
  const scores = names.map(name => {
    const ascii = readFileSync(join(dir, `${name}.txt`), 'utf8');
    const expected = resolveExpectation(ascii, readFileSync(join(dir, `${name}.expect`), 'utf8'));
    return { name, expected, score: scoreGraph(expected, parseAsciiGraph(ascii)) };
  });

  it('keeps the checked-in JSON expectations in sync with the DSL', () => {
    for (const { name, expected } of scores) {
      expect(JSON.parse(readFileSync(join(dir, `${name}.expected.json`), 'utf8')), name).toEqual(expected);
    }
  });

  it('matches boxes, parents and edges above the recorded floors', () => {
    const sum = (k: 'boxes' | 'boxesMatched' | 'parentsMatched' | 'edges' | 'edgesMatched' | 'edgesPredicted') =>
      scores.reduce((n, s) => n + s.score[k], 0);
    expect(sum('boxesMatched') / sum('boxes')).toBeGreaterThanOrEqual(0.995);
    expect(sum('parentsMatched') / sum('boxes')).toBeGreaterThanOrEqual(0.995);
    expect(sum('edgesMatched') / sum('edges')).toBeGreaterThanOrEqual(0.99);
    expect(sum('edgesMatched') / sum('edgesPredicted')).toBeGreaterThanOrEqual(0.99);
  });
});
