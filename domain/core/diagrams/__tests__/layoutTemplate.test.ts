import { expect, it } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { extractLayoutTemplate, layoutFromBounds, layoutGeometrySchema, placeLayoutSlots } from '../layoutTemplate';
import { boxesOverlap, resolveScene, type GridBox, type LineGridScene } from '../lineGrid';

it('captures visible placements with neutral IDs, including collapsed summaries and repeated content', () => {
  const leaf = (id: string, column: number): Extract<GridBox, { kind: 'diagram' }> => ({ id, kind: 'diagram', contentId: 'private-content', position: { column, row: 0 }, collapsed: false });
  const scene: LineGridScene = {
    contents: Object.fromEntries(['private-content', 'summary', 'hidden'].map(id => [id, revisionFixture().create({ id, ascii: 'SECRET TEXT', revision: 0 }).diagram])),
    root: { id: 'private-group', kind: 'container', position: { column: 9, row: 7 }, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [
      leaf('first', 0), leaf('second', 20),
      { id: 'collapsed', kind: 'container', position: { column: 0, row: 10 }, collapsed: true, collapsedContentId: 'summary',
        layout: { collisionPolicy: 'push-right', gap: 3 }, children: [{ ...leaf('hidden', 99), contentId: 'hidden' }] }
    ] }
  };
  const before = JSON.stringify(scene), geometry = extractLayoutTemplate(resolveScene(scene));
  expect(geometry.slots.map(s => [s.id, s.position])).toEqual([
    ['slot-1', { column: 0, row: 0 }], ['slot-2', { column: 20, row: 0 }], ['slot-3', { column: 0, row: 10 }]
  ]);
  expect(JSON.stringify(geometry)).not.toMatch(/SECRET|private|hidden|summary/);
  expect(JSON.stringify(scene)).toBe(before);
});

it('normalizes negative origins and enforces normalized, bounded nonempty templates', () => {
  const geometry = layoutFromBounds([{ column: -5, row: -2, columns: 4, rows: 3 }, { column: 9, row: 5, columns: 2, rows: 1 }]);
  expect(geometry.slots.map(s => s.position)).toEqual([{ column: 0, row: 0 }, { column: 14, row: 7 }]);
  expect(() => layoutFromBounds([])).toThrow('no visible diagrams');
  expect(() => layoutFromBounds(Array.from({ length: 21 }, (_, column) => ({ column, row: 0, columns: 1, rows: 1 })))).toThrow('at most 20');
  expect(() => layoutGeometrySchema.parse({ ...geometry, slots: geometry.slots.map(s => ({ ...s, position: { ...s.position, row: s.position.row + 1 } })) })).toThrow('Normalize');
  expect(() => layoutFromBounds([{ column: 0, row: 0, columns: 1, rows: 1 }, { column: 20000, row: 0, columns: 1, rows: 1 }])).toThrow('bounds');
});

it('expands deterministically right/down using actual ASCII dimensions without overlapping', () => {
  const geometry = layoutFromBounds([{ column: 0, row: 0, columns: 1, rows: 1 }, { column: 5, row: 0, columns: 1, rows: 1 }, { column: 0, row: 2, columns: 1, rows: 1 }]);
  const diagrams = [{ slotId: 'slot-1', ascii: '1234567890\na\nb' }, { slotId: 'slot-2', ascii: 'B' }, { slotId: 'slot-3', ascii: 'C' }];
  const placed = placeLayoutSlots(geometry, diagrams);
  expect(placed.map(p => [p.bounds.column, p.bounds.row, p.moved])).toEqual([[0, 0, false], [13, 0, true], [0, 6, true]]);
  expect(placeLayoutSlots(geometry, [...diagrams].reverse())).toEqual(placed);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(boxesOverlap(placed[i].bounds, placed[j].bounds)).toBe(false);
  for (const invalid of [diagrams.slice(1), [...diagrams, diagrams[0]], [...diagrams.slice(1), { slotId: 'slot-4', ascii: 'X' }]])
    expect(() => placeLayoutSlots(geometry, invalid)).toThrow('exactly one');
  expect(() => placeLayoutSlots(geometry, [{ ...diagrams[0], ascii: 'x'.repeat(20000) }, ...diagrams.slice(1)])).toThrow();
});

it('v2 preserves staggered non-overlapping template origins instead of serializing rows', () => {
  const geometry = layoutFromBounds([
    { column: 0, row: 0, columns: 10, rows: 20 },
    { column: 20, row: 2, columns: 8, rows: 5 },
    { column: 20, row: 12, columns: 8, rows: 5 }
  ]);
  geometry.placement.version = 2;
  const diagrams = geometry.slots.map(s => ({ slotId: s.id, ascii: Array(s.size.rows).fill('x'.repeat(s.size.columns)).join('\n') }));
  const placed = placeLayoutSlots(geometry, diagrams);
  expect(placed.map(p => p.bounds)).toEqual(geometry.slots.map(s => ({ ...s.position, ...s.size })));
  expect(placed.every(p => !p.moved)).toBe(true);
  expect(placeLayoutSlots(geometry, [...diagrams].reverse())).toEqual(placed);
});

it('v2 resolves multiple blockers without moving earlier slots or exceeding grid bounds', () => {
  const geometry = layoutFromBounds([
    { column: 0, row: 0, columns: 4, rows: 4 },
    { column: 8, row: 0, columns: 4, rows: 4 },
    { column: 0, row: 2, columns: 4, rows: 4 }
  ]);
  geometry.placement.version = 2;
  const diagrams = geometry.slots.map(s => ({ slotId: s.id, ascii: '1234567890\n1234567890\n1234567890' }));
  const placed = placeLayoutSlots(geometry, diagrams);
  expect(placed[0].bounds).toMatchObject({ column: 0, row: 0 });
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++)
    expect(boxesOverlap(placed[i].bounds, placed[j].bounds, 3)).toBe(false);
  expect(placed.every(p => p.bounds.row >= p.requested.row && p.bounds.column >= p.requested.column)).toBe(true);
  expect(() => placeLayoutSlots(geometry, diagrams.map(d => ({ ...d, ascii: 'x'.repeat(20000) })))).toThrow('bounds');
});
