import { expect, it } from 'vitest';
import { CanvasCheckpointEncoder, MAX_CHECKPOINT_DELTA_DEPTH, applyCanvasRecordDiff, loadCanvasCheckpoint, restoreCanvasCheckpoints,
  type CanvasCheckpointRecords } from '../canvasCheckpointRecords';
import type { StoredCanvasSnapshot } from '../canvasHistory';
import { compileDiagramAgentContext } from '../diagramAgentContext';
import { singleDiagramScene } from '../projectDiagramCanvas';

const ascii = 'Tree\n' + '|-- shared source\n'.repeat(150);
function snapshot(id: string, parentId?: string, x = 0): StoredCanvasSnapshot {
  return { id, parentId, document: { scene: { root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: 'push-right', gap: 3 }, children: [] } }, edges: [], sections: {} },
    diagramBindings: {}, nodeOrigins: {}, view: { display: { nodes: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i), {
      id: String(i), kind: 'selection', sourceAscii: ascii, position: { x: i === 0 ? x : i, y: 0 }, selectedIds: [`node-${i}`]
    }])) }, selection: { items: [] }, controls: { surfaces: {} } } };
}
function merge(target: CanvasCheckpointRecords, next: CanvasCheckpointRecords) {
  Object.assign(target.checkpoints, next.checkpoints); Object.assign(target.items, next.items);
}

it('stores a panel move as one changed record and retains shared text once', () => {
  const encoder = new CanvasCheckpointEncoder(), first = snapshot('a'), second = snapshot('b', 'a', 10);
  const storage = encoder.encode({ a: first });
  const next = encoder.encode({ b: second });
  expect(next.checkpoints.b.baseId).toBe('a');
  expect(Object.keys(next.checkpoints.b.changes.updated)).toEqual(['["view","display","nodes","0"]']);
  expect(Object.values(next.items).filter(item => item.format === 'canvas-text')).toHaveLength(0);
  expect(Object.values(storage.items).filter(item => item.format === 'canvas-text')).toEqual([{ format: 'canvas-text', text: ascii }]);
  expect(JSON.stringify(next).length).toBeLessThan(1500);
  merge(storage, next);
  expect(restoreCanvasCheckpoints(storage.checkpoints, storage.items)).toEqual({ a: first, b: second });
  const a = applyCanvasRecordDiff({}, storage.checkpoints.a.changes);
  const b = applyCanvasRecordDiff(a, storage.checkpoints.b.changes);
  expect(applyCanvasRecordDiff(b, storage.checkpoints.b.changes, true)).toEqual(a);
});

it('persists a diagram context as its own record across later canvas checkpoints', () => {
  const encoder = new CanvasCheckpointEncoder(), first = snapshot('a');
  const diagram = singleDiagramScene('Source').contents.overview;
  const compiled = compileDiagramAgentContext(diagram);
  const context = { diagramId: compiled.diagramId, compiledFromRevisionId: compiled.compiledFromRevisionId,
    sourceFingerprint: compiled.sourceFingerprint, contentHash: compiled.snapshot!.contentHash,
    backingRecordId: 'a'.repeat(64) };
  first.document.diagramContexts = { [diagram.diagramId]: context };
  const initial = encoder.encode({ a: first });
  const second = structuredClone(first);
  second.id = 'b'; second.parentId = 'a';
  (second.view as any).display.nodes['0'].position.x = 10;
  const next = encoder.encode({ b: second });
  expect(Object.keys(initial.checkpoints.a.changes.added)).toContain(JSON.stringify(['document', 'diagramContexts', diagram.diagramId]));
  expect(Object.keys(next.checkpoints.b.changes.updated)).toEqual([JSON.stringify(['view', 'display', 'nodes', '0'])]);
  merge(initial, next);
  expect(restoreCanvasCheckpoints(initial.checkpoints, initial.items).b.document.diagramContexts?.[diagram.diagramId]).toEqual(context);
  expect(JSON.stringify(initial)).not.toContain('Source evidence for diagram');
});

it('preserves forks, deletions, transaction metadata, unicode, and portable full exports', () => {
  const encoder = new CanvasCheckpointEncoder(), first = snapshot('a'), b = snapshot('b', 'a', 10), c = snapshot('c', 'a', 20);
  (c.view as any).display.nodes['0'].sourceAscii = 'Résumé 🐈\n';
  delete (c.view as any).display.nodes['1']; c.transactionId = 'transfer-1';
  const storage = encoder.encode({ c, b, a: first });
  expect(restoreCanvasCheckpoints(storage.checkpoints, storage.items)).toEqual({ a: first, b, c });
  const full = encoder.encode({ a: first, b, c }, true);
  expect(restoreCanvasCheckpoints(full.checkpoints, full.items)).toEqual({ a: first, b, c });
  const retired = { ...c, transactionId: undefined };
  merge(storage, encoder.encode({ c: retired }));
  expect(restoreCanvasCheckpoints(storage.checkpoints, storage.items).c).toEqual(retired);
});

it('bounds replay and reads only the requested branch and its current values', async () => {
  const encoder = new CanvasCheckpointEncoder(), storage: CanvasCheckpointRecords = { checkpoints: {}, items: {} };
  for (let i = 0; i < 75; i++) merge(storage, encoder.encode({ [String(i)]: snapshot(String(i), i ? String(i - 1) : undefined, i) }));
  expect(storage.checkpoints['32'].depth).toBe(0);
  expect(Math.max(...Object.values(storage.checkpoints).map(c => c.depth))).toBe(MAX_CHECKPOINT_DELTA_DEPTH);
  const read: string[] = [];
  const head = await loadCanvasCheckpoint('74', async id => { read.push(id); return storage.checkpoints[id]; }, async id => storage.items[id]);
  expect(head).toEqual(snapshot('74', '73', 74));
  expect(read).toHaveLength(11);
  expect(read).not.toContain('63');
});

it('rejects corrupt references, incompatible diffs and cyclic ancestry', async () => {
  const storage = new CanvasCheckpointEncoder().encode({ a: snapshot('a'), b: snapshot('b', 'a', 10) });
  expect(() => restoreCanvasCheckpoints(storage.checkpoints, {})).toThrow('Missing canvas value');
  const wrong = structuredClone(storage);
  wrong.checkpoints.b.changes.updated['["view","display","nodes","0"]'][0] = '0'.repeat(64);
  expect(() => restoreCanvasCheckpoints(wrong.checkpoints, wrong.items)).toThrow('conflict');
  await expect(loadCanvasCheckpoint('b', async id => storage.checkpoints[id], async () => ({ format: 'canvas-text', text: 'corrupt' }))).rejects.toThrow('integrity');
  const cyclic = snapshot('a', 'a');
  expect(() => new CanvasCheckpointEncoder().encode({ a: cyclic })).toThrow('Cyclic');
});

it('accepts legacy expanded checkpoints alongside new standalone checkpoints', () => {
  const old = snapshot('old');
  const storage = new CanvasCheckpointEncoder().encode({ next: snapshot('next', 'old', 1) });
  expect(storage.checkpoints.next.depth).toBe(0);
  expect(restoreCanvasCheckpoints({ old, ...storage.checkpoints }, storage.items)).toEqual({ old, next: snapshot('next', 'old', 1) });
});

it('revalidates dependencies when reusing decoded immutable checkpoints', () => {
  const storage = new CanvasCheckpointEncoder().encode({ a: snapshot('a') }, true, 'a');
  const first = restoreCanvasCheckpoints(storage.checkpoints, storage.items, storage.head, true);
  expect(restoreCanvasCheckpoints(storage.checkpoints, storage.items, storage.head, true).a).toBe(first.a);
  const missing = { ...storage.items };
  const textId = Object.keys(missing).find(id => missing[id].format === 'canvas-text')!;
  delete missing[textId];
  expect(() => restoreCanvasCheckpoints(storage.checkpoints, missing, storage.head, true)).toThrow('Missing canvas text');
  expect(() => restoreCanvasCheckpoints(storage.checkpoints, storage.items, { ...storage.head!, records: {} }, true)).toThrow('Invalid canvas checkpoint head');
});
