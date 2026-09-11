import { describe, expect, it } from 'vitest';
import type { ProjectedFile } from './displayModel';
import { sourceCodeCompaction } from './sourceCodeCompaction';

function file(ranges: { startLine: number; endLine: number }[][]): ProjectedFile {
  return { sourceFile: 'example.ts', sourceSha256: 'a'.repeat(64), selectedLineCount: ranges.length,
    ascii: ['example.ts', ...ranges.map((_, index) => `  +-- operation ${index}`)].join('\n'),
    rows: [{ treeLine: 1, selected: false, sourceRanges: [{ startLine: 1, endLine: 1000 }] },
      ...ranges.map((sourceRanges, index) => ({ treeLine: index + 2, selected: true, sourceRanges }))] };
}

describe('projected Studio source compaction', () => {
  it('folds only mapped ranges, retaining exact node expansion targets and unmapped gaps', () => {
    const result = sourceCodeCompaction(file([[{ startLine: 10, endLine: 20 }], [{ startLine: 40, endLine: 45 }]]));
    expect(result.compactedSource.sections).toEqual([
      { kind: 'collapsed-comment', startLine: 10, endLine: 20, comment: '  +-- operation 0',
        nodes: [{ graphLine: 1, startLine: 10, endLine: 20 }] },
      { kind: 'collapsed-comment', startLine: 40, endLine: 45, comment: '  +-- operation 1',
        nodes: [{ graphLine: 1, startLine: 40, endLine: 45 }] }
    ]);
  });

  it('merges nested and overlapping folds without losing graph nodes or their precise ranges', () => {
    const result = sourceCodeCompaction(file([
      [{ startLine: 10, endLine: 30 }], [{ startLine: 15, endLine: 20 }],
      [{ startLine: 25, endLine: 40 }], [{ startLine: 41, endLine: 45 }]
    ]));
    expect(result.entries).toHaveLength(4);
    expect(result.compactedSource.sections).toEqual([
      { kind: 'collapsed-comment', startLine: 10, endLine: 40,
        comment: '  +-- operation 0\n  +-- operation 1\n  +-- operation 2', nodes: [
          { graphLine: 1, startLine: 10, endLine: 30 }, { graphLine: 2, startLine: 15, endLine: 20 },
          { graphLine: 3, startLine: 25, endLine: 40 }
        ] },
      { kind: 'collapsed-comment', startLine: 41, endLine: 45, comment: '  +-- operation 3',
        nodes: [{ graphLine: 1, startLine: 41, endLine: 45 }] }
    ]);
  });

  it('shares duplicate ranges and retains disjoint ranges for the same graph row', () => {
    const range = { startLine: 10, endLine: 20 };
    const result = sourceCodeCompaction(file([[range, range, { startLine: 50, endLine: 60 }], [range]]));
    expect(result.entries).toHaveLength(2);
    expect(result.compactedSource.sections[0]).toMatchObject({ comment: '  +-- operation 0\n  +-- operation 1',
      nodes: [{ graphLine: 1, ...range }, { graphLine: 2, ...range }] });
    expect(result.compactedSource.sections[1]).toMatchObject({ startLine: 50, endLine: 60, comment: '  +-- operation 0' });
  });
});
