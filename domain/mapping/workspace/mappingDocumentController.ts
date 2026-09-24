import { equalEndpointBounds, type EndpointBounds } from './endpointGeometry';
import type { CanvasHistoryRecord } from './canvasHistory';
import { RevisionedDiagramService, type DiagramService, type DiagramEditingContext, type DiagramEdit } from '../../core/diagrams/diagramService';
import { connectionBox, type DiagramAnchor } from '../../core/diagrams/diagramConnection';
import { rebaseDiagramJumps, type DiagramJump } from '../../core/diagrams/diagramJump';
import { normalizeDiagramViews, resolveDiagramContent, projectDiagramContent } from './diagramViewState';
import { layoutFloatingSelections } from './floatingBoxLayout';
import { layoutConversationPane } from '../chat/conversationPaneLayout';
import { flattenGrid, resolveScene } from '../../core/diagrams/lineGrid';
import { projectCanvasSnapshot } from '../../core/diagrams/projectDiagramCanvas';
import { layoutScene, updateGridBox, type GridPoint } from '../../core/diagrams/lineGrid';
import type { DiagramElementMapping } from '../../core/records/domain';
import { type DiagramSourceBinding } from '../../core/diagrams/diagram';
import type { ProjectRepresentationEvidenceRecord } from '../../core/representations/projectCatalog';
import { insertGridDiagram, type MappingGridDocument } from './mappingGrid';
import { canvasDisplayNodes, findBox } from './canvasDisplayNode';
import { removeDisplayNode, setExpansion, updateDisplayGeometry } from './displayModel';
import type { MappingCanvasState } from './mappingWorkspace';
import { diagramConnectionSchema, reconcileConnections, validateConnectionAnchor, validateConnections, type DiagramConnection } from '../../core/diagrams/diagramConnection';

export interface ControllerSnapshot { contextId: string; canvasRevisionId: string; endpointBounds?: EndpointBounds; document: MappingGridDocument; canvas: MappingCanvasState; version: number; canUndo: boolean; canRedo: boolean; cell?: { width: number; height: number } }
export type DiagramOperation =
  | { method: 'patchDiagram'; nodeId: string; start: number; end: number; patch: string; mappings?: DiagramElementMapping[] }
  | { method: 'setJumps'; nodeId: string; jumps: DiagramJump[] }
  | { method: 'edge-create'; edge: DiagramConnection }
  | { method: 'edge-update'; edge: DiagramConnection }
  | { method: 'edge-remove'; edgeId: string }
  | { method: 'diagram-create'; id: string; ascii: string; structureKind?: 'diagram' | 'tree'; source?: DiagramSourceBinding; parentId?: string; position?: GridPoint; minimumSize?: { columns: number; rows: number }; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'replace'; nodeId: string; ascii: string; structureKind?: 'diagram' | 'tree'; source?: DiagramSourceBinding; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'move'; nodeId: string; position: GridPoint | { x: number; y: number } }
  | { method: 'collapse'; nodeId: string; contentNodeId?: string; collapsed: boolean }
  | { method: 'group'; nodeId: string; id: string }
  | { method: 'remove'; nodeId: string };
type State = Pick<ControllerSnapshot, 'document' | 'canvas'>;
export class MappingDocumentController {
  private readonly context: DiagramEditingContext;
  private pendingNodeIds = new Map<string, string>();
  private listeners = new Set<() => void>();
  private snapshot: ControllerSnapshot;
  private nodeCache?: { snapshot: ControllerSnapshot; nodes: ReturnType<typeof canvasDisplayNodes> };
  configureEndpointBounds(bounds: EndpointBounds) {
    if (Object.values(bounds).some(rect => ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0)) throw new Error('Invalid endpoint measurement');
    if (equalEndpointBounds(this.snapshot.endpointBounds, bounds)) return;
    this.snapshot = { ...this.snapshot, endpointBounds: structuredClone(bounds) };
    this.listeners.forEach(listener => listener());
  }
  private layout?: { cell: { width: number; height: number }; viewport: { width: number; height: number } };
  configureLayout(cell: { width: number; height: number }, viewport: { width: number; height: number }) {
    this.layout = { cell, viewport };
    this.updateSnapshot(this.resolveFloatingGeometry(this.snapshot), false, false);
    if (this.snapshot.cell?.width !== cell.width || this.snapshot.cell?.height !== cell.height) {
      this.snapshot = { ...this.snapshot, cell, endpointBounds: this.snapshot.endpointBounds ? {} : undefined };
      this.listeners.forEach(listener => listener());
    }
  }
  private resolveFloatingGeometry(state: State): State {
    if (!this.layout) return state;
    let display = layoutFloatingSelections(state.canvas.display, flattenGrid(resolveScene(state.document.scene)), state.document.scene, this.layout.cell, state.canvas.diagramViews);
    for (const node of Object.values(display.nodes)) if (node.kind === 'conversation') display = layoutConversationPane(display, node, this.layout.viewport);
    return display === state.canvas.display ? state : { ...state, canvas: { ...state.canvas, display } };
  }
  constructor(document: MappingGridDocument, canvas: MappingCanvasState, version = 0, cell?: ControllerSnapshot['cell'], endpointBounds?: EndpointBounds, history?: CanvasHistoryRecord, private readonly diagrams: DiagramService = new RevisionedDiagramService()) {
    const normalized = history && structuredClone(history);
    if (normalized) for (const snapshot of Object.values(normalized.snapshots)) {
      if (!snapshot.view || typeof snapshot.view !== 'object' || !('display' in snapshot.view)) snapshot.view = structuredClone(canvas);
    }
    this.context = diagrams.openContext(document, canvas, normalized);
    const historyState = diagrams.state(this.context);
    this.snapshot = { contextId: this.context.contextId, canvasRevisionId: historyState.checkpointId, document: { ...structuredClone(document), edges: validateConnections(document.scene, document.edges) }, canvas, version, canUndo: historyState.canUndo, canRedo: historyState.canRedo, cell, endpointBounds };
  }
  getSnapshot = () => this.snapshot;
  /** Canonical persistence boundary. Legacy document snapshots are read projections. */
  exportHistory() { return this.diagrams.exportContext(this.context); }
  forkHistory() { return this.diagrams.forkContext(this.context, this.snapshot.canvas); }
  resolveDiagram(diagramId: string) { return this.diagrams.resolve(this.context, diagramId); }
  getCanvasSnapshot() { return this.diagrams.state(this.context).document; }
  private prepareDiagramEdit(document: MappingGridDocument, diagramId: string, edit: DiagramEdit) {
    // MCP batches see preceding staged operations without advancing the live head.
    return this.diagrams.prepareEdit(document, diagramId, edit);
  }
  private trackNodes(ids: ReadonlyMap<string, string>) {
    for (const [original, current] of this.pendingNodeIds) if (ids.has(current)) this.pendingNodeIds.set(original, ids.get(current)!);
    for (const [before, after] of ids) if (!this.pendingNodeIds.has(before)) this.pendingNodeIds.set(before, after);
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  nodes() {
    if (this.nodeCache?.snapshot !== this.snapshot) this.nodeCache = { snapshot: this.snapshot,
      nodes: canvasDisplayNodes(this.snapshot.document, this.snapshot.canvas, this.snapshot.version, this.snapshot.cell, this.snapshot.endpointBounds) };
    return structuredClone(this.nodeCache.nodes);
  }
  private updateSnapshot(next: State, record: boolean, increment = true) {
    if (next.document !== this.snapshot.document && next.document.scene !== this.snapshot.document.scene && record) {
      next = { ...next, document: { ...next.document, edges: reconcileConnections(this.snapshot.document.scene, next.document.scene, next.document.edges ?? []) } };
    }
    if (next.document !== this.snapshot.document && record) validateConnections(next.document.scene, next.document.edges);
    const diagramViews = normalizeDiagramViews(next.document.scene, next.canvas.diagramViews);
    if (diagramViews !== next.canvas.diagramViews) next = { ...next, canvas: { ...next.canvas, diagramViews } };
    next = this.resolveFloatingGeometry(next);
    if (next.document === this.snapshot.document && next.canvas === this.snapshot.canvas) return;
    if (record) this.diagrams.append(this.context, next.document, next.canvas, this.pendingNodeIds);
    const geometryChanged = next.document.scene !== this.snapshot.document.scene || next.canvas.diagramViews !== this.snapshot.canvas.diagramViews;
    const endpointBounds = geometryChanged && this.snapshot.endpointBounds ? {} : this.snapshot.endpointBounds;
    const historyState = this.diagrams.state(this.context);
    this.snapshot = { ...next, contextId: this.context.contextId, canvasRevisionId: historyState.checkpointId, endpointBounds, cell: this.snapshot.cell, version: this.snapshot.version + Number(increment), canUndo: historyState.canUndo, canRedo: historyState.canRedo };
    this.listeners.forEach(listener => listener());
  }
  updateCanvas(value: MappingCanvasState | ((current: MappingCanvasState) => MappingCanvasState), record = false) {
    const next = typeof value === 'function' ? value(this.snapshot.canvas) : value;
    this.updateSnapshot({ document: this.snapshot.document, canvas: next }, record, record);
  }
  commitDocument(document: MappingGridDocument) { projectCanvasSnapshot(document.scene); this.updateSnapshot({ document, canvas: this.snapshot.canvas }, true); }
  undo(redo = false) {
    if (!this.diagrams.navigate(this.context, redo)) return;
    this.updateSnapshot({ document: this.diagrams.document(this.context), canvas: this.diagrams.state(this.context).view as MappingCanvasState }, false);
  }
  reset() {
    this.diagrams.reset(this.context);
    this.updateSnapshot({ document: this.diagrams.document(this.context), canvas: this.diagrams.state(this.context).view as MappingCanvasState }, false);
  }
  /** One shared command path. transact is retained as the MCP batch adapter. */
  applyUpdate(expectedVersion: number, operations: DiagramOperation[]) {
    this.pendingNodeIds.clear();
    try { return this.applyOperations(expectedVersion, operations); }
    finally { this.pendingNodeIds.clear(); }
  }
  transact(expectedVersion: number, operations: DiagramOperation[]) { return this.applyUpdate(expectedVersion, operations); }
  private applyOperations(expectedVersion: number, operations: DiagramOperation[]) {
    if (expectedVersion !== this.snapshot.version) throw new Error('VERSION_CONFLICT: read the canvas again');
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error('Expected 1–100 operations');
    let { document, canvas } = structuredClone(this.snapshot);
    const safeId = (id: string) => { if (typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('Invalid node ID'); };
    for (const op of operations) {
      if (op.method === 'patchDiagram') {
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
        const before = document.scene.contents[box.contentId];
        const { diagram, nodeIds, lineAfter: mapLine } = this.prepareDiagramEdit(document, before.id, { kind: 'patch', start: op.start, end: op.end, patch: op.patch, mappings: op.mappings });
        const lineAfter = mapLine!;
        this.trackNodes(nodeIds);
        const reanchor = <T extends DiagramAnchor>(anchor: T): T => {
          const owner = connectionBox(document.scene, anchor.displayNodeId);
          if (anchor.kind !== 'content-node' || owner?.kind !== 'diagram' || owner.contentId !== before.id
            || anchor.revisionId !== before.content.revisionId || !nodeIds.has(anchor.contentNodeId)) return anchor;
          return { ...anchor, revisionId: diagram.content.revisionId, contentNodeId: nodeIds.get(anchor.contentNodeId)! };
        };
        const edges = document.edges.map(edge => ({ ...edge, source: reanchor(edge.source), target: reanchor(edge.target) }));
        for (const [id, view] of Object.entries(canvas.diagramViews ?? {})) {
          const owner = connectionBox(document.scene, id);
          if (owner?.kind === 'diagram' && owner.contentId === before.id && view.contentRevisionId === before.content.revisionId) {
            canvas.diagramViews![id] = { contentRevisionId: diagram.content.revisionId,
              collapsedContentNodeIds: view.collapsedContentNodeIds.flatMap(id => nodeIds.has(id) ? [nodeIds.get(id)!] : []) };
          }
        }
        const sections = (document.sections[before.id] ?? []).flatMap(section => {
          const startLine = lineAfter(section.startLine), endLine = lineAfter(section.endLine);
          return startLine === undefined || endLine === undefined ? [] : [{ ...section, startLine, endLine }];
        });
        document = { ...document, edges, sections: { ...document.sections, [before.id]: sections },
          scene: layoutScene({ ...document.scene, contents: { ...document.scene.contents, [before.id]: diagram } }, box.id) };
      } else if (op.method === 'setJumps') {
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
        const diagram = document.scene.contents[box.contentId];
        const prepared = this.prepareDiagramEdit(document, diagram.id, { kind: 'jumps', jumps: op.jumps });
        this.trackNodes(prepared.nodeIds);
        document = { ...document, scene: { ...document.scene, contents: { ...document.scene.contents, [box.contentId]: prepared.diagram } } };
      } else if (op.method === 'edge-create' || op.method === 'edge-update') {
        const edge = diagramConnectionSchema.parse(op.edge);
        const previous = document.edges.find(item => item.id === edge.id);
        if (op.method === 'edge-create' ? !!previous : !previous) throw new Error(op.method === 'edge-create' ? 'Connection ID already exists' : 'Unknown connection');
        for (const end of ['source', 'target'] as const) {
          const unchanged = previous && JSON.stringify(previous[end]) === JSON.stringify(edge[end]);
          validateConnectionAnchor(document.scene, edge[end], !!unchanged);
        }
        document = { ...document, edges: previous ? document.edges.map(item => item.id === edge.id ? edge : item) : [...document.edges, edge] };
        if (document.edges.length > 2000) throw new Error('Too many connections');
      } else if (op.method === 'edge-remove') {
        if (!document.edges.some(edge => edge.id === op.edgeId)) throw new Error('Unknown connection');
        document = { ...document, edges: document.edges.filter(edge => edge.id !== op.edgeId) };
      } else if (op.method === 'collapse' && op.contentNodeId !== undefined) {
        if (typeof op.collapsed !== 'boolean') throw new Error('collapsed must be boolean');
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw new Error('Subtree collapse requires a diagram DisplayNode');
        const content = resolveDiagramContent(document.scene.contents[box.contentId]);
        if (content.structure.kind !== 'tree' || !Object.hasOwn(content.structure.nodes, op.contentNodeId)) throw new Error('STALE_CONTENT_NODE');
        if (!content.structure.nodes[op.contentNodeId].childIds.length) throw new Error('Content node has no children');
        const old = canvas.diagramViews?.[op.nodeId];
        const ids = new Set(old?.contentRevisionId === content.revisionId ? old.collapsedContentNodeIds : []);
        if (op.collapsed) ids.add(op.contentNodeId); else ids.delete(op.contentNodeId);
        canvas.diagramViews = { ...canvas.diagramViews, [op.nodeId]: { contentRevisionId: content.revisionId, collapsedContentNodeIds: [...ids] } };
        if (canvas.controls.activeBoxId === box.id && canvas.controls.selectionRect
          && !projectDiagramContent(content, canvas.diagramViews[op.nodeId]).rect(canvas.controls.selectionRect)) {
          canvas.controls = { ...canvas.controls, selectionRect: null, selectedNodeIds: [], retainedSelectionId: null };
        }
      } else if (op.method === 'diagram-create' || op.method === 'replace') {
        const ascii = op.ascii?.replace(/\r\n?/g, '\n');
        const mappings = op.mappings ?? [];

        if (op.method === 'diagram-create') {
          safeId(op.id);
          if (findBox(document.scene.root, op.id) || Object.hasOwn(document.scene.contents, op.id) || Object.hasOwn(document.scene.contents, `${op.id}-summary`)) throw new Error('Node ID already exists');
          const parentId = op.parentId ? this.gridId(op.parentId) : document.scene.root.id;
          document = insertGridDiagram(document, parentId, { id: op.id, kind: 'diagram', contentId: op.id, collapsed: false, minimumSize: op.minimumSize, position: op.position ?? { column: 0, row: 0 } },
            this.diagrams.prepareCreate({ id: op.id, ascii, revision: 0, structureKind: op.structureKind, mappings, source: op.source, evidence: op.evidence }).diagram);
        } else {
          const id = this.gridId(op.nodeId), box = findBox(document.scene.root, id);
          if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
          const old = document.scene.contents[box.contentId];
          const prepared = this.prepareDiagramEdit(document, old.id, { kind: 'replace', input: { ascii, mappings,
            structureKind: op.structureKind ?? old.content.structure.kind, source: op.source ?? old.sourceContext.binding,
            evidence: op.evidence ?? old.sourceContext.evidence } });
          const replacement = prepared.diagram;
          this.trackNodes(prepared.nodeIds);
          if (old.jumps) replacement.jumps = rebaseDiagramJumps(old.content, replacement.content, old.jumps);
          const scene = layoutScene({ ...document.scene, contents: { ...document.scene.contents, [old.id]: replacement } }, id);
          document = { ...document, scene, edges: reconcileConnections(document.scene, scene, document.edges) };
        }
      } else if (op.nodeId?.startsWith('floating:edge:')) {
        const edgeId = op.nodeId.slice('floating:edge:'.length);
        if (op.method !== 'remove') throw new Error('Arrows follow their anchors; use edges.update to reattach');
        if (!document.edges.some(edge => edge.id === edgeId)) throw new Error('Unknown connection');
        document = { ...document, edges: document.edges.filter(edge => edge.id !== edgeId) };
      } else if (op.nodeId?.startsWith('grid:')) {
        const id = this.gridId(op.nodeId), box = findBox(document.scene.root, id);
        if (!box || id === document.scene.root.id) throw new Error('Unknown or protected GridBox');
        if (op.method === 'move') {
          if (!('column' in op.position) || !('row' in op.position)) throw new Error('GridBoxes require cell coordinates');
          const absolute = canvasDisplayNodes(document, canvas, 0).find(node => node.id === op.nodeId)!;
          if (absolute.layout !== 'grid') throw new Error('Expected GridBox');
          const position = { column: op.position.column - (absolute.geometry.bounds.column - box.position.column), row: op.position.row - (absolute.geometry.bounds.row - box.position.row) };
          document = { ...document, scene: layoutScene(updateGridBox(document.scene, id, item => ({ ...item, position })), id) };
        } else if (op.method === 'collapse') {
          if (typeof op.collapsed !== 'boolean') throw new Error('collapsed must be boolean');
          document = { ...document, scene: layoutScene(updateGridBox(document.scene, id, item => ({ ...item, collapsed: op.collapsed })), id) };
        } else if (op.method === 'group') {
          safeId(op.id);
          const summaryId = `${op.id}-summary`;
          if (findBox(document.scene.root, op.id) || Object.hasOwn(document.scene.contents, summaryId)) throw new Error('Node ID already exists');
          const summary = this.diagrams.prepareCreate({ id: summaryId, revision: 0, ascii: '[Diagram group]' }).diagram;
          const scene = updateGridBox({ ...document.scene, contents: { ...document.scene.contents, [summaryId]: summary } }, id, box => ({
            id: op.id, kind: 'container', position: box.position, collapsed: false, collapsedContentId: summaryId,
            children: [{ ...box, position: { column: 0, row: 0 } }], layout: { collisionPolicy: 'push-right', gap: 3 }
          }));
          document = { ...document, scene: layoutScene(scene, op.id) };
        } else if (op.method === 'remove') {
          const prune = (node: typeof box): typeof box => node.kind === 'container' ? { ...node, children: node.children.filter(child => child.id !== id).map(prune) } : node;
          const scene = { ...document.scene, root: prune(document.scene.root) };
          document = { ...document, scene, edges: reconcileConnections(document.scene, scene, document.edges) };
        } else throw new Error('Unsupported GridBox operation');
      } else {
        const id = op.nodeId?.startsWith('floating:') ? op.nodeId.slice(9) : '';
        const node = canvas.display.nodes[id];
        if (!node) throw new Error('Unknown FloatingBox');
        if (op.method === 'move') {
          if (!('x' in op.position) || !('y' in op.position) || !Number.isFinite(op.position.x) || !Number.isFinite(op.position.y)) throw new Error('FloatingBoxes require finite pixel coordinates');
          canvas.display = updateDisplayGeometry(canvas.display, id, { position: op.position });
          canvas.display.nodes[id] = { ...canvas.display.nodes[id], geometryPolicy: { ...node.geometryPolicy, placement: 'manual' } };
        } else if (op.method === 'collapse') {
          if (typeof op.collapsed !== 'boolean') throw new Error('collapsed must be boolean');
          canvas.display = setExpansion(canvas.display, id, op.collapsed ? 'collapsed' : 'expanded');
        } else if (op.method === 'remove') {
          canvas.display = removeDisplayNode(canvas.display, id);
          const controls = canvas.controls;
          canvas.controls = { ...controls, surfaces: Object.fromEntries(Object.entries(controls.surfaces).filter(([key]) => key === 'draft' || canvas.display.nodes[key])),
            retainedSelectionId: controls.retainedSelectionId && canvas.display.nodes[controls.retainedSelectionId] ? controls.retainedSelectionId : null,
            activeThreadId: controls.activeThreadId && canvas.display.nodes[controls.activeThreadId] ? controls.activeThreadId : null };
        } else throw new Error('Unsupported FloatingBox operation');
      }
    }
    projectCanvasSnapshot(document.scene);
    const active = findBox(document.scene.root, canvas.controls.activeBoxId);
    if (!active) {
      const first = canvasDisplayNodes(document, canvas, 0).find(node => node.layout === 'grid' && node.kind === 'diagram');
      if (first?.layout === 'grid') canvas.controls.activeBoxId = first.boxId;
    }
    this.updateSnapshot({ document, canvas }, true);
    return { version: this.snapshot.version, nodes: this.nodes() };
  }
  private gridId(id: string) { if (!id.startsWith('grid:')) throw new Error('Expected GridBox ID'); return id.slice(5); }
}
