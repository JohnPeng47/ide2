import { validateDiagram, type Diagram } from './diagram';
import { diagramContentNodes } from './diagramContentNodes';
import { correspondingNodes, RevisionedDiagramService, type DiagramRevision } from './diagramService';
import type { LineGridScene } from './lineGrid';
import type { DiagramConnection, DiagramAnchor, ContentNodeAnchor } from './diagramConnection';
export interface ResolvedCanvasDocument { scene: LineGridScene; edges: DiagramConnection[]; sections: Readonly<Record<string, readonly {id: string; label: string; startLine: number; endLine: number; anchorToken: string}[]>> }
import { projectCanvasSnapshot } from './projectDiagramCanvas';
import { validateConnections } from './diagramConnection';

export type CanvasNodeAnchor = Omit<ContentNodeAnchor, 'revisionId'>;
export type CanvasConnection = Omit<DiagramConnection, 'source' | 'target'> & {
  source: CanvasNodeAnchor;
  target: CanvasNodeAnchor | Extract<DiagramAnchor, {kind: 'box'}>;
};
/** Canonical canvas state has no embedded DiagramContent or revision-bearing anchors. */
export interface CanvasDocument {
  scene: Pick<ResolvedCanvasDocument['scene'], 'root'>;
  edges: CanvasConnection[];
  sections: ResolvedCanvasDocument['sections'];
}
export interface StoredCanvasSnapshot {
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
export interface CanvasHistoryRecord {
  schemaVersion: 1;
  contextId: string;
  baselineId: string;
  headId: string;
  past: string[];
  future: string[];
  snapshots: Record<string, StoredCanvasSnapshot>;
  diagramRevisions: Record<string, DiagramRevision>;
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
  readonly diagrams: RevisionedDiagramService;
  constructor(document: ResolvedCanvasDocument, view: unknown, record?: CanvasHistoryRecord) {
    if (record) {
      validateCanvasHistory(record);
      this.record = structuredClone(record);
      if (!equal(this.document(), document)) throw new Error('Canvas history does not match document');
    } else {
      this.record = { schemaVersion: 1, contextId: id('context'), baselineId: '', headId: '', past: [], future: [], snapshots: {}, diagramRevisions: {} };
      this.append(document, view);
      this.record.baselineId = this.record.headId;
      this.record.past = [];
    }
    this.diagrams = new RevisionedDiagramService(this.record.diagramRevisions, contextId => {
      if (contextId !== this.record.contextId) throw new Error('Unknown editing context');
      return this.head.diagramBindings;
    });
  }
  get contextId() { return this.record.contextId; }
  get head(): StoredCanvasSnapshot { return structuredClone(this.record.snapshots[this.record.headId]); }
  get canUndo() { return !!this.record.past.length; }
  get canRedo() { return !!this.record.future.length; }
  export(): CanvasHistoryRecord { return structuredClone(this.record); }
  fork(view: unknown = this.head.view): CanvasHistoryRecord {
    const record = this.export(), head = this.head;
    const baseline = { ...head, view: structuredClone(view), id: id('canvas-revision'), parentId: head.id, nodeOrigins: Object.fromEntries(
      Object.values(this.document().scene.contents).flatMap(diagram => diagramContentNodes(diagram.content).map(node => [node.id, node.id]))) };
    record.snapshots[baseline.id] = baseline;
    return { ...record, contextId: id('context'), headId: baseline.id, baselineId: baseline.id, past: [], future: [] };
  }
  /** Compatibility projection for existing rendering, source and MCP adapters. */
  document(snapshotId = this.record.headId): ResolvedCanvasDocument {
    return documentFromHistory(this.record, snapshotId);
  }

  append(document: ResolvedCanvasDocument, view: unknown, correspondence: ReadonlyMap<string, string> = new Map()): StoredCanvasSnapshot {
    projectCanvasSnapshot(document.scene);
    validateConnections(document.scene, document.edges);
    const previous = this.record.snapshots[this.record.headId];
    const bindings: Record<string, string> = {}, additions: Record<string, DiagramRevision> = {}, origins: Record<string, string> = {};
    for (const [diagramId, diagram] of Object.entries(document.scene.contents)) {
      validateDiagram(diagram);
      const prior = previous && this.record.diagramRevisions[previous.diagramBindings[diagramId]];
      const same = prior && equal(prior.diagram, diagram);
      const map = prior ? new Map([...correspondingNodes(prior.diagram, diagram), ...correspondence]) : new Map<string, string>();
      const reverse = new Map([...map].map(([a, b]) => [b, a]));
      const refs: Record<string, string> = {};
      for (const node of diagramContentNodes(diagram.content)) {
        const old = same ? node.id : reverse.get(node.id);
        refs[node.id] = old && prior?.nodeRefs[old] || id('node');
        if (!previous) origins[node.id] = node.id;
        else if (old && previous.nodeOrigins[old]) origins[node.id] = previous.nodeOrigins[old];
      }
      const revisionId = same ? prior.id : id('diagram-revision');
      bindings[diagramId] = revisionId;
      if (!same) additions[revisionId] = { id: revisionId, diagramId, parentId: prior?.id, diagram: structuredClone(diagram), nodeRefs: refs };
    }
    const unresolvedAnchors: Record<string, ContentNodeAnchor> = {};
    const revisions = { ...this.record.diagramRevisions, ...additions };
    const edges = document.edges.map(edge => ({ ...edge, source: encodeAnchor(edge.source, edge.id + ':source', document.scene, bindings, revisions, unresolvedAnchors) as CanvasNodeAnchor, target: encodeAnchor(edge.target, edge.id + ':target', document.scene, bindings, revisions, unresolvedAnchors) }));
    const snapshot: StoredCanvasSnapshot = { id: id('canvas-revision'), parentId: previous?.id,
      document: { scene: { root: structuredClone(document.scene.root) }, edges, sections: structuredClone(document.sections) },
      diagramBindings: bindings, unresolvedAnchors, view: structuredClone(view), nodeOrigins: origins };
    // Validation above must complete before any canonical state changes.
    Object.assign(this.record.diagramRevisions, additions);
    this.record.snapshots[snapshot.id] = snapshot;
    if (previous) this.record.past.push(previous.id);
    this.record.headId = snapshot.id;
    this.record.future = [];
    return this.head;
  }
  navigate(redo = false): StoredCanvasSnapshot | undefined {
    const target = redo ? this.record.future.pop() : this.record.past.pop();
    if (!target) return;
    (redo ? this.record.past : this.record.future).push(this.record.headId);
    this.record.headId = target;
    return this.head;
  }
  reset(view?: unknown) {
    const baseline = this.record.snapshots[this.record.baselineId];
    const snapshot = structuredClone({ ...baseline, id: id('canvas-revision'), parentId: this.record.headId, view: view ?? baseline.view });
    this.record.snapshots[snapshot.id] = snapshot;
    this.record.past.push(this.record.headId);
    this.record.headId = snapshot.id;
    this.record.future = [];
    return this.head;
  }
}

export function validateCanvasHistory(value: CanvasHistoryRecord): void {
  if (!value || value.schemaVersion !== 1 || typeof value.contextId !== 'string' || !value.contextId
    || !value.snapshots || !value.diagramRevisions || !Array.isArray(value.past) || !Array.isArray(value.future)) throw new Error('Invalid canvas history');
  for (const key of [value.headId, value.baselineId, ...value.past, ...value.future]) {
    if (typeof key !== 'string' || !Object.hasOwn(value.snapshots, key)) throw new Error('Unknown canvas history reference');
  }
  for (const [key, revision] of Object.entries(value.diagramRevisions)) {
    if (revision.id !== key || revision.diagramId !== revision.diagram.id || !revision.nodeRefs) throw new Error('Invalid diagram history identity');
    validateDiagram(revision.diagram);
    if (revision.parentId && (!Object.hasOwn(value.diagramRevisions, revision.parentId)
      || value.diagramRevisions[revision.parentId].diagramId !== revision.diagramId)) throw new Error('Invalid diagram revision parent');
    const refs = diagramContentNodes(revision.diagram.content).map(n => revision.nodeRefs[n.id]);
    if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) throw new Error('Invalid logical node identities');
  }
  for (const [key, snapshot] of Object.entries(value.snapshots)) {
    if (snapshot.id !== key || !snapshot.document || !snapshot.view || !snapshot.nodeOrigins || !snapshot.diagramBindings
      || snapshot.parentId && !Object.hasOwn(value.snapshots, snapshot.parentId)) throw new Error('Invalid canvas checkpoint');
    if ('contents' in snapshot.document.scene) throw new Error('Canvas checkpoint must not embed diagrams');
    const contents: Record<string, Diagram> = {};
    for (const [diagramId, revisionId] of Object.entries(snapshot.diagramBindings)) {
      const revision = Object.hasOwn(value.diagramRevisions, revisionId) && value.diagramRevisions[revisionId];
      if (!revision || revision.diagramId !== diagramId) throw new Error('Invalid diagram binding');
      contents[diagramId] = revision.diagram;
    }
    const scene = { root: snapshot.document.scene.root, contents };
    projectCanvasSnapshot(scene);
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
  return structuredClone({ ...snapshot.document, scene, edges: snapshot.document.edges.map(edge => ({ ...edge,
    source: decode(edge.source, edge.id + ':source') as ContentNodeAnchor, target: decode(edge.target, edge.id + ':target') })) });
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
