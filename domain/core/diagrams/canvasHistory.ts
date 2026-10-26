import { migrateDiagramAlternatives, alternativeRevisionIds, validateDiagramAlternatives, type DiagramAlternatives } from '../presentation/diagramAlternative';
import { canvasViewAlternatives, withCanvasViewAlternatives } from '../presentation/canvasViewAlternatives';
import { diagramPresentationSettingsSchema } from '../presentation/diagramPresentation';
import type { DiagramPresentations } from '../presentation/diagramPresentation';
import { migrateRevisionSelections, validateRevisionSelections, type DiagramRevisionSelection } from './diagramRevisionSelection';
import { canvasViewCommandSchema, validateCanvasViews, type CanvasViewCommand, type CanvasViews, type CanvasViewState } from './canvasView';
import { canvasGenerationSchema, generationRunning, type CanvasGeneration } from './canvasGeneration';
import { validateRevisionReview, reviewRevisionIds, type DiagramRevisionReview } from './diagramRevisionReview';
import { deepFreeze } from '../immutability';
import { CanvasCheckpointEncoder, type CanvasCheckpointRecords } from './canvasCheckpointRecords';
import { diagramRevisions } from './internal/revisionRegistry';
import { validateDiagram, type Diagram } from './diagram';
import { validateDiagramAgentContext, type DiagramAgentContext } from './diagramAgentContext';
import { diagramContentNodes } from './diagramContentNodes';
import { correspondingNodes, DiagramRevisionEditor, type DiagramRevision } from './diagramRevisionEditor';
import type { LineGridScene } from './lineGrid';
import type { DiagramConnection, DiagramAnchor, ContentNodeAnchor } from './diagramConnection';
export interface ResolvedCanvasDocument { alternatives?: DiagramAlternatives; diagramPresentations?: DiagramPresentations; diagramContexts?: Record<string, DiagramAgentContext>; revisionSelections?: Record<string, DiagramRevisionSelection>; revisionReviews?: Record<string, DiagramRevisionReview>; scene: LineGridScene; edges: DiagramConnection[]; jumps?: CanvasJump[]; sections: Readonly<Record<string, readonly {id: string; label: string; startLine: number; endLine: number; anchorToken: string}[]>> }
import { projectCanvasSnapshot, validateCanvasScene } from './projectDiagramCanvas';
import { validateConnections } from './diagramConnection';
import { validateCanvasJumps, type CanvasJump } from './canvasJump';

export type CanvasNodeAnchor = Omit<ContentNodeAnchor, 'revisionId'>;
export type CanvasConnection = Omit<DiagramConnection, 'source' | 'target'> & {
  source: CanvasNodeAnchor;
  target: CanvasNodeAnchor | Extract<DiagramAnchor, {kind: 'box'}>;
};
/** Canonical canvas state separates diagram bindings from composition. Jump spans retain their source revision for stale-link detection. */
export interface CanvasDocument {
  alternatives?: DiagramAlternatives;
  diagramPresentations?: DiagramPresentations;
  diagramContexts?: Record<string, DiagramAgentContext>;
  revisionSelections?: Record<string, DiagramRevisionSelection>;
  revisionReviews?: Record<string, DiagramRevisionReview>;
  jumps?: CanvasJump[];
  scene: Pick<ResolvedCanvasDocument['scene'], 'root'>;
  edges: CanvasConnection[];
  sections: ResolvedCanvasDocument['sections'];
}
export interface StoredCanvasSnapshot {
  transactionId?: string;
  id: string;
  parentId?: string;
  document: CanvasDocument;
  diagramBindings: Record<string, string>;
  /** Personal view restoration is separate from canvas composition. */
  view: unknown;
  nodeOrigins: Record<string, string>;
  /** Legacy adapter only: preserve already-stale endpoints without guessing. */
  unresolvedAnchors?: Record<string, ContentNodeAnchor>;
}
export interface HistoryChanges {
  sequence: number;
  header: Omit<CanvasHistoryRecord, "snapshots" | "diagramRevisions">;
  snapshots: CanvasHistoryRecord["snapshots"];
  diagramRevisions: CanvasHistoryRecord["diagramRevisions"];
  storage?: CanvasCheckpointRecords;
}
export interface CanvasHistoryRecord {
  /** Named recordings belong to the canvas, outside the state restored by undo or applying a view. */
  canvasViews?: CanvasViews;
  schemaVersion: 1;
  contextId: string;
  baselineId: string;
  headId: string;
  past: string[];
  future: string[];
  snapshots: Record<string, StoredCanvasSnapshot>;
  diagramRevisions: Record<string, DiagramRevision>;
  /** An initial/current-only baseline pins parent identity without importing its ancestry. */
  revisionBoundary?: Record<string, string>;
}
export type CanvasHistoryNavigation = Pick<CanvasHistoryRecord, 'headId' | 'past' | 'future'> & {
  undoTransactionId?: string; redoTransactionId?: string;
};
export type HistoryValidation = 'all' | 'current';
export function currentHistoryChanges(record: CanvasHistoryRecord, snapshotId = record.headId) {
  const snapshot = record.snapshots?.[snapshotId];
  if (!snapshot) throw Error('Unknown canvas checkpoint');
  return { revisions: checkpointRevisionIds(snapshot), snapshots: [snapshotId] };
}
export function checkpointRevisionIds(snapshot: StoredCanvasSnapshot) {
  const document = migrateRevisionSelections(snapshot.document);
  return [...new Set([...Object.values(snapshot.diagramBindings), ...alternativeRevisionIds(document.alternatives), ...Object.values(document.revisionReviews ?? {}).flatMap(reviewRevisionIds),
    ...Object.values(document.revisionSelections ?? {}).flatMap(selection => [selection.revisionId, selection.baseRevisionId, selection.contextRevisionId].filter((id): id is string => !!id))])];
}
const id = (kind: string) => `${kind}-${crypto.randomUUID()}`;
export function stateKey(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
const equal = (a: unknown, b: unknown) => stateKey(a) === stateKey(b);

/** Shared by live controllers, MCP staging and persisted change-session copies. */
export class CanvasHistory {
  private record: CanvasHistoryRecord;
  private readonly validatedSnapshots = new Set<string>();
  private changes: { snapshots: CanvasHistoryRecord["snapshots"]; diagramRevisions: CanvasHistoryRecord["diagramRevisions"] }[] = [];
  private checkpointEncoder = new CanvasCheckpointEncoder();
  readonly diagrams: Pick<DiagramRevisionEditor, 'resolve' | 'merge'>;
  constructor(document: ResolvedCanvasDocument, view: unknown, record?: CanvasHistoryRecord, validation: HistoryValidation = 'all') {
    document = migrateRevisionSelections(document);
    if (record) {
      validateCanvasHistory(record, validation === 'current' ? currentHistoryChanges(record) : undefined);
      for (const revision of Object.values(record.diagramRevisions)) {
        if (validation === 'current') diagramRevisions.restore(revision); else diagramRevisions.register(revision);
      }
      for (const key of validation === 'current' ? [record.headId] : Object.keys(record.snapshots)) this.validatedSnapshots.add(key);
      this.record = structuredClone(record);
      document = migrateDiagramAlternatives(document, id => diagramRevisions.get(id), record.snapshots[record.headId].diagramBindings);
      if (!equal(this.document(), document)) throw new Error('Canvas history does not match document');
    } else {
      this.record = { schemaVersion: 1, contextId: id('context'), baselineId: '', headId: '', past: [], future: [], snapshots: {}, diagramRevisions: {} };
      this.append(document, view);
      this.record.baselineId = this.record.headId;
      this.record.past = [];
    }
    this.diagrams = new DiagramRevisionEditor(this.record.diagramRevisions, contextId => {
      if (contextId !== this.record.contextId) throw new Error('Unknown editing context');
      return this.head.diagramBindings;
    });
  }
  get headId() { return this.record.headId; }
  get contextId() { return this.record.contextId; }
  get head(): StoredCanvasSnapshot { return structuredClone(this.record.snapshots[this.record.headId]); }
  get canUndo() { return !!this.record.past.length; }
  get canRedo() { return !!this.record.future.length; }
  /** Trusted persistence adapter: records are immutable; only tables/navigation are copied. */
  persistenceChanges(since?: number): HistoryChanges {
    const { snapshots, diagramRevisions, ...header } = this.record;
    const updates = since === undefined ? { snapshots: { ...snapshots }, diagramRevisions: { ...diagramRevisions } }
      : this.changes.slice(since).reduce((out, change) => ({ snapshots: Object.assign(out.snapshots, change.snapshots),
        diagramRevisions: Object.assign(out.diagramRevisions, change.diagramRevisions) }), { snapshots: {}, diagramRevisions: {} });
    return { sequence: this.changes.length, header: { ...header, ...(header.canvasViews ? { canvasViews: structuredClone(header.canvasViews) } : {}), past: [...header.past], future: [...header.future] }, ...updates,
      storage: this.checkpointEncoder.encode(updates.snapshots, since === undefined, header.headId) };
  }
  export(currentOnly = false): CanvasHistoryRecord {
    // Named recordings pin their complete checkpoint/dependency graph during copies and exports.
    if (this.record.canvasViews && (Object.keys(this.record.canvasViews.saved).length || this.record.canvasViews.recording)) currentOnly = false;
    if (!currentOnly) return structuredClone(this.record);
    // Copy operations need current bindings, not the source's entire undo archive.
    // Keep the real head ID so workspace transfer boundaries still refer to it.
    const { parentId: _, ...head } = this.record.snapshots[this.record.headId];
    const revisions = Object.fromEntries(checkpointRevisionIds(head)
      .map(id => [id, this.record.diagramRevisions[id]]));
    const revisionBoundary = Object.fromEntries(Object.values(revisions).flatMap(revision =>
      revision.parentId && !revisions[revision.parentId] ? [[revision.parentId, revision.diagramId]] : []));
    return structuredClone({ schemaVersion: 1, contextId: this.record.contextId, baselineId: head.id, headId: head.id,
      past: [], future: [], snapshots: { [head.id]: head }, diagramRevisions: revisions, revisionBoundary });
  }
  navigation(): CanvasHistoryNavigation {
    return { headId: this.record.headId, past: [...this.record.past], future: [...this.record.future],
      undoTransactionId: this.navigationTransactionId(), redoTransactionId: this.navigationTransactionId(true) };
  }
  fork(view: unknown = this.head.view): CanvasHistoryRecord {
    const record = this.export(), head = this.head;
    if (record.canvasViews) delete record.canvasViews.recording;
    const baseline = { ...head, view: structuredClone(view), id: id('canvas-revision'), parentId: head.id, nodeOrigins: Object.fromEntries(
      Object.values(this.document().scene.contents).flatMap(diagram => diagramContentNodes(diagram.content).map(node => [node.id, node.id]))) };
    record.snapshots[baseline.id] = baseline;
    return { ...record, contextId: id('context'), headId: baseline.id, baselineId: baseline.id, past: [], future: [] };
  }
  /** Compatibility projection for existing rendering, source and MCP adapters. */
  document(snapshotId = this.record.headId): ResolvedCanvasDocument {
    this.validateCheckpoint(snapshotId);
    return documentFromHistory(this.record, snapshotId);
  }
  /** Read only the two pinned endpoints, without navigating or copying the undo archive. */
  canvasViewComparison(viewId: string): import('./canvasView').CanvasViewComparison {
    const view = this.record.canvasViews?.saved[viewId];
    if (!view?.finalCheckpointId) throw Error('Unknown saved CanvasView');
    const read = (checkpointId: string) => {
      const document = this.document(checkpointId), snapshot = this.record.snapshots[checkpointId];
      return { checkpointId, document, view: snapshot.view,
        revisions: Object.fromEntries(checkpointRevisionIds(snapshot).map(id => [id, this.record.diagramRevisions[id]])) };
    };
    return structuredClone({ view, baseline: read(view.startCheckpointId), proposed: read(view.finalCheckpointId) });
  }
  private validateCheckpoint(snapshotId: string) {
    if (this.validatedSnapshots.has(snapshotId)) return;
    validateCanvasHistory(this.record, currentHistoryChanges(this.record, snapshotId));
    this.validatedSnapshots.add(snapshotId);
  }

  append(document: ResolvedCanvasDocument, view: unknown, correspondence: ReadonlyMap<string, string> = new Map()): StoredCanvasSnapshot {
    projectCanvasSnapshot(document.scene);
    validateConnections(document.scene, document.edges);
    if (document.jumps) validateCanvasJumps(document.scene, document.jumps);
    for (const [diagramId, context] of Object.entries(document.diagramContexts ?? {})) {
      if (diagramId !== context.diagramId || !Object.values(document.scene.contents).some(diagram => diagram.diagramId === diagramId))
        throw Error('Diagram agent context has no owning diagram');
      validateDiagramAgentContext(context);
    }
    for (const settings of Object.values(document.diagramPresentations ?? {})) diagramPresentationSettingsSchema.parse(settings);
    const previous = this.record.snapshots[this.record.headId];
    const bindings: Record<string, string> = {}, additions: Record<string, DiagramRevision> = {}, origins: Record<string, string> = {};
    for (const [diagramId, diagram] of Object.entries(document.scene.contents)) {
      validateDiagram(diagram);
      const prior = previous && this.record.diagramRevisions[previous.diagramBindings[diagramId]];
      const same = prior && equal(prior.diagram, diagram);
      const map = prior ? new Map([...correspondingNodes(prior.diagram, diagram), ...correspondence]) : new Map<string, string>();
      const reverse = new Map([...map].map(([a, b]) => [b, a]));
      for (const node of diagramContentNodes(diagram.content)) {
        const old = same ? node.id : reverse.get(node.id);
        if (!previous) origins[node.id] = node.id;
        else if (old && previous.nodeOrigins[old]) origins[node.id] = previous.nodeOrigins[old];
      }
      const issued = diagramRevisions.assert(diagram);
      bindings[diagramId] = issued.id;
      const include = (revision: DiagramRevision) => {
        if (this.record.diagramRevisions[revision.id] || additions[revision.id]) return;
        if (revision.parentId) {
          if (previous) include(diagramRevisions.get(revision.parentId));
          else (this.record.revisionBoundary ??= {})[revision.parentId] = revision.diagramId;
        }
        additions[revision.id] = revision;
      };
      include(issued);
    }
    document = migrateDiagramAlternatives(document, id => diagramRevisions.get(id), bindings);
    validateRevisionSelections(document);
    for (const [key, variant] of Object.entries(document.revisionReviews ?? {})) {
      if (key !== variant.id) throw Error('Invalid variant identity');
      validateRevisionReview(variant, id => diagramRevisions.get(id));
      const retain = (id: string): void => {
        if (this.record.diagramRevisions[id] || additions[id]) return;
        const revision = diagramRevisions.get(id);
        if (revision.parentId && !this.record.revisionBoundary?.[revision.parentId]) retain(revision.parentId);
        additions[id] = revision;
      };
      reviewRevisionIds(variant).forEach(retain);
    }
    validateRevisionSelections(document, id => diagramRevisions.get(id));
    const retainSelection = (id: string): void => {
      if (this.record.diagramRevisions[id] || additions[id]) return;
      const revision = diagramRevisions.get(id);
      if (revision.parentId && !this.record.revisionBoundary?.[revision.parentId]) retainSelection(revision.parentId);
      additions[id] = revision;
    };
    for (const selection of Object.values(document.revisionSelections ?? {}))
      for (const id of [selection.revisionId, selection.baseRevisionId, selection.contextRevisionId]) if (id) retainSelection(id);
    if (document.alternatives) validateDiagramAlternatives(document.alternatives, id => diagramRevisions.get(id));
    alternativeRevisionIds(document.alternatives).forEach(retainSelection);
    const unresolvedAnchors: Record<string, ContentNodeAnchor> = {};
    const revisions = { ...this.record.diagramRevisions, ...additions };
    const edges = document.edges.map(edge => ({ ...edge, source: encodeAnchor(edge.source, edge.id + ':source', document.scene, bindings, revisions, unresolvedAnchors) as CanvasNodeAnchor, target: encodeAnchor(edge.target, edge.id + ':target', document.scene, bindings, revisions, unresolvedAnchors) }));
    const snapshot: StoredCanvasSnapshot = { id: id('canvas-revision'), parentId: previous?.id,
      document: { ...(document.alternatives ? { alternatives: structuredClone(document.alternatives) } : {}), ...(document.diagramPresentations ? { diagramPresentations: structuredClone(document.diagramPresentations) } : {}), ...(document.diagramContexts ? { diagramContexts: structuredClone(document.diagramContexts) } : {}), ...(document.revisionSelections ? { revisionSelections: structuredClone(document.revisionSelections) } : {}), ...(document.revisionReviews ? { revisionReviews: structuredClone(document.revisionReviews) } : {}), scene: { root: structuredClone(document.scene.root) }, edges, sections: structuredClone(document.sections), ...(document.jumps ? { jumps: structuredClone(document.jumps) } : {}) },
      diagramBindings: bindings, unresolvedAnchors, view: structuredClone(view), nodeOrigins: origins };
    // Validation above must complete before any canonical state changes.
    Object.assign(this.record.diagramRevisions, additions);
    this.changes.push({ snapshots: {}, diagramRevisions: additions });
    this.record.snapshots[snapshot.id] = snapshot;
    this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
    if (previous) this.record.past.push(previous.id);
    this.record.headId = snapshot.id;
    this.record.future = [];
    this.recordViewStep();
    return this.head;
  }
  canvasViews(): CanvasViewState {
    const views = structuredClone(this.record.canvasViews ?? { saved: {} });
    const active = views.activeViewId && views.saved[views.activeViewId];
    if (!active) return views;
    const saved = this.record.snapshots[active.finalCheckpointId!], current = this.head;
    const contentView = (view: unknown) => {
      if (!view || typeof view !== 'object') return view;
      const { viewport: _, selection: __, ...content } = view as Record<string, unknown>;
      return content;
    };
    return { ...views, dirty: !equal(saved.document, current.document) || !equal(saved.diagramBindings, current.diagramBindings)
      || !equal(contentView(saved.view), contentView(current.view)) };
  }
  private stashCanvasView(views: CanvasViews, view: unknown) {
    if (!equal(this.head.view, view)) this.append(this.document(), view);
    if (views.activeViewId) (views.workingCopies ??= {})[views.activeViewId] = this.headId;
  }
  private openCanvasView(views: CanvasViews, viewId: string, view: unknown) {
    if (views.activeViewId === viewId) { this.stashCanvasView(views, view); return; }
    const saved = views.saved[viewId];
    const checkpointId = views.workingCopies?.[viewId] ?? saved.finalCheckpointId!;
    this.validateCheckpoint(checkpointId);
    this.stashCanvasView(views, view);
    const { transactionId: _, ...target } = this.record.snapshots[checkpointId];
    // Navigation retains the current camera so alternatives stay visually aligned.
    const snapshot = structuredClone({ ...target, id: id('canvas-revision'), parentId: this.headId });
    if (snapshot.view && typeof snapshot.view === 'object' && view && typeof view === 'object' && 'viewport' in view)
      snapshot.view = { ...snapshot.view, viewport: view.viewport };
    this.record.snapshots[snapshot.id] = snapshot;
    this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
    this.record.past.push(this.headId); this.record.headId = snapshot.id; this.record.future = [];
    views.activeViewId = viewId;
  }
  private recordViewStep() {
    const recording = this.record.canvasViews?.recording;
    if (recording && recording.checkpointIds.at(-1) !== this.record.headId) recording.checkpointIds.push(this.record.headId);
  }
  startGeneration(parentId: string, candidates: { id: string; name: string; generation: CanvasGeneration }[]) {
    const views = this.record.canvasViews, parent = views?.saved[parentId];
    if (!parent || parent.archivedAt || views!.recording || generationRunning(parent.generation)) throw Error('Saved parent view is unavailable');
    if (!candidates.length || candidates.length > 8 || new Set(candidates.map(item => item.id)).size !== candidates.length) throw Error('Invalid candidates');
    for (const candidate of candidates) {
      canvasGenerationSchema.parse(candidate.generation);
      if (!candidate.id || views!.saved[candidate.id]) throw Error('Candidate already exists');
    }
    const checkpointId = parent.finalCheckpointId!, now = new Date().toISOString();
    // Export only this saved state and its revision dependencies, not the live head.
    const record = { ...this.export(), headId: checkpointId, baselineId: checkpointId, past: [], future: [] };
    delete record.canvasViews;
    const history = new CanvasHistory(this.document(checkpointId), this.record.snapshots[checkpointId].view, record).export(true);
    for (const item of candidates) views!.saved[item.id] = { id: item.id, name: item.name, createdAt: now, savedAt: now,
      parentViewId: parentId, forkCheckpointId: checkpointId, alternativeGroupId: item.generation.runId,
      startCheckpointId: checkpointId, finalCheckpointId: checkpointId, checkpointIds: [checkpointId], generation: item.generation };
    return history;
  }
  updateGeneration(viewId: string, generation: CanvasGeneration, proposed?: CanvasHistoryRecord) {
    canvasGenerationSchema.parse(generation);
    const saved = this.record.canvasViews?.saved[viewId];
    if (!saved || saved.archivedAt || saved.generation?.runId !== generation.runId || saved.generation.chatId !== generation.chatId) throw Error('Generation target is unavailable');
    if (!generationRunning(saved.generation)) {
      if (equal(saved.generation, generation)) return;
      throw Error('Generation has already settled');
    }
    if (proposed) {
      if (generation.status !== 'finished') throw Error('Only completed generation can publish a view');
      validateCanvasHistory(proposed);
      const snapshot = structuredClone({ ...proposed.snapshots[proposed.headId], id: id('canvas-revision'), parentId: saved.finalCheckpointId });
      delete snapshot.transactionId;
      for (const [key, revision] of Object.entries(proposed.diagramRevisions)) {
        if (this.record.diagramRevisions[key] && !equal(this.record.diagramRevisions[key], revision)) throw Error('Diagram revision is immutable');
      }
      const next = { ...this.record, snapshots: { ...this.record.snapshots, [snapshot.id]: snapshot },
        diagramRevisions: { ...this.record.diagramRevisions, ...proposed.diagramRevisions },
        revisionBoundary: { ...proposed.revisionBoundary, ...this.record.revisionBoundary } };
      validateCanvasHistory(next);
      for (const revision of Object.values(proposed.diagramRevisions)) diagramRevisions.register(revision);
      Object.assign(this.record.diagramRevisions, proposed.diagramRevisions);
      this.record.snapshots[snapshot.id] = snapshot;
      this.record.revisionBoundary = next.revisionBoundary;
      this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: proposed.diagramRevisions });
      saved.finalCheckpointId = snapshot.id; saved.checkpointIds.push(snapshot.id); saved.savedAt = generation.completedAt;
    }
    saved.generation = structuredClone(generation);
  }
  canvasView(raw: CanvasViewCommand, view = this.head.view): CanvasViewState {
    const input = canvasViewCommandSchema.parse(raw);
    if (input.operation === 'list' || input.operation === 'read') {
      if (input.operation === 'read' && (!input.viewId || !this.record.canvasViews?.saved[input.viewId])) throw Error('CanvasView not found');
      return this.canvasViews();
    }
    const views = this.record.canvasViews ?? { saved: {} };
    if (views.recording && ['create', 'open', 'fork', 'save', 'alternatives', 'keep', 'discard'].includes(input.operation))
      throw Error('Stop recording before editing saved CanvasViews');
    if (input.operation === 'create') {
      if (!input.name) throw Error('CanvasView name is required');
      this.stashCanvasView(views, view);
      const viewId = id('canvas-view'), now = new Date().toISOString();
      views.saved[viewId] = { id: viewId, name: input.name, createdAt: now, savedAt: now,
        startCheckpointId: this.headId, finalCheckpointId: this.headId, checkpointIds: [this.headId] };
      views.activeViewId = viewId;
    } else if (input.operation === 'start') {
      if (views.recording) throw Error('A CanvasView is already recording');
      if (!input.name) throw Error('CanvasView name is required');
      if (!equal(this.head.view, view)) this.append(this.document(), view);
      views.recording = { id: id('canvas-view'), name: input.name, createdAt: new Date().toISOString(),
        startCheckpointId: this.headId, checkpointIds: [this.headId] };
    } else if (input.operation === 'stop') {
      if (!views.recording) throw Error('No CanvasView is recording');
      if (!equal(this.head.view, view)) this.append(this.document(), view);
      this.recordViewStep();
      const saved = { ...views.recording, finalCheckpointId: this.headId, savedAt: new Date().toISOString() };
      views.saved[saved.id] = saved;
      views.activeViewId = saved.id;
      delete views.recording;
    } else if (input.operation === 'cancel') {
      if (!views.recording) throw Error('No CanvasView is recording');
      delete views.recording;
    } else {
      const targetId = input.viewId ?? (input.operation === 'save' ? views.activeViewId : undefined);
      const saved = targetId && views.saved[targetId];
      if (!saved) throw Error('CanvasView not found');
      if (generationRunning(saved.generation)) throw Error('This view is still generating; cancel generation before editing it');
      if (['keep', 'discard', 'delete'].includes(input.operation) && Object.values(views.saved).some(item => {
        if (!generationRunning(item.generation)) return false;
        if (input.operation === 'keep' && item.alternativeGroupId === saved.alternativeGroupId) return true;
        let parent = item.parentViewId;
        while (parent) { if (parent === saved.id) return true; parent = views.saved[parent]?.parentViewId; }
        return false;
      })) throw Error('Wait for generation to finish or cancel it first');
      if (saved.archivedAt) throw Error('CanvasView is archived');
      if (input.operation === 'fork' || input.operation === 'alternatives') {
        const names = input.operation === 'fork' ? input.name && [input.name] : input.names;
        if (!names) throw Error(input.operation === 'fork' ? 'CanvasView name is required' : 'Alternative names are required');
        const groupId = input.operation === 'alternatives' ? id('view-alternatives') : undefined;
        const children = names.map(name => {
          const viewId = id('canvas-view'), now = new Date().toISOString(), checkpointId = saved.finalCheckpointId!;
          return { id: viewId, name, createdAt: now, savedAt: now, parentViewId: saved.id, forkCheckpointId: checkpointId,
            ...(groupId ? { alternativeGroupId: groupId } : {}),
            startCheckpointId: checkpointId, finalCheckpointId: checkpointId, checkpointIds: [checkpointId] };
        });
        for (const child of children) views.saved[child.id] = child;
        if (input.operation === 'fork') this.openCanvasView(views, children[0].id, view);
      } else if (input.operation === 'open') {
        this.openCanvasView(views, saved.id, view);
      } else if (input.operation === 'keep' || input.operation === 'discard') {
        if (input.operation === 'keep' && !saved.alternativeGroupId) throw Error('CanvasView is not part of an alternative group');
        const archived = new Set(input.operation === 'discard' ? [saved.id] : Object.values(views.saved)
          .filter(item => item.id !== saved.id && item.alternativeGroupId === saved.alternativeGroupId).map(item => item.id));
        let changed = true;
        while (changed) {
          changed = false;
          for (const item of Object.values(views.saved)) if (item.parentViewId && archived.has(item.parentViewId) && !archived.has(item.id)) {
            archived.add(item.id); changed = true;
          }
        }
        if (input.operation === 'keep') {
          if (views.activeViewId !== saved.id) this.openCanvasView(views, saved.id, view);
          else this.stashCanvasView(views, view);
          views.saved[saved.id] = { ...saved, finalCheckpointId: this.headId, savedAt: new Date().toISOString(),
            checkpointIds: saved.checkpointIds.at(-1) === this.headId ? saved.checkpointIds : [...saved.checkpointIds, this.headId] };
          if (views.workingCopies) delete views.workingCopies[saved.id];
        } else if (views.activeViewId && archived.has(views.activeViewId)) {
          if (saved.parentViewId && !views.saved[saved.parentViewId].archivedAt) this.openCanvasView(views, saved.parentViewId, view);
          else { this.stashCanvasView(views, view); delete views.activeViewId; }
        }
        for (const viewId of archived) views.saved[viewId] = { ...views.saved[viewId], archivedAt: new Date().toISOString() };
      } else if (input.operation === 'promote-diffs') {
        if (views.recording) throw Error('Stop recording before promoting CanvasView diffs');
        const comparison = this.canvasViewComparison(saved.id);
        const items = canvasViewAlternatives(comparison);
        const current = withCanvasViewAlternatives(this.document(), items);
        const targetDocument = withCanvasViewAlternatives(comparison.proposed.document, items);
        validateDiagramAlternatives(current.alternatives!, revisionId => diagramRevisions.get(revisionId));
        validateDiagramAlternatives(targetDocument.alternatives!, revisionId => diagramRevisions.get(revisionId));
        // Append a new saved endpoint; retain the original immutable checkpoints and comparison base.
        const target = this.record.snapshots[saved.finalCheckpointId!];
        if (!equal(target.document.alternatives, targetDocument.alternatives)) {
          const snapshot = structuredClone({ ...target, id: id('canvas-revision'), parentId: target.id,
            document: { ...target.document, alternatives: targetDocument.alternatives } });
          delete snapshot.transactionId;
          this.record.snapshots[snapshot.id] = snapshot;
          this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
          views.saved[saved.id] = { ...saved, checkpointIds: [...saved.checkpointIds, snapshot.id],
            finalCheckpointId: snapshot.id, savedAt: new Date().toISOString() };
        }
        if (!equal(current.alternatives, this.document().alternatives)) this.append(current, view);
      } else if (input.operation === 'save') {
        if (views.activeViewId && views.activeViewId !== saved.id) throw Error('Open the CanvasView before saving changes to it');
        if (!equal(this.head.view, view)) this.append(this.document(), view);
        views.saved[saved.id] = { ...saved, finalCheckpointId: this.headId, savedAt: new Date().toISOString(),
          checkpointIds: saved.checkpointIds.at(-1) === this.headId ? saved.checkpointIds : [...saved.checkpointIds, this.headId] };
        views.activeViewId = saved.id;
        if (views.workingCopies) delete views.workingCopies[saved.id];
      } else if (input.operation === 'delete') {
        if (Object.values(views.saved).some(item => item.parentViewId === saved.id)) throw Error('Use discard to archive a CanvasView with children');
        delete views.saved[saved.id];
        if (views.workingCopies) delete views.workingCopies[saved.id];
        if (views.activeViewId === saved.id) delete views.activeViewId;
      }
      else {
        if (views.recording) throw Error('Stop recording before applying or forking a CanvasView');
        this.validateCheckpoint(saved.finalCheckpointId!);
        // Restore the exact saved state as a fresh checkpoint. Transfer transaction links
        // describe the original operation and must not be replayed by this local restore.
        const { transactionId: _, ...target } = this.record.snapshots[saved.finalCheckpointId!];
        const snapshot = structuredClone({ ...target, id: id('canvas-revision'), parentId: this.headId });
        this.record.snapshots[snapshot.id] = snapshot;
        this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
        this.record.past.push(this.headId); this.record.headId = snapshot.id; this.record.future = [];
        views.activeViewId = saved.id;
        if (views.workingCopies) delete views.workingCopies[saved.id];
      }
    }
    this.record.canvasViews = views;
    return this.canvasViews();
  }
  navigationTransactionId(redo = false) {
    return this.record.snapshots[redo ? this.record.future.at(-1)! : this.record.headId]?.transactionId;
  }
  navigate(redo = false): StoredCanvasSnapshot | undefined {
    const target = (redo ? this.record.future : this.record.past).at(-1);
    if (!target) return;
    this.validateCheckpoint(target);
    (redo ? this.record.future : this.record.past).pop();
    (redo ? this.record.past : this.record.future).push(this.record.headId);
    this.record.headId = target;
    this.recordViewStep();
    return this.head;
  }
  linkTransaction(transactionId: string) {
    const snapshot = { ...this.record.snapshots[this.record.headId], transactionId };
    this.record.snapshots[snapshot.id] = snapshot;
    this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
  }
  retireTransactions(ids: ReadonlySet<string>) {
    for (const prior of Object.values(this.record.snapshots)) if (prior.transactionId && ids.has(prior.transactionId)) {
      const { transactionId: _, ...snapshot } = prior;
      this.record.snapshots[snapshot.id] = snapshot;
      this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
    }
  }
  /** Publish a reviewed state as one checkpoint, retaining its exact diagram revision IDs. */
  adopt(proposed: CanvasHistoryRecord): void {
    validateCanvasHistory(proposed);
    for (const revision of Object.values(proposed.diagramRevisions)) diagramRevisions.register(revision);
    const added = Object.fromEntries(Object.entries(proposed.diagramRevisions).filter(([key]) => !this.record.diagramRevisions[key]));
    for (const [key, revision] of Object.entries(proposed.diagramRevisions)) {
      const existing = this.record.diagramRevisions[key];
      if (existing && !equal(existing, revision)) throw new Error('Diagram revision is immutable');
    }
    const snapshot = structuredClone({ ...proposed.snapshots[proposed.headId], id: id('canvas-revision'), parentId: this.record.headId });
    const next = { ...this.record, snapshots: { ...this.record.snapshots, [snapshot.id]: snapshot },
      diagramRevisions: { ...this.record.diagramRevisions, ...proposed.diagramRevisions },
      past: [...this.record.past, this.record.headId], future: [], headId: snapshot.id };
    validateCanvasHistory(next);
    // Keep the revision table object used by the internal resolver alive.
    Object.assign(this.record.diagramRevisions, structuredClone(proposed.diagramRevisions));
    this.record = { ...next, diagramRevisions: this.record.diagramRevisions };
    this.recordViewStep();
    this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: Object.fromEntries(Object.keys(added).map(key => [key, this.record.diagramRevisions[key]])) });
  }
  reset(view?: unknown) {
    this.validateCheckpoint(this.record.baselineId);
    const baseline = this.record.snapshots[this.record.baselineId];
    const snapshot = structuredClone({ ...baseline, id: id('canvas-revision'), parentId: this.record.headId, view: view ?? baseline.view });
    this.record.snapshots[snapshot.id] = snapshot;
    this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
    this.record.past.push(this.record.headId);
    this.record.headId = snapshot.id;
    this.record.future = [];
    this.recordViewStep();
    return this.head;
  }
}

export function validateCanvasHistory(value: CanvasHistoryRecord, changed?: { revisions: string[]; snapshots: string[] }): void {
  const validated = new Set<Diagram>();
  if (!value || value.schemaVersion !== 1 || typeof value.contextId !== 'string' || !value.contextId
    || !value.snapshots || !value.diagramRevisions || !Array.isArray(value.past) || !Array.isArray(value.future)) throw new Error('Invalid canvas history');
  for (const key of [value.headId, value.baselineId, ...value.past, ...value.future]) {
    if (typeof key !== 'string' || !Object.hasOwn(value.snapshots, key)) throw new Error('Unknown canvas history reference');
  }
  validateCanvasViews(value.canvasViews, value.snapshots);
  for (const [key, revision] of (changed ? changed.revisions.map(key => [key, value.diagramRevisions[key]] as const) : Object.entries(value.diagramRevisions))) {
    if (revision.diagram.revisionId !== key || revision.id !== key || revision.diagramId !== revision.diagram.diagramId || !revision.nodeRefs) throw new Error('Invalid diagram history identity');
    validateDiagram(revision.diagram);
    validated.add(revision.diagram);
    if (revision.parentId && (value.diagramRevisions[revision.parentId]?.diagramId ?? value.revisionBoundary?.[revision.parentId]) !== revision.diagramId) throw new Error('Invalid diagram revision parent');
    const refs = diagramContentNodes(revision.diagram.content).map(n => revision.nodeRefs[n.id]);
    if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) throw new Error('Invalid logical node identities');
  }
  for (const [key, snapshot] of (changed ? changed.snapshots.map(key => [key, value.snapshots[key]] as const) : Object.entries(value.snapshots))) {
    if (snapshot.id !== key || !snapshot.document || !snapshot.view || !snapshot.nodeOrigins || !snapshot.diagramBindings
      || snapshot.parentId && !Object.hasOwn(value.snapshots, snapshot.parentId)) throw new Error('Invalid canvas checkpoint');
    if ('contents' in snapshot.document.scene) throw new Error('Canvas checkpoint must not embed diagrams');
    const contents: Record<string, Diagram> = {};
    for (const [diagramId, revisionId] of Object.entries(snapshot.diagramBindings)) {
      const revision = Object.hasOwn(value.diagramRevisions, revisionId) && value.diagramRevisions[revisionId];
      if (!revision || revision.diagram.id !== diagramId) throw new Error('Invalid diagram binding');
      contents[diagramId] = revision.diagram;
    }
    for (const settings of Object.values(snapshot.document.diagramPresentations ?? {})) diagramPresentationSettingsSchema.parse(settings);
    if (snapshot.document.alternatives) validateDiagramAlternatives(snapshot.document.alternatives, id => value.diagramRevisions[id]);
    validateRevisionSelections(migrateRevisionSelections(snapshot.document), id => value.diagramRevisions[id]);
    for (const [id, variant] of Object.entries(migrateRevisionSelections(snapshot.document).revisionReviews ?? {})) {
      if (id !== variant.id) throw Error('Invalid variant identity');
      validateRevisionReview(variant, id => value.diagramRevisions[id]);
    }
    const scene = { root: snapshot.document.scene.root, contents };
    for (const [diagramId, context] of Object.entries(snapshot.document.diagramContexts ?? {})) {
      if (diagramId !== context.diagramId || !Object.values(contents).some(diagram => diagram.diagramId === diagramId))
        throw Error('Diagram agent context has no owning diagram');
      validateDiagramAgentContext(context);
    }
    validateCanvasScene(scene, validated);
    if (snapshot.transactionId !== undefined && (typeof snapshot.transactionId !== 'string' || !snapshot.transactionId)) throw Error('Invalid transaction reference');
    if (snapshot.document.jumps) validateCanvasJumps(scene, snapshot.document.jumps);
    validateConnections(scene, documentFromHistory(value, key).edges);
  }
}

/** Materialize the legacy read model only at transport/rendering boundaries. */
export function documentFromHistory(record: CanvasHistoryRecord, snapshotId = record.headId): ResolvedCanvasDocument {
  const snapshot = record.snapshots[snapshotId];
  if (!snapshot) throw new Error('Unknown canvas checkpoint');
  const contents = Object.fromEntries(Object.entries(snapshot.diagramBindings).map(([diagramId, revisionId]) => [diagramId, record.diagramRevisions[revisionId].diagram]));
  const scene = { root: snapshot.document.scene.root, contents };
  const decode = (anchor: CanvasConnection['target'], key: string): DiagramAnchor => {
    if (anchor.kind === 'box') return anchor;
    if (snapshot.unresolvedAnchors?.[key]) return snapshot.unresolvedAnchors[key];
    const box = findOwner(scene.root, anchor.displayNodeId);
    const revision = box?.kind === 'diagram' && record.diagramRevisions[snapshot.diagramBindings[box.contentId]];
    const contentNodeId = revision && Object.entries(revision.nodeRefs).find(([, ref]) => ref === anchor.contentNodeId)?.[0];
    if (!revision || !contentNodeId) throw new Error('Unresolvable canonical anchor');
    return { ...anchor, contentNodeId, revisionId: revision.diagram.content.revisionId };
  };
  const result = structuredClone({ ...migrateDiagramAlternatives(snapshot.document, id => record.diagramRevisions[id], snapshot.diagramBindings), scene, edges: snapshot.document.edges.map(edge => ({ ...edge,
    source: decode(edge.source, edge.id + ':source') as ContentNodeAnchor, target: decode(edge.target, edge.id + ':target') })) });
  Object.values(result.scene.contents).forEach(deepFreeze);
  return result;
}

function findOwner(root: LineGridScene['root'], displayNodeId: string): LineGridScene['root'] | undefined {
  if (`grid:${root.id}` === displayNodeId) return root;
  return root.kind === 'container' ? root.children.map(child => findOwner(child, displayNodeId)).find(Boolean) : undefined;
}
function encodeAnchor(anchor: DiagramAnchor, key: string, scene: LineGridScene, bindings: Record<string, string>,
  revisions: Record<string, DiagramRevision>, unresolved: Record<string, ContentNodeAnchor>): CanvasConnection['target'] {
  if (anchor.kind === 'box') return structuredClone(anchor);
  const box = findOwner(scene.root, anchor.displayNodeId);
  const revision = box?.kind === 'diagram' && revisions[bindings[box.contentId]];
  const ref = revision && revision.diagram.content.revisionId === anchor.revisionId && revision.nodeRefs[anchor.contentNodeId];
  const { revisionId: _, ...rest } = anchor;
  if (!ref) unresolved[key] = structuredClone(anchor);
  return { ...rest, contentNodeId: ref || `unresolved:${anchor.contentNodeId}` };
}
