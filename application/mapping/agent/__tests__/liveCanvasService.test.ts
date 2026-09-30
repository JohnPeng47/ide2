import { expect, it, vi } from 'vitest';
import { LiveCanvasService } from '../liveCanvasService';
const selection = { documentId: 'doc', canvasEpoch: 'epoch', documentVersion: 3, sequence: 1, text: 'Selected ASCII' };

it('binds to an exact workspace/document; ignores old frames and isolates readers', () => {
  const list = vi.fn(() => ['one', 'two'].map(canvasId => ({ canvasId, documents: [{ documentId: 'doc', name: 'Test' }] })));
  const service = new LiveCanvasService(list), a = {}, b = {}, notify = vi.fn();
  service.publish(a, 'one'); service.publish(b, 'two');
  expect(() => service.attach('one', 'doc', notify)).toThrow('not published');
  service.update(a, 'one', selection); service.update(b, 'two', { ...selection, text: 'Other tab' });
  const bound = service.attach('one', 'doc', notify);
  service.update(b, 'two', { ...selection, sequence: 2, text: 'Other selection' });
  service.update(a, 'one', { ...selection, sequence: 0, text: 'Out of order' });
  expect(notify).not.toHaveBeenCalled();
  list.mockClear();
  for (let i = 0; i < 1000; i++) expect(service.read(bound.connectionId).text).toBe(selection.text);
  expect(list).not.toHaveBeenCalled(); // Cached GET cannot touch the browser bridge.
  service.update(a, 'one', { ...selection, sequence: 2, text: null });
  expect(notify.mock.lastCall?.[0]).toMatchObject({ type: 'selection.changed', text: null, sequence: 2 });
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
  expect(service.read(reopened.connectionId).text).toBe(selection.text);
  service.remove(owner, 'one', 'doc', 'epoch');
  expect(notify.mock.lastCall?.[0].type).toBe('canvas.closed');
  expect(() => service.read(reopened.connectionId)).toThrow('canvas.closed');
});
