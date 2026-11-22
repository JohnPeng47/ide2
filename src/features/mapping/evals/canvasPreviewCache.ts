import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import { readGenerated } from './evalsApi';

// Only pinned snapshots are reusable. Keep a small working set and coalesce prefetch/read races.
const copies = new Map<string, { promise: Promise<CompareCanvasCopy>; value?: CompareCanvasCopy }>();
const keyOf = (id: string, checkpoint: string) => JSON.stringify([id, checkpoint]);
export const peekCanvasPreview = (id: string, checkpoint?: string) => checkpoint ? copies.get(keyOf(id, checkpoint))?.value : undefined;
export function loadCanvasPreview(id: string, checkpoint?: string, output?: { runId: string; cellKey: string }): Promise<CompareCanvasCopy> {
  const key = checkpoint && keyOf(id, checkpoint), cached = key && copies.get(key);
  if (cached) { copies.delete(key!); copies.set(key!, cached); return cached.promise; }
  const entry: { promise: Promise<CompareCanvasCopy>; value?: CompareCanvasCopy } = { promise: readGenerated(id, checkpoint, output).then(canvas => {
    const head = checkpoint ?? canvas.history.headId, at = new Date().toISOString();
    if (!canvas.history.snapshots[head]) throw Error('The pinned output snapshot is unavailable.');
    return entry.value = { id, source: { documentId: id, checkpointId: head }, canvasName: canvas.generated.contextName,
      history: { ...canvas.history, headId: head }, generated: canvas.generated,
      view: { id, name: canvas.name, createdAt: at, savedAt: at, startCheckpointId: head, finalCheckpointId: head, checkpointIds: [head] } };
  }).catch(error => { if (key && copies.get(key) === entry) copies.delete(key); throw error; }) };
  if (key) { copies.set(key, entry); while (copies.size > 12) copies.delete(copies.keys().next().value!); }
  return entry.promise;
}
