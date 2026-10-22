import { validateVariant, variantRevisionIds, type DiagramVariant } from './diagramVariant';
import { deepFreeze } from '../immutability';
import { CanvasCheckpointEncoder, type CanvasCheckpointRecords } from './canvasCheckpointRecords';
import { diagramRevisions } from './internal/revisionRegistry';
import { validateDiagram, type Diagram } from './diagram';
import { diagramContentNodes } from './diagramContentNodes';
import { correspondingNodes, DiagramRevisionEditor, type DiagramRevision } from './diagramRevisionEditor';
import type { LineGridScene } from './lineGrid';
import type { DiagramConnection, DiagramAnchor, ContentNodeAnchor } from './diagramConnection';
export interface ResolvedCanvasDocument { variants?: Record<string, DiagramVariant>; scene: LineGridScene; edges: DiagramConnection[]; jumps?: CanvasJump[]; sections: Readonly<Record<string, readonly {id: string; label: string; startLine: number; endLine: number; anchorToken: string}[]>> }
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
  variants?: Record<string, DiagramVariant>;
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
  return [...new Set([...Object.values(snapshot.diagramBindings), ...Object.values(snapshot.document.variants ?? {}).flatMap(variantRevisionIds)])];
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
    if (record) {
      validateCanvasHistory(record, validation === 'current' ? currentHistoryChanges(record) : undefined);
      for (const revision of Object.values(record.diagramRevisions)) {
        if (validation === 'current') diagramRevisions.restore(revision); else diagramRevisions.register(revision);
      }
      for (const key of validation === 'current' ? [record.headId] : Object.keys(record.snapshots)) this.validatedSnapshots.add(key);
      this.record = structuredClone(record);
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
    return { sequence: this.changes.length, header: { ...header, past: [...header.past], future: [...header.future] }, ...updates,
      storage: this.checkpointEncoder.encode(updates.snapshots, since === undefined, header.headId) };
  }
  export(currentOnly = false): CanvasHistoryRecord {
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
  private validateCheckpoint(snapshotId: string) {
    if (this.validatedSnapshots.has(snapshotId)) return;
    validateCanvasHistory(this.record, currentHistoryChanges(this.record, snapshotId));
    this.validatedSnapshots.add(snapshotId);
  }

  append(document: ResolvedCanvasDocument, view: unknown, correspondence: ReadonlyMap<string, string> = new Map()): StoredCanvasSnapshot {
    projectCanvasSnapshot(document.scene);
    validateConnections(document.scene, document.edges);
    if (document.jumps) validateCanvasJumps(document.scene, document.jumps);
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
    for (const [key, variant] of Object.entries(document.variants ?? {})) {
      if (key !== variant.id) throw Error('Invalid variant identity');
      validateVariant(variant, id => diagramRevisions.get(id));
      const retain = (id: string): void => {
        if (this.record.diagramRevisions[id] || additions[id]) return;
        const revision = diagramRevisions.get(id);
        if (revision.parentId && !this.record.revisionBoundary?.[revision.parentId]) retain(revision.parentId);
        additions[id] = revision;
      };
      variantRevisionIds(variant).forEach(retain);
    }
    const unresolvedAnchors: Record<string, ContentNodeAnchor> = {};
    const revisions = { ...this.record.diagramRevisions, ...additions };
    const edges = document.edges.map(edge => ({ ...edge, source: encodeAnchor(edge.source, edge.id + ':source', document.scene, bindings, revisions, unresolvedAnchors) as CanvasNodeAnchor, target: encodeAnchor(edge.target, edge.id + ':target', document.scene, bindings, revisions, unresolvedAnchors) }));
    const snapshot: StoredCanvasSnapshot = { id: id('canvas-revision'), parentId: previous?.id,
      document: { ...(document.variants ? { variants: structuredClone(document.variants) } : {}), scene: { root: structuredClone(document.scene.root) }, edges, sections: structuredClone(document.sections), ...(document.jumps ? { jumps: structuredClone(document.jumps) } : {}) },
      diagramBindings: bindings, unresolvedAnchors, view: structuredClone(view), nodeOrigins: origins };
    // Validation above must complete before any canonical state changes.
    Object.assign(this.record.diagramRevisions, additions);
    this.changes.push({ snapshots: {}, diagramRevisions: additions });
    this.record.snapshots[snapshot.id] = snapshot;
    this.changes.push({ snapshots: { [snapshot.id]: snapshot }, diagramRevisions: {} });
    if (previous) this.record.past.push(previous.id);
    this.record.headId = snapshot.id;
    this.record.future = [];
    return this.head;
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
    for (const [id, variant] of Object.entries(snapshot.document.variants ?? {})) {
      if (id !== variant.id) throw Error('Invalid variant identity');
      validateVariant(variant, id => value.diagramRevisions[id]);
    }
    const scene = { root: snapshot.document.scene.root, contents };
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
  const result = structuredClone({ ...snapshot.document, scene, edges: snapshot.document.edges.map(edge => ({ ...edge,
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
