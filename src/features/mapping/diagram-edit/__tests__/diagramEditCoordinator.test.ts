import { afterEach, expect, it, vi } from 'vitest';
import type { DiagramEditRun } from '../../../../../domain/mapping/agent/diagramEdit';
import { DiagramEditCoordinator, editTargetKey } from '../diagramEditCoordinator';

const target = { canvasId: 'canvas', documentId: 'doc', nodeId: 'grid:first', label: 'First' };
const key = editTargetKey(target);
const run = (status: DiagramEditRun['status'] = 'generating'): DiagramEditRun => ({ runId: 'run', status, nodeId: target.nodeId, baseRevisionId: 'base' });
const coordinators: DiagramEditCoordinator[] = [];
function fixture() {
  const client = { capture: vi.fn(async () => ({ sessionId: 'attached', expectedVersion: 3, baseRevisionId: 'base' })),
    start: vi.fn(async () => run()), status: vi.fn(async () => run('completed')), cancel: vi.fn(async () => run('cancelled')) };
  const coordinator = new DiagramEditCoordinator(client, 10); coordinators.push(coordinator);
  coordinator.open(target); coordinator.setPrompt(key, 'Update first');
  return { client, coordinator, entry: () => coordinator.store.getState().entries[key] };
}
afterEach(() => { coordinators.splice(0).forEach(c => c.dispose()); vi.useRealTimers(); });
it('pins the target across opening another diagram and deduplicates double submits', async () => {
  const f = fixture();
  let finish!: (value: Awaited<ReturnType<typeof f.client.capture>>) => void;
  f.client.capture.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const submitting = f.coordinator.submit(key);
  await f.coordinator.submit(key);
  f.coordinator.open({ ...target, nodeId: 'grid:second', label: 'Second' });
  finish({ sessionId: 'attached', expectedVersion: 8, baseRevisionId: 'fresh' }); await submitting;
  expect(f.client.start).toHaveBeenCalledOnce();
  expect(f.client.start).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'grid:first', prompt: 'Update first', expectedVersion: 8, baseRevisionId: 'fresh' }));
  expect(f.coordinator.store.getState().activeKey).toBe(editTargetKey({ ...target, nodeId: 'grid:second' }));
});
it('retains the exact request after a lost start response', async () => {
  const f = fixture(); f.client.start.mockRejectedValueOnce(Error('Network lost'));
  await f.coordinator.submit(key);
  expect(f.entry().request).toBeDefined();
  f.coordinator.setPrompt(key, 'must not change');
  expect(f.entry().prompt).toBe('Update first');
  await f.coordinator.retry(key);
  expect(f.client.capture).toHaveBeenCalledOnce();
  expect(f.client.start.mock.calls[1]).toEqual(f.client.start.mock.calls[0]);
});
it('polls after the composer closes and retries persistence with the original request', async () => {
  vi.useFakeTimers(); const f = fixture(); f.client.status.mockResolvedValueOnce(run('awaiting-acknowledgement'));
  await f.coordinator.submit(key); f.coordinator.close();
  await vi.advanceTimersByTimeAsync(10);
  expect(f.entry().run?.status).toBe('awaiting-acknowledgement');
  expect(f.coordinator.store.getState().activeKey).toBeUndefined();
  f.client.start.mockResolvedValueOnce(run('completed')); await f.coordinator.retry(key);
  expect(f.client.start.mock.calls[1]).toEqual(f.client.start.mock.calls[0]);
  expect(f.entry().run?.status).toBe('completed');
});
it('preserves the prompt on conflict and explicitly captures a new base for resubmission', async () => {
  const f = fixture(); f.client.start.mockResolvedValueOnce(run('conflict'));
  await f.coordinator.submit(key); const previous = f.entry().request;
  expect(f.entry().prompt).toBe('Update first');
  f.client.capture.mockResolvedValueOnce({ sessionId: 'attached', expectedVersion: 4, baseRevisionId: 'next' });
  await f.coordinator.submit(key);
  expect(f.entry().request).toMatchObject({ expectedVersion: 4, baseRevisionId: 'next', prompt: 'Update first' });
  expect(f.entry().request?.requestId).not.toBe(previous?.requestId);
});
it('does not let a stale poll overwrite a cancellation response', async () => {
  const f = fixture(); await f.coordinator.submit(key);
  let finish!: (value: DiagramEditRun) => void;
  f.client.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const polling = f.coordinator.refresh(key); await f.coordinator.cancel(key);
  finish(run()); await polling;
  expect(f.entry().run?.status).toBe('cancelled');
});
it('retries status reads without starting another generation', async () => {
  const f = fixture(); await f.coordinator.submit(key);
  f.client.status.mockRejectedValueOnce(Error('offline')); await f.coordinator.refresh(key);
  expect(f.entry().error).toContain('offline');
  await f.coordinator.retry(key);
  expect(f.entry().run?.status).toBe('completed'); expect(f.client.start).toHaveBeenCalledOnce();
});
it('discards an unsubmitted prompt on close without leaving an entry to reopen', () => {
  const f = fixture(); f.coordinator.close();
  expect(f.coordinator.store.getState()).toEqual({ entries: {}, activeKey: undefined });
  expect(f.client.capture).not.toHaveBeenCalled(); expect(f.client.start).not.toHaveBeenCalled();
  f.coordinator.open(target); expect(f.entry().prompt).toBe('');
});
it('dismisses completed updates but preserves requests with an unknown outcome', async () => {
  const f = fixture(); f.client.start.mockResolvedValueOnce(run('completed'));
  await f.coordinator.submit(key); f.coordinator.close(); expect(f.entry()).toBeUndefined();
  f.coordinator.open(target); f.coordinator.setPrompt(key, 'Another edit');
  f.client.start.mockRejectedValueOnce(Error('response lost')); await f.coordinator.submit(key);
  f.coordinator.close(); f.coordinator.dismiss(key);
  expect(f.entry().request).toBeDefined();
});
it('does not resurrect a dismissed cancelled run when a stale status read completes', async () => {
  const f = fixture(); await f.coordinator.submit(key);
  let finish!: (value: DiagramEditRun) => void;
  f.client.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const polling = f.coordinator.refresh(key); await f.coordinator.cancel(key);
  f.coordinator.close(); finish(run()); await polling;
  expect(f.entry()).toBeUndefined();
});
