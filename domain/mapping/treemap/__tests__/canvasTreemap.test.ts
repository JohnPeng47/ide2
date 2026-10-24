import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { canvasTreemapInput, buildCanvasTreemaps, sourceLines } from '../canvasTreemap';
import type { ChangeTreemapNode } from '../../changes/changeTreemap';

function fixture() {
  const ascii = 'Root\n`-- Parent\n    `-- Child';
  const source = { sourceId: 'source-fixture', repositoryIdentity: 'fixture', corpus: { kind: 'git-worktree' as const, root: '/fixture' }, domainProfileId: 'source-code' as const };
  const scene = singleDiagramScene(ascii, source);
  scene.contents = { ...scene.contents, overview: revisionFixture().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree', source,
    evidence: { parent: { id: 'parent', label: 'Parent', handle: 'parent', category: 'operation', summary: 'Parent', sourceRanges: [{ id: 'p', path: 'src/a.ts', startLine: 1, endLine: 4, originalLines: ['a', 'b', 'c', 'd'] }] },
      child: { id: 'child', label: 'Child', handle: 'child', category: 'operation', summary: 'Child', sourceRanges: [{ id: 'c', path: 'src/a.ts', startLine: 3, endLine: 5, originalLines: ['c', 'd', 'e'] }] } },
    mappings: [{ id: 'parent', entityId: 'parent', sourceRangeIndex: 0, line: 2, startColumn: 5, endColumn: 10 },
      { id: 'duplicate-parent', entityId: 'parent', sourceRangeIndex: 0, line: 2, startColumn: 5, endColumn: 10 },
      { id: 'child', entityId: 'child', sourceRangeIndex: 0, line: 3, startColumn: 9, endColumn: 13 }]
  }).diagram };
  const input = canvasTreemapInput(scene, 'doc');
  const reads = new Map([[input.files[0].key, { text: 'a\nb\nc\nd\ne\nf\ng\n' }]]);
  return { input, reads, scene };
}
const all = (n: ChangeTreemapNode): ChangeTreemapNode[] => [n, ...n.children.flatMap(all)];
it('unions source ranges, deduplicates repeated mappings and shares only overlapping lines', () => {
  const { input, reads } = fixture();
  const mapped = buildCanvasTreemaps(input, reads, 'mapped'), files = buildCanvasTreemaps(input, reads, 'files');
  expect(mapped.actual).toBe(5); expect(mapped.total).toBe(7); expect(mapped.extra).toBe(2);
  expect(mapped.diagrams.value).toBe(mapped.files.value);
  expect(files.actual).toBe(7); expect(files.unmapped).toBe(2); expect(files.diagrams.value).toBe(files.files.value);
  const child = all(mapped.diagrams).find(n => n.label === 'Child')!;
  const parent = all(mapped.diagrams).find(n => n.label === 'Parent')!;
  expect(child.value).toBe(2); expect(parent.value).toBe(5);
  expect(parent.children.find(n => n.kind === 'direct')?.value).toBe(3);
  expect(mapped.diagrams.children.some(n => n.kind === 'unmapped')).toBe(false);
});
it('excludes stale, missing and binary source data without inventing mapped area', () => {
  const { input, reads } = fixture();
  reads.set(input.files[0].key, { text: 'a\nb\nchanged\nd\ne\nf\ng\n' });
  const stale = buildCanvasTreemaps(input, reads, 'files');
  expect(stale.mapped).toBe(0); expect(stale.unmapped).toBe(7); expect(stale.issues[0]).toContain('3 stale');
  for (const text of [undefined, '\0binary']) {
    const unavailable = buildCanvasTreemaps(input, new Map([[input.files[0].key, { text }]]), 'files');
    expect(unavailable.actual).toBe(0); expect(unavailable.issues.length).toBeGreaterThan(0);
  }
});
it('keeps repeated diagram instances distinct while deduplicating source file totals', () => {
  const { scene, reads } = fixture();
  if (scene.root.kind !== 'container') throw Error('Expected container');
  scene.root.children = [...scene.root.children, { ...scene.root.children[0], id: 'copy', position: { column: 30, row: 3 } }];
  const input = canvasTreemapInput(scene, 'doc');
  const result = buildCanvasTreemaps(input, reads, 'mapped');
  expect(input.files.length).toBe(1); expect(result.actual).toBe(5);
  expect(result.diagrams.children.map(n => n.value)).toEqual([2.5, 2.5]);
  expect(result.extra).toBe(9);
});
it('counts physical lines including blanks without treating the terminal newline as a new line', () => {
  expect(sourceLines('')).toEqual([]); expect(sourceLines('\n')).toEqual(['']);
  expect(sourceLines('a\r\n\r\nb\r\n')).toEqual(['a', '', 'b']);
  expect(sourceLines('a\nb')).toHaveLength(2);
});
