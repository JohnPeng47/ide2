import { afterEach, expect, it, vi } from 'vitest';
import { LiveCanvasService } from '../liveCanvasService';
import type { LiveCanvasEvent, LiveCopyCommand } from '../../../../domain/mapping/agent/liveCanvasStatus';

afterEach(() => vi.useRealTimers());
function fixture(capabilities: string[] = ['diagram.copy']) {
  const service = new LiveCanvasService(() => [{ canvasId: 'workspace', documents: [] }]);
  const owner = {}, frames: LiveCanvasEvent[] = [];
  service.publish(owner, 'workspace', event => frames.push(event), capabilities);
  service.update(owner, 'workspace', { documentId: 'doc', canvasEpoch: 'epoch', sequence: 0, documentVersion: 5, regions: [] });
  const { connectionId } = service.attach('workspace', 'doc', () => {});
  const command = () => frames.filter((frame): frame is LiveCopyCommand => frame.type === 'diagram.copy.command').at(-1)!;
  return { service, owner, frames, connectionId, command };
}
const request = { type: 'diagram.copy' as const, requestId: 'copy-1', text: 'Root\n|-- Child\n`-- Tail  ' };

it.each([{ capabilities: [] }, { capabilities: ['some.future.feature'] }])('rejects unsupported publishers immediately without commands or losing selection ($capabilities)', async ({ capabilities }) => {
  vi.useFakeTimers();
  const f = fixture(capabilities);
  await expect(f.service.copy(f.connectionId, request)).rejects.toMatchObject({ code: 'COPY_UNSUPPORTED', message: expect.stringContaining('Reload the canvas tab') });
  expect(f.command()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  f.service.update(f.owner, 'workspace', { documentId: 'doc', canvasEpoch: 'epoch', sequence: 1, documentVersion: 6, regions: [] });
  expect(f.service.read(f.connectionId)).toMatchObject({ sequence: 1, documentVersion: 6 });
});

it('waits for browser staging, retains exact text, and coalesces identical retries', async () => {
  const f = fixture();
  let settled = false;
  const first = f.service.copy(f.connectionId, request).then(result => { settled = true; return result; });
  const retry = f.service.copy(f.connectionId, request);
  await Promise.resolve(); expect(settled).toBe(false);
  expect(f.command()).toMatchObject({ ascii: request.text, documentId: 'doc', canvasEpoch: 'epoch' });
  expect(f.frames.filter(frame => frame.type === 'diagram.copy.command')).toHaveLength(1);
  expect(() => f.service.copyReply({}, 'workspace', { type: 'diagram.copy.reply', commandId: f.command().commandId, result: { ok: true } })).toThrow('PUBLISHER_UNAVAILABLE');
  f.service.copyReply(f.owner, 'workspace', { type: 'diagram.copy.reply', commandId: f.command().commandId, result: { ok: true } });
  expect(await first).toEqual(await retry);
  expect(await first).toMatchObject({ type: 'diagram.copied', requestId: request.requestId, connectionId: f.connectionId });
  await f.service.copy(f.connectionId, request);
  expect(f.frames.filter(frame => frame.type === 'diagram.copy.command')).toHaveLength(1);
  await expect(f.service.copy(f.connectionId, { ...request, text: 'Different' })).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' });
});

it('retries timed-out staging with the same browser command and rejects replaced canvases', async () => {
  vi.useFakeTimers(); const f = fixture();
  const first = expect(f.service.copy(f.connectionId, request)).rejects.toMatchObject({ code: 'CANVAS_TIMEOUT' });
  const id = f.command().commandId;
  await vi.advanceTimersByTimeAsync(25000); await first;
  const retry = expect(f.service.copy(f.connectionId, request)).rejects.toMatchObject({ code: 'canvas.replaced' });
  expect(f.command().commandId).toBe(id);
  f.service.update(f.owner, 'workspace', { documentId: 'doc', canvasEpoch: 'next', sequence: 0, documentVersion: 0, regions: [] });
  await retry;
});

it('rejects invalid diagrams and propagates browser failure without dropping the reader', async () => {
  const f = fixture();
  await expect(f.service.copy(f.connectionId, { ...request, text: '─' })).rejects.toMatchObject({ code: 'INVALID_DIAGRAM' });
  await expect(f.service.copy(f.connectionId, { ...request, text: 'x'.repeat(20001) })).rejects.toMatchObject({ code: 'INVALID_DIAGRAM' });
  const result = expect(f.service.copy(f.connectionId, request)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
  f.service.copyReply(f.owner, 'workspace', { type: 'diagram.copy.reply', commandId: f.command().commandId,
    result: { ok: false, code: 'WORKSPACE_BUSY', error: 'Canvas busy' } });
  await result;
  expect(f.service.read(f.connectionId).documentVersion).toBe(5);
});
