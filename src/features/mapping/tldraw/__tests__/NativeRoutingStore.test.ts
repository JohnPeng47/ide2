import { expect, it } from 'vitest';
import { atom, Mat, type Editor } from 'tldraw';
import { NativeRoutingStore } from '../NativeRoutingStore';
import { revisionFixture } from '../../../../../tests/support/diagramRevisions';
import { defaultArrowAppearance, type DiagramConnection } from '../../../../../domain/core/diagrams/diagramConnection';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';

it('reuses routes for unrelated movement and updates routes when a blocker moves, folds, or disappears', () => {
  const diagram = revisionFixture().create({ id: 'blocker', revision: 0, ascii: 'Blocker\n`-- Child', structureKind: 'tree' }).diagram;
  const transform = atom('blocker transform', Mat.Translate(1000, 0));
  const editor = { getShape: () => ({ id: 'blocker' }), getShapePageTransform: () => transform.get() } as unknown as Editor;
  const store = new NativeRoutingStore(() => editor);
  const edge: DiagramConnection = { id: 'route', source: { kind: 'content-node', displayNodeId: 'grid:source', contentNodeId: 'source', revisionId: 'rev', side: 'right' },
    target: { kind: 'box', displayNodeId: 'grid:target', side: 'left' }, appearance: defaultArrowAppearance };
  const grids = new Map([['grid:blocker', { layoutKey: 'expanded', diagram, cell: { width: 8, height: 18 } }]]);
  store.sync(grids, [edge]);
  const draw = () => store.draw(edge, { x: 0, y: 0, width: 30, height: 20, proxy: false },
    { x: 300, y: 0, width: 30, height: 20, proxy: false }, edge.source, edge.target, 'measured');
  const direct = draw(); expect(direct.status).toBe('resolved');
  expect(draw()).toBe(direct);
  store.sync(grids, [edge]); expect(draw()).toBe(direct);
  transform.set(Mat.Translate(1200, 20)); expect(draw()).toBe(direct);
  transform.set(Mat.Translate(120, 0));
  const detour = draw(); expect(detour.status).toBe('resolved'); expect(detour.path).not.toBe(direct.path);
  const root = diagramContentNodes(diagram.content).find(n => n.label === 'Blocker')!;
  store.sync(new Map([['grid:blocker', { ...grids.get('grid:blocker')!, layoutKey: 'folded',
    view: { contentRevisionId: diagram.content.revisionId, collapsedContentNodeIds: [root.id] } }]]), [edge]);
  expect(store.obstacles.get()).toHaveLength(1);
  expect(draw()).not.toBe(detour);
  store.sync(new Map(), [edge]); expect(draw().path).toBe(direct.path);
});

it('invalidates a cached route when a guide becomes text at the same coordinates', () => {
  const create = (middle: string) => revisionFixture().create({ id: 'blocker', revision: 0,
    ascii: `Root\n${middle}\n\`-- Tail`, structureKind: 'tree' }).diagram;
  const editor = { getShape: () => ({ id: 'blocker' }), getShapePageTransform: () => Mat.Translate(120, 0) } as unknown as Editor;
  const store = new NativeRoutingStore(() => editor);
  const edge: DiagramConnection = { id: 'route', source: { kind: 'content-node', displayNodeId: 'grid:source', contentNodeId: 'source', revisionId: 'rev', side: 'right' },
    target: { kind: 'box', displayNodeId: 'grid:target', side: 'left' }, appearance: defaultArrowAppearance };
  const sync = (middle: string) => store.sync(new Map([['grid:blocker', { layoutKey: middle, diagram: create(middle), cell: { width: 8, height: 18 } }]]), [edge]);
  const draw = () => store.draw(edge, { x: 0, y: 20, width: 30, height: 14, proxy: false },
    { x: 300, y: 20, width: 30, height: 14, proxy: false }, edge.source, edge.target, 'measured');
  sync('|'); const direct = draw(); expect(direct.path).toBe('M30 27 L300 27');
  const geometry = store.obstacles.get().map(r => [r.x, r.y, r.width, r.height]);
  sync('I'); expect(store.obstacles.get().map(r => [r.x, r.y, r.width, r.height])).toEqual(geometry);
  const detour = draw(); expect(detour).not.toBe(direct); expect(detour.path).not.toBe(direct.path);
  expect(draw()).toBe(detour);
});

it('caches batch lanes, keeps endpoint positions, and drops obsolete lanes when edges disappear', () => {
  const store = new NativeRoutingStore(() => undefined);
  const a = { x: 0, y: 0, width: 20, height: 20, proxy: false }, b = { ...a, x: 200 };
  const edge: DiagramConnection = { id: 'a', source: { kind: 'content-node', displayNodeId: 'grid:a', contentNodeId: 'a', revisionId: 'rev', side: 'right' },
    target: { kind: 'box', displayNodeId: 'grid:b', side: 'left' }, appearance: defaultArrowAppearance };
  const input = (id: string) => [{ ...edge, id }, a, b, edge.source, edge.target, 'measured'] as const;
  const before = store.drawAll([input('b'), input('a')]);
  expect(before.get('a')!.path).not.toBe(before.get('b')!.path);
  expect(before.get('a')!.source).toEqual(before.get('b')!.source);
  expect(before.get('a')!.target).toEqual(before.get('b')!.target);
  expect(store.drawAll([input('b'), input('a')])).toBe(before);
  const alone = store.drawAll([input('b')]);
  expect(alone.size).toBe(1); expect(alone.get('b')!.path).toBe(before.get('a')!.path);
  expect(store.drawAll([input('b')])).toBe(alone);
});
