import { expect, it, vi } from 'vitest';
import { atom, computed, Mat, type Editor } from 'tldraw';
import { NativeRoutingStore } from '../NativeRoutingStore';
import { ConnectionRouter } from '../../../../../domain/mapping/workspace/connectionRouter';
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
  expect(store.obstacles.get().filter(r => r.kind === 'text')).toHaveLength(1);
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
it('transforms measured text obstacles and rejects measurements from an obsolete layout', () => {
  const diagram = revisionFixture().create({ id: 'blocker', revision: 0, ascii: 'Blocker', structureKind: 'tree' }).diagram;
  const transform = atom('measured blocker transform', Mat.Translate(120, 0));
  const editor = { getShape: () => ({ id: 'blocker' }), getShapePageTransform: () => transform.get() } as unknown as Editor;
  const store = new NativeRoutingStore(() => editor);
  const model = { layoutKey: 'first', diagram, cell: { width: 8.4, height: 18 } };
  const sync = (layoutKey: string) => store.sync(new Map([['grid:blocker', { ...model, layoutKey }]]), []);
  sync('first');
  const estimated = store.obstacles.get();
  const measured = [{ displayNodeId: 'grid:blocker', kind: 'text' as const, x: 0, y: 40, width: 52, height: 15 }];
  store.setMeasurements('grid:blocker', 'first', measured);
  expect(store.obstacles.get()).toEqual([{ ...measured[0], x: 120 }]);
  const cached = store.obstacles.get();
  store.setMeasurements('grid:blocker', 'first', measured);
  expect(store.obstacles.get()).toBe(cached);
  transform.set(Mat.Translate(150, 20));
  expect(store.obstacles.get()).toEqual([{ ...measured[0], x: 150, y: 60 }]);
  transform.set(Mat.Translate(120, 0)); sync('second');
  expect(store.obstacles.get()).toEqual(estimated);
  store.setMeasurements('grid:blocker', 'first', measured);
  expect(store.obstacles.get()).toEqual(estimated);
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

it('keeps endpoints live without route searches during dragging and reroutes on release or cancel', () => {
  const dragging = atom('dragging', false), x = atom('source x', 0);
  const editor = { inputs: { getIsDragging: () => dragging.get() } } as unknown as Editor;
  const store = new NativeRoutingStore(() => editor), search = vi.spyOn(ConnectionRouter.prototype, 'draw');
  const edge: DiagramConnection = { id: 'a', source: { kind: 'content-node', displayNodeId: 'grid:a', contentNodeId: 'a', revisionId: 'rev', side: 'right' },
    target: { kind: 'box', displayNodeId: 'grid:b', side: 'left' }, appearance: defaultArrowAppearance };
  const arrows = computed('drag routes', () => store.drawAll([[edge, { x: x.get(), y: x.get() / 2, width: 20, height: 20, proxy: false },
    { x: 300, y: 0, width: 20, height: 20, proxy: false }, edge.source, edge.target, 'measured']]));
  const original = arrows.get().get('a')!;
  expect(search).toHaveBeenCalledTimes(1);
  dragging.set(true);
  for (const position of [10, 20, 40, 80]) {
    x.set(position);
    const arrow = arrows.get().get('a')!;
    expect(arrow.source).toMatchObject({ x: position + 20, y: position / 2 + 10 });
    expect(arrow.target).toEqual(original.target);
    expect(arrow.points!.slice(1).every((p, i) => p.x === arrow.points![i].x || p.y === arrow.points![i].y)).toBe(true);
  }
  expect(search).toHaveBeenCalledTimes(1);
  dragging.set(false); // no final position update: the flag alone must settle routes
  expect(arrows.get().get('a')!.status).toBe('resolved');
  expect(search).toHaveBeenCalledTimes(2);
  dragging.set(true); x.set(0); arrows.get(); dragging.set(false);
  expect(arrows.get().get('a')!.path).toBe(original.path);
  expect(search).toHaveBeenCalledTimes(3);
  search.mockRestore();
});

it('coalesces worker requests, rejects stale results, and terminates the worker on disposal', () => {
  const jobs: { id: number; inputs: Parameters<ConnectionRouter['drawAll']>[0]; obstacles: Parameters<ConnectionRouter['drawAll']>[1] }[] = [];
  const worker = { postMessage: (job: typeof jobs[number]) => jobs.push(job), terminate: vi.fn(), onmessage: undefined as ((event: MessageEvent) => void) | undefined };
  const x = atom('async source x', 0), dragging = atom('async dragging', false);
  const editor = { inputs: { getIsDragging: () => dragging.get() } } as unknown as Editor;
  const store = new NativeRoutingStore(() => editor, () => worker as unknown as Worker);
  const edge: DiagramConnection = { id: 'async', source: { kind: 'content-node', displayNodeId: 'grid:a', contentNodeId: 'a', revisionId: 'rev', side: 'right' },
    target: { kind: 'box', displayNodeId: 'grid:b', side: 'left' }, appearance: defaultArrowAppearance };
  const arrows = computed('worker routes', () => store.drawAll([[edge, { x: x.get(), y: 0, width: 20, height: 20, proxy: false },
    { x: 300, y: 0, width: 20, height: 20, proxy: false }, edge.source, edge.target, 'measured']]));
  const reply = (index: number) => { const job = jobs[index]; worker.onmessage!({ data: { id: job.id, arrows: new ConnectionRouter().drawAll(job.inputs, job.obstacles) } } as MessageEvent); };
  expect(arrows.get().get('async')!.source!.x).toBe(20); expect(jobs).toHaveLength(1);
  x.set(40); arrows.get(); x.set(80); arrows.get(); expect(jobs).toHaveLength(1);
  reply(0); expect(jobs).toHaveLength(2); expect(jobs[1].inputs[0][1]!.x).toBe(80);
  expect(arrows.get().get('async')!.source!.x).toBe(100);
  reply(1); const settled = arrows.get(); expect(settled.get('async')!.status).toBe('resolved');
  expect(arrows.get()).toBe(settled);
  dragging.set(true); x.set(90); expect(arrows.get().get('async')!.source!.x).toBe(110); expect(jobs).toHaveLength(2);
  dragging.set(false); arrows.get(); expect(jobs).toHaveLength(3);
  store.dispose(); expect(worker.terminate).toHaveBeenCalledOnce(); reply(2);
});

it('falls back to synchronous routing if the worker cannot start', async () => {
  const store = new NativeRoutingStore(() => undefined, () => { throw Error('Worker unavailable'); });
  const search = vi.spyOn(ConnectionRouter.prototype, 'drawAll');
  const arrows = computed('fallback routing', () => store.drawAll([]));
  arrows.get(); expect(search).not.toHaveBeenCalled();
  await Promise.resolve(); arrows.get(); expect(search).toHaveBeenCalledOnce();
  search.mockRestore(); store.dispose();
});
