import path from 'node:path';
import { readFile, mkdir, open, rm } from 'node:fs/promises';
import { ImmutableRecords, publishJson } from '../../core/persistence/immutableRecords';
import { CanvasCheckpointEncoder, loadCanvasCheckpoint, restoreCanvasCheckpoints, type CanvasStoredItem, type PersistedCanvasCheckpoint } from '../../../domain/core/diagrams/canvasCheckpointRecords';
import { checkpointRevisionIds, documentFromHistory, stateKey, validateCanvasHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import type { HistoryCanvasRef, HistoryStep } from '../../../domain/mapping/history/diagramHistory';
import type { EvalOutputResult } from '../../../domain/mapping/evals/evalOutputResult';
import type { MappingCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { placementSnapshot } from '../../../domain/core/diagrams/diagramPlacement';

interface DocumentIndex { checkpoints: Record<string, string>; items: Record<string, string>; revisions: Record<string, string>; views: NonNullable<CanvasHistoryRecord['canvasViews']>['saved']; revisionBoundary?: Record<string, string> }

/** Legacy timelines omitted this header. Recover the same explicit external-parent
 * boundary used by frozen previews, checking that each parent has one owner. */
function legacyRevisionBoundary(revisions: CanvasHistoryRecord['diagramRevisions']) {
  const boundary: Record<string, string> = {};
  for (const revision of Object.values(revisions)) if (revision.parentId && !revisions[revision.parentId]) {
    if (boundary[revision.parentId] && boundary[revision.parentId] !== revision.diagramId) throw Error('Conflicting diagram revision boundary');
    boundary[revision.parentId] = revision.diagramId;
  }
  return boundary;
}
export interface CanvasTimeline { id: string; projectId: string; revision: number; steps: HistoryStep[]; documents: Record<string, DocumentIndex> }
/** One manifest publishes a complete canvas set. Payloads are immutable shared records. */
export class FileCanvasTimeline {
  private records: ImmutableRecords;
  private encoders = new Map<string, CanvasCheckpointEncoder>();
  constructor(private root: string) { this.records = new ImmutableRecords(path.join(root, 'canvas-timelines', 'records')); }
  private file(id: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id)) throw Error('Invalid timeline ID');
    return path.join(this.root, 'canvas-timelines', `${id}.json`);
  }
  async read(id: string): Promise<CanvasTimeline> { return JSON.parse(await readFile(this.file(id), 'utf8')); }
  async append(id: string, projectId: string, expectedRevision: number, step: HistoryStep, histories: Record<string, CanvasHistoryRecord>) {
    const lock = this.file(id) + '.lock';
    await mkdir(path.dirname(lock), { recursive: true });
    let owner;
    try { owner = await open(lock, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let pid: number | undefined;
      try { pid = JSON.parse(await readFile(lock, 'utf8')).pid; } catch { /* An active writer may still be publishing its owner. */ }
      let dead = false;
      if (pid) try { process.kill(pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
      if (!dead) throw Error('TIMELINE_BUSY: another writer owns this timeline');
      await rm(lock); owner = await open(lock, 'wx');
    }
    await owner.writeFile(JSON.stringify({ pid: process.pid }));
    try { return await this.appendLocked(id, projectId, expectedRevision, step, histories); }
    finally { await owner.close(); await rm(lock, { force: true }); }
  }
  private async appendLocked(id: string, projectId: string, expectedRevision: number, step: HistoryStep, histories: Record<string, CanvasHistoryRecord>) {
    let current: CanvasTimeline;
    try { current = await this.read(id); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; current = { id, projectId, revision: 0, steps: [], documents: {} }; }
    if (current.projectId !== projectId) throw Error('Timeline belongs to another project');
    const previous = current.steps.find(s => s.id === step.id);
    if (previous) { if (JSON.stringify(previous) !== JSON.stringify(step)) throw Error('STEP_CONFLICT'); return current; }
    if (current.revision !== expectedRevision) throw Error('VERSION_CONFLICT');
    if (step.previousStepId && !current.steps.some(s => s.id === step.previousStepId)) throw Error('Unknown previous step');
    if (new Set(step.canvases.map(c => c.documentId)).size !== step.canvases.length) throw Error('Duplicate canvas in step');
    const documents = structuredClone(current.documents);
    for (const [documentId, history] of Object.entries(histories)) {
      validateCanvasHistory(history);
      const key = `${id}/${documentId}`, encoder = this.encoders.get(key) ?? new CanvasCheckpointEncoder(); this.encoders.set(key, encoder);
      const data = encoder.encode(history.snapshots, true, history.headId);
      const index = documents[documentId] ??= { checkpoints: {}, items: {}, revisions: {}, views: {} };
      // Preserve the boundary of a deliberately cropped baseline through editing.
      for (const [parent, diagram] of Object.entries(history.revisionBoundary ?? {})) {
        if (index.revisionBoundary?.[parent] && index.revisionBoundary[parent] !== diagram) throw Error('Conflicting diagram revision boundary');
      }
      index.revisionBoundary = { ...index.revisionBoundary, ...history.revisionBoundary };
      // Bounded writes also avoid opening thousands of files for a large baseline.
      for (const [key, value] of Object.entries(data.items)) index.items[key] = await this.records.put(value);
      for (const [key, value] of Object.entries(data.checkpoints)) {
        if (index.checkpoints[key]) {
          const old = await this.records.get<PersistedCanvasCheckpoint>(index.checkpoints[key]);
          if (JSON.stringify(old) !== JSON.stringify(value)) {
            const restored = await loadCanvasCheckpoint(key, k => this.records.get<PersistedCanvasCheckpoint>(index.checkpoints[k]), k => this.records.get<CanvasStoredItem>(index.items[k]));
            const { transactionId: _old, ...before } = restored, { transactionId: _new, ...after } = history.snapshots[key];
            if (stateKey(before) !== stateKey(after)) throw Error('Immutable checkpoint changed');
          }
          continue;
        }
        index.checkpoints[key] = await this.records.put(value);
      }
      for (const [key, value] of Object.entries(history.diagramRevisions)) {
        const ref = await this.records.put(value);
        if (index.revisions[key] && index.revisions[key] !== ref) throw Error('Immutable revision changed');
        index.revisions[key] = ref;
      }
      for (const [viewId, view] of Object.entries(history.canvasViews?.saved ?? {})) {
        if (index.views[viewId] && JSON.stringify(index.views[viewId]) !== JSON.stringify(view)) throw Error('Saved timeline view changed; fork a new view');
        index.views[viewId] = view;
      }
    }
    for (const c of step.canvases) {
      const doc = documents[c.documentId], view = doc?.views[c.viewId];
      if (!doc?.checkpoints[c.checkpointId] || !view || !view.checkpointIds.includes(c.checkpointId)) throw Error('Unpersisted step reference');
    }
    const next = { ...current, revision: current.revision + 1, documents, steps: [...current.steps, structuredClone(step)] };
    await publishJson(this.file(id), next); return next;
  }
  async canvas(id: string, ref: HistoryCanvasRef, index?: CanvasTimeline): Promise<CanvasHistoryRecord> {
    const timeline = index ?? await this.read(id), doc = timeline.documents[ref.documentId];
    if (!doc || !doc.views[ref.viewId]?.checkpointIds.includes(ref.checkpointId)) throw Error('Unknown pinned view');
    const checkpoint = await loadCanvasCheckpoint(ref.checkpointId,
      key => this.records.get<PersistedCanvasCheckpoint>(doc.checkpoints[key]), key => this.records.get<CanvasStoredItem>(doc.items[key]));
    const revisions: CanvasHistoryRecord['diagramRevisions'] = Object.fromEntries(await Promise.all(checkpointRevisionIds(checkpoint).map(async key => [key, await this.records.get<CanvasHistoryRecord['diagramRevisions'][string]>(doc.revisions[key])])));
    // A read is a self-contained frozen endpoint, never a replay of prior mutations.
    return { schemaVersion: 1, contextId: `${id}-${ref.documentId}`, baselineId: checkpoint.id, headId: checkpoint.id, past: [], future: [],
      snapshots: { [checkpoint.id]: { ...checkpoint, parentId: undefined } }, diagramRevisions: revisions,
      revisionBoundary: Object.fromEntries(Object.values(revisions).flatMap(r => r.parentId && !revisions[r.parentId] ? [[r.parentId, r.diagramId]] : [])) };
  }
  /** Editing/recovery needs the retained view ancestry; previews use canvas() above. */
  async editingHistory(id: string, ref: HistoryCanvasRef): Promise<CanvasHistoryRecord> {
    const index = (await this.read(id)).documents[ref.documentId];
    if (!index?.views[ref.viewId]?.checkpointIds.includes(ref.checkpointId)) throw Error('Unknown pinned view');
    const read = async <T>(refs: Record<string, string>) => Object.fromEntries(await Promise.all(Object.entries(refs).map(async ([key, value]) => [key, await this.records.get<T>(value)])));
    const snapshots = restoreCanvasCheckpoints(await read<PersistedCanvasCheckpoint>(index.checkpoints), await read<CanvasStoredItem>(index.items));
    const revisions = await read<CanvasHistoryRecord['diagramRevisions'][string]>(index.revisions);
    const history: CanvasHistoryRecord = { schemaVersion: 1, contextId: `${id}-${ref.documentId}`, baselineId: ref.checkpointId, headId: ref.checkpointId,
      past: [], future: [], snapshots, diagramRevisions: revisions,
      revisionBoundary: index.revisionBoundary ?? legacyRevisionBoundary(revisions),
      canvasViews: { saved: structuredClone(index.views), activeViewId: ref.viewId } };
    validateCanvasHistory(history);
    return history;
  }
  async result(id: string, stepId: string): Promise<EvalOutputResult> {
    const timeline = await this.read(id), step = timeline.steps.find(s => s.id === stepId);
    if (!step) throw Error('Unknown history step');
    const result: EvalOutputResult = { schemaVersion: 1, canvases: [], diagramRevisions: {} };
    for (const ref of step.canvases) {
      const history = await this.canvas(id, ref, timeline), document = documentFromHistory(history);
      Object.assign(result.diagramRevisions, history.diagramRevisions);
      result.canvases.push({ id: ref.documentId, name: ref.name, representationId: ref.documentId, baseline: null, version: 0,
        proposed: { document, canvas: history.snapshots[history.headId].view as MappingCanvasState } });
    }
    result.placementSnapshot = placementSnapshot(result.canvases.map(c => ({ id: c.id, scene: c.proposed.document.scene })));
    return result;
  }
}
