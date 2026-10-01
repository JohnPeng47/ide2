import { expect, it, vi } from 'vitest';
import { LiveCanvasService } from '../liveCanvasService';
const region = { id: 'a', sourceBoxId: 'box', sourceContentId: 'content', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 5 }, text: 'Selected ASCII', stale: false };
const selection = { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 3, sequence: 1, regions: [region] };

it('binds to an exact workspace/document; ignores old frames and isolates readers', () => {
  const list = vi.fn(() => ['one', 'two'].map(canvasId => ({ canvasId, documents: [{ documentId: 'doc', name: 'Test' }] })));
  const service = new LiveCanvasService(list), a = {}, b = {}, notify = vi.fn();
  service.publish(a, 'one'); service.publish(b, 'two');
  expect(() => service.attach('one', 'doc', notify)).toThrow('not published');
  service.update(a, 'one', selection); service.update(b, 'two', { ...selection, regions: [{ ...region, text: 'Other tab' }] });
  const bound = service.attach('one', 'doc', notify);
  service.update(b, 'two', { ...selection, sequence: 2, regions: [{ ...region, text: 'Other selection' }] });
  service.update(a, 'one', { ...selection, sequence: 0, regions: [] });
  expect(notify).not.toHaveBeenCalled();
  list.mockClear();
  for (let i = 0; i < 1000; i++) expect(service.read(bound.connectionId).regions).toEqual(selection.regions);
  expect(list).not.toHaveBeenCalled(); // Cached GET cannot touch the browser bridge.
  service.update(a, 'one', { ...selection, sequence: 2, regions: [] });
  expect(notify.mock.lastCall?.[0]).toMatchObject({ type: 'selection.delta', removed: ['a'], upserted: [], baseSequence: 1, sequence: 2 });
  service.detach(bound.connectionId);
  expect(() => service.read(bound.connectionId)).toThrow('CONNECTION_NOT_FOUND');
});

it('invalidates replaced or disconnected canvases without silently rebinding old clients', () => {
  const service = new LiveCanvasService(() => [{ canvasId: 'one', documents: [] }]);
  const owner = {}, notify = vi.fn();
  service.publish(owner, 'one'); service.update(owner, 'one', selection);
  const old = service.attach('one', 'doc', notify);
  service.update(owner, 'one', { ...selection, canvasEpoch: 'replacement', sequence: 0 });
  expect(notify.mock.lastCall?.[0].type).toBe('canvas.replaced');
  expect(() => service.read(old.connectionId)).toThrow('canvas.replaced');
  const current = service.attach('one', 'doc', notify);
  service.disconnect({}, 'one'); // An unrelated socket cannot disconnect the producer.
  expect(service.read(current.connectionId).canvasEpoch).toBe('replacement');
  service.disconnect(owner, 'one');
  expect(() => service.read(current.connectionId)).toThrow('canvas.disconnected');
  service.publish(owner, 'one'); service.update(owner, 'one', selection);
  expect(() => service.read(current.connectionId)).toThrow('canvas.disconnected');
  const reopened = service.attach('one', 'doc', notify);
  service.remove(owner, 'one', 'doc', 'wrong-epoch');
  expect(service.read(reopened.connectionId).regions).toEqual(selection.regions);
  service.remove(owner, 'one', 'doc', 'epoch');
  expect(notify.mock.lastCall?.[0].type).toBe('canvas.closed');
  expect(() => service.read(reopened.connectionId)).toThrow('canvas.closed');
});


it('sends only changed regions, preserves independent readers, and rejects gaps without changing state', () => {
  const service = new LiveCanvasService(() => [{ canvasId: 'one', documents: [] }]);
  const owner = {}, notify = vi.fn(), other = vi.fn();
  service.publish(owner, 'one'); service.update(owner, 'one', selection);
  const bound = service.attach('one', 'doc', notify);
  const b = { ...region, id: 'b', text: 'Second region' };
  service.update(owner, 'one', { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 3, sequence: 2, baseSequence: 1, upserted: [b], removed: [] });
  expect(notify.mock.lastCall?.[0]).toMatchObject({ upserted: [b], removed: [], baseSequence: 1, sequence: 2 });
  expect(notify.mock.lastCall?.[0]).not.toHaveProperty('regions');
  const late = service.attach('one', 'doc', other);
  expect(late.regions).toEqual([region, b]);
  expect(() => service.update(owner, 'one', { ...selection, regions: [region, region], sequence: 3 })).toThrow('unique IDs');
  const delta = { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 4, sequence: 3, baseSequence: 1, upserted: [], removed: ['a'] };
  expect(() => service.update(owner, 'one', delta)).toThrow('Reconnect');
  expect(service.read(bound.connectionId).regions).toEqual([region, b]);
  service.update(owner, 'one', { ...delta, baseSequence: 2 });
  expect(notify.mock.lastCall?.[0]).toMatchObject({ upserted: [], removed: ['a'] });
  expect(other.mock.lastCall?.[0]).toMatchObject({ upserted: [], removed: ['a'] });
  expect(service.read(late.connectionId).regions).toEqual([b]);
});


it('reports live agent counts to the owning workspace and excludes invalidated bindings', () => {
  const service = new LiveCanvasService(() => ['one', 'two'].map(canvasId => ({ canvasId, documents: [] })));
  const owner = {}, other = {}, presence = vi.fn(), otherPresence = vi.fn();
  service.publish(owner, 'one', presence); service.publish(other, 'two', otherPresence);
  service.update(owner, 'one', selection); service.update(other, 'two', selection);
  service.update(owner, 'one', { ...selection, documentId: 'second-doc' });
  const a = service.attach('one', 'doc', vi.fn());
  expect(presence.mock.lastCall?.[0]).toEqual({ type: 'agents.changed', count: 1 });
  const b = service.attach('one', 'second-doc', vi.fn());
  expect(presence.mock.lastCall?.[0]).toEqual({ type: 'agents.changed', count: 2 });
  service.attach('two', 'doc', vi.fn());
  expect(otherPresence.mock.lastCall?.[0]).toEqual({ type: 'agents.changed', count: 1 });
  expect(presence).toHaveBeenCalledTimes(2);
  service.detach(a.connectionId);
  expect(presence.mock.lastCall?.[0]).toEqual({ type: 'agents.changed', count: 1 });
  service.remove(owner, 'one', 'second-doc', 'epoch');
  expect(presence.mock.lastCall?.[0]).toEqual({ type: 'agents.changed', count: 0 });
  const count = presence.mock.calls.length;
  service.detach(b.connectionId);
  expect(presence).toHaveBeenCalledTimes(count);
  service.attach('one', 'doc', vi.fn());
  service.update(owner, 'one', { ...selection, canvasEpoch: 'replacement' });
  expect(presence.mock.lastCall?.[0]).toEqual({ type: 'agents.changed', count: 0 });
});

it('reads fresh coherent context independently of selection version and rejects detached bindings', async () => {
  let version = 10;
  const load = vi.fn(async () => ({ version: version++, name: 'Canvas', nodes: [], edges: [] }));
  const service = new LiveCanvasService(() => [{ canvasId: 'one', documents: [] }], load);
  const owner = {};
  service.publish(owner, 'one'); service.update(owner, 'one', selection);
  const bound = service.attach('one', 'doc', vi.fn());
  expect(await service.context(bound.connectionId)).toMatchObject({ ...boundIdentity(bound), context: { version: 10 } });
  expect(await service.context(bound.connectionId)).toMatchObject({ context: { version: 11 } });
  expect(load).toHaveBeenLastCalledWith('one', 'doc');
  expect(service.read(bound.connectionId).documentVersion).toBe(3);
  service.detach(bound.connectionId);
  await expect(service.context(bound.connectionId)).rejects.toThrow('CONNECTION_NOT_FOUND');
});

function boundIdentity(bound: { connectionId: string; workspaceInstanceId: string; documentId: string; canvasEpoch: string }) {
  return { connectionId: bound.connectionId, workspaceInstanceId: bound.workspaceInstanceId, documentId: bound.documentId, canvasEpoch: bound.canvasEpoch };
}

it.each(['replace', 'disconnect', 'detach'] as const)('rejects context completed after %s', async action => {
  let resolve!: (value: { version: number; nodes: []; edges: [] }) => void;
  const pending = new Promise<{ version: number; nodes: []; edges: [] }>(done => { resolve = done; });
  const service = new LiveCanvasService(() => [{ canvasId: 'one', documents: [] }], () => pending);
  const owner = {};
  service.publish(owner, 'one'); service.update(owner, 'one', selection);
  const bound = service.attach('one', 'doc', vi.fn());
  const context = service.context(bound.connectionId);
  const rejected = expect(context).rejects.toThrow(action === 'detach' ? 'CONNECTION_NOT_FOUND' : 'changed identity');
  if (action === 'replace') service.update(owner, 'one', { ...selection, canvasEpoch: 'next', sequence: 0 });
  else if (action === 'disconnect') service.disconnect(owner, 'one');
  else service.detach(bound.connectionId);
  resolve({ version: 4, nodes: [], edges: [] });
  await rejected;
});


it('distinguishes a vanished browser instance from publisher startup', async () => {
  let canvases: { canvasId: string; documents: [] }[] = [];
  const service = new LiveCanvasService(() => canvases);
  await expect(service.contextForCanvas('old', 'doc')).rejects.toMatchObject({ code: 'CANVAS_NOT_READY' });
  canvases = [{ canvasId: 'old', documents: [] }];
  await expect(service.contextForCanvas('old', 'doc')).rejects.toMatchObject({ code: 'CANVAS_NOT_READY' });
  canvases = [{ canvasId: 'new', documents: [] }];
  await expect(service.contextForCanvas('old', 'doc')).rejects.toMatchObject({ code: 'CANVAS_INSTANCE_GONE' });
});

it('applies diagram promotion and region removals atomically and retains diagram IDs across region-only deltas', () => {
  const service = new LiveCanvasService(() => [{ canvasId: 'one', documents: [] }]);
  const owner = {}, notify = vi.fn();
  service.publish(owner, 'one'); service.update(owner, 'one', selection);
  const bound = service.attach('one', 'doc', notify);
  const diagramId = `grid:${region.sourceBoxId}`;
  const delta = { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 3, sequence: 2, baseSequence: 1,
    diagramIds: [diagramId], removed: ['a'], upserted: [] };
  expect(() => service.update(owner, 'one', { ...delta, removed: [] })).toThrow('Whole diagrams replace their regions');
  expect(service.read(bound.connectionId).regions).toEqual([region]);
  service.update(owner, 'one', delta);
  expect(notify.mock.lastCall![0]).toMatchObject({ diagramIds: [diagramId], removed: ['a'], upserted: [] });
  expect(service.read(bound.connectionId)).toMatchObject({ regions: [], diagramIds: [diagramId] });
  const other = { ...region, id: 'other', sourceBoxId: 'other-box' };
  service.update(owner, 'one', { ...delta, baseSequence: 2, sequence: 3, diagramIds: undefined, removed: [], upserted: [other] });
  expect(service.read(bound.connectionId)).toMatchObject({ regions: [other], diagramIds: [diagramId] });
  expect(notify.mock.lastCall![0]).not.toHaveProperty('diagramIds');
  service.update(owner, 'one', { ...delta, baseSequence: 3, sequence: 4, diagramIds: [], removed: ['other'] });
  expect(service.read(bound.connectionId)).toMatchObject({ regions: [], diagramIds: [] });
});
