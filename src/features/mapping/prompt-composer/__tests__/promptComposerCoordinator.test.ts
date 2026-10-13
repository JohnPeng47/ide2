import { afterEach, expect, it, vi } from 'vitest';
import type { DiagramEditRun } from '../../../../../domain/mapping/agent/diagramEdit';
import { PromptComposerCoordinator, composerKey, type PromptComposerTarget } from '../promptComposerCoordinator';
import { serializePromptDraft, setBlockText, removeBlock } from '../promptDraft';

const target: PromptComposerTarget = { operation: 'edit-diagram', canvasId: 'canvas', documentId: 'doc', nodeId: 'grid:first', label: 'First', subtree: { contentNodeId: 'node', revisionId: 'content' } };
const key = composerKey(target);
const run = (status: DiagramEditRun['status'] = 'generating'): DiagramEditRun => ({ runId: 'run', operation: 'edit-diagram', status, nodeId: target.nodeId, baseRevisionId: 'base' });
const coordinators: PromptComposerCoordinator[] = [];
const setPrompt = (coordinator: PromptComposerCoordinator, key: string, text: string) =>
  coordinator.updateDraft(key, draft => setBlockText(draft, draft.body[0].id, text));
const promptOf = (coordinator: PromptComposerCoordinator, key: string) => serializePromptDraft(coordinator.store.getState().entries[key].draft).prompt;
function fixture() {
  const client = { capture: vi.fn(async () => ({ sessionId: 'attached', expectedVersion: 3, baseRevisionId: 'base' })),
    start: vi.fn(async (_input: object, _operation: string) => run()), status: vi.fn(async () => run('completed')), cancel: vi.fn(async () => run('cancelled')) };
  const coordinator = new PromptComposerCoordinator(client, 10); coordinators.push(coordinator);
  coordinator.open(target); setPrompt(coordinator, key, 'Update first');
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
  expect(f.client.start).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'grid:first', prompt: 'Update first', expectedVersion: 8, baseRevisionId: 'fresh' }), 'edit-diagram');
  expect(f.coordinator.store.getState().activeKey).toBe(composerKey({ ...target, nodeId: 'grid:second' }));
});
it('retains the exact request after a lost start response', async () => {
  const f = fixture(); f.client.start.mockRejectedValueOnce(Error('Network lost'));
  await f.coordinator.submit(key);
  expect(f.entry().request).toBeDefined();
  setPrompt(f.coordinator, key, 'must not change');
  expect(promptOf(f.coordinator, key)).toBe('Update first');
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
  expect(promptOf(f.coordinator, key)).toBe('Update first');
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
it('keeps drafts when the panel closes and restores them from Explorer', () => {
  const f = fixture(); f.coordinator.close();
  expect(f.coordinator.store.getState().activeKey).toBeUndefined();
  expect(promptOf(f.coordinator, key)).toBe('Update first');
  f.coordinator.show(key); expect(promptOf(f.coordinator, key)).toBe('Update first');
  f.coordinator.dismiss(key); expect(f.entry()).toBeUndefined();
});
it('dismisses completed updates but preserves requests with an unknown outcome', async () => {
  const f = fixture(); f.client.start.mockResolvedValueOnce(run('completed'));
  await f.coordinator.submit(key); f.coordinator.dismiss(key); expect(f.entry()).toBeUndefined();
  f.coordinator.open(target); setPrompt(f.coordinator, key, 'Another edit');
  f.client.start.mockRejectedValueOnce(Error('response lost')); await f.coordinator.submit(key);
  f.coordinator.close(); f.coordinator.dismiss(key);
  expect(f.entry().request).toBeDefined();
});
it('does not resurrect a dismissed cancelled run when a stale status read completes', async () => {
  const f = fixture(); await f.coordinator.submit(key);
  let finish!: (value: DiagramEditRun) => void;
  f.client.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const polling = f.coordinator.refresh(key); await f.coordinator.cancel(key);
  f.coordinator.dismiss(key); finish(run()); await polling;
  expect(f.entry()).toBeUndefined();
});
it('sends the structured draft and dispatches create-diagram with its count', async () => {
  const f = fixture(), reference = { kind: 'diagram' as const, label: 'Old', diagramId: 'diagram-1', revisionId: 'diagram-revision-1' };
  const createTarget = { ...target, operation: 'create-diagram' as const }, createKey = f.coordinator.open(createTarget);
  setPrompt(f.coordinator, createKey, 'Draw  again');
  f.coordinator.setCursor(createKey, { blockId: f.coordinator.store.getState().entries[createKey].draft.body[0].id, offset: 5 });
  expect(f.coordinator.insertReference(reference)).toBe(true);
  f.coordinator.updateDraft(createKey, draft => ({ ...draft, count: 3 }));
  await f.coordinator.submit(createKey);
  expect(f.client.start).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Draw [ref 1] again', references: [reference], count: 3,
    template: expect.objectContaining({ id: 'create-diagram/overview', version: 1 }) }), 'create-diagram');
  await f.coordinator.submit(key);
  expect(f.client.start.mock.calls[1][0]).not.toHaveProperty('count');
  expect(f.client.start.mock.calls[1][0]).not.toHaveProperty('references');
});
it('locks references and templates while a request is unsettled and clears a carried reference on close', async () => {
  const f = fixture(); f.client.start.mockResolvedValueOnce(run('generating'));
  await f.coordinator.submit(key);
  const reference = { kind: 'diagram' as const, label: 'Old', diagramId: 'diagram-1', revisionId: 'diagram-revision-1' };
  expect(f.coordinator.insertReference(reference, key)).toBe(false);
  f.coordinator.carry(reference); expect(f.coordinator.store.getState().carried).toEqual({ reference });
  f.coordinator.close();
  expect(f.coordinator.store.getState().carried).toBeUndefined();
  expect(f.entry()).toBeDefined();
});

const selectedReference = (nodeIds: string[]) => ({ kind: 'nodes' as const, label: 'Branch', diagramId: 'diagram', revisionId: 'revision',
  nodeIds, range: { startLine: 1, endLine: 7, startColumn: 1, endColumn: 30 } });
const referenceBlocks = (entry: ReturnType<typeof fixture>['entry']) => entry().draft.body.filter(block => block.kind === 'reference');

it('updates the same automatic reference block in place and submits only the current nodes', async () => {
  const f = fixture();
  f.coordinator.setCursor(key, { blockId: f.entry().draft.body[0].id, offset: 6 });
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: selectedReference(['root', 'child', 'leaf']) }]);
  const before = f.entry().draft, blockId = referenceBlocks(f.entry)[0].id;
  const prompt = serializePromptDraft(before).prompt;
  const reduced = selectedReference(['root', 'child']);
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: reduced }]);
  expect(referenceBlocks(f.entry)).toEqual([{ kind: 'reference', id: blockId, reference: reduced }]);
  expect(f.entry().draft.body.map(block => block.id)).toEqual(before.body.map(block => block.id));
  expect(promptOf(f.coordinator, key)).toBe(prompt);
  await f.coordinator.submit(key);
  expect(f.client.start).toHaveBeenCalledWith(expect.objectContaining({ references: [reduced], prompt }), 'edit-diagram');
});

it('removes deselected automatic references, preserves manual references and restores one chip on undo', () => {
  const f = fixture(), manual = selectedReference(['manual']);
  f.coordinator.insertReference(manual);
  const manualId = referenceBlocks(f.entry)[0].id;
  const selected = [{ id: 'selection', reference: selectedReference(['root', 'child']) }];
  f.coordinator.syncSelections('doc', selected);
  f.coordinator.syncSelections('doc', []);
  expect(referenceBlocks(f.entry)).toEqual([{ kind: 'reference', id: manualId, reference: manual }]);
  f.coordinator.syncSelections('doc', selected);
  f.coordinator.syncSelections('doc', selected);
  expect(referenceBlocks(f.entry)).toHaveLength(2);
  expect(serializePromptDraft(f.entry().draft).references).toEqual([manual, selected[0].reference]);
});

it('does not reinsert a manually dismissed automatic chip while its selection remains active', () => {
  const f = fixture();
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: selectedReference(['root', 'child']) }]);
  const blockId = referenceBlocks(f.entry)[0].id;
  f.coordinator.updateDraft(key, draft => removeBlock(draft, blockId));
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: selectedReference(['root']) }]);
  expect(referenceBlocks(f.entry)).toHaveLength(0);
  f.coordinator.syncSelections('doc', []);
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: selectedReference(['root']) }]);
  expect(referenceBlocks(f.entry)).toHaveLength(1);
});

it('isolates selection references between documents and composer sessions', () => {
  const f = fixture(), selection = { id: 'selection', reference: selectedReference(['root', 'child']) };
  f.coordinator.syncSelections('doc', [selection]);
  f.coordinator.syncSelections('another-doc', []);
  expect(referenceBlocks(f.entry)).toHaveLength(1);
  const second = f.coordinator.open(target, true);
  f.coordinator.syncSelections('doc', [{ ...selection, reference: selectedReference(['root']) }]);
  expect(serializePromptDraft(f.coordinator.store.getState().entries[second].draft).references).toEqual([selectedReference(['root'])]);
  expect(serializePromptDraft(f.entry().draft).references).toEqual([selection.reference]);
});

it('freezes the submitted references during generation and ambiguous-response retries', async () => {
  const f = fixture(), original = selectedReference(['root', 'child']);
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: original }]);
  f.client.start.mockRejectedValueOnce(Error('response lost'));
  await f.coordinator.submit(key);
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference: selectedReference(['root']) }]);
  expect(serializePromptDraft(f.entry().draft).references).toEqual([original]);
  await f.coordinator.retry(key);
  expect(f.client.start.mock.calls[1]).toEqual(f.client.start.mock.calls[0]);
});

it('keeps the pinned snapshot of a still-selected stale region until that selection is cleared', () => {
  const f = fixture(), reference = selectedReference(['root', 'child']);
  f.coordinator.syncSelections('doc', [{ id: 'selection', reference }]);
  const before = f.entry().draft;
  f.coordinator.syncSelections('doc', [{ id: 'selection' }]);
  expect(f.entry().draft).toBe(before);
  f.coordinator.syncSelections('doc', []);
  expect(referenceBlocks(f.entry)).toHaveLength(0);
});
