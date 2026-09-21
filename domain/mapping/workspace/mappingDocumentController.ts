import { equalEndpointBounds, type EndpointBounds } from './endpointGeometry';
import { patchDiagram } from '../../core/diagrams/patchDiagram';
import { connectionBox, type DiagramAnchor } from '../../core/diagrams/diagramConnection';
import { rebaseDiagramJumps, validateDiagramJumps, type DiagramJump } from '../../core/diagrams/diagramJump';
import { normalizeDiagramViews, resolveDiagramContent, projectDiagramContent } from './diagramViewState';
import { layoutFloatingSelections } from './floatingBoxLayout';
import { layoutConversationPane } from '../chat/conversationPaneLayout';
import { flattenGrid, resolveScene } from '../../core/diagrams/lineGrid';
import { projectCanvasSnapshot } from '../../core/diagrams/projectDiagramCanvas';
import { layoutScene, updateGridBox, type GridPoint } from '../../core/diagrams/lineGrid';
import type { DiagramElementMapping } from '../../core/records/domain';
import { createDiagram, type DiagramSourceBinding } from '../../core/diagrams/diagram';
import type { ProjectRepresentationEvidenceRecord } from '../../core/representations/projectCatalog';
import { insertGridDiagram, type MappingGridDocument } from './mappingGrid';
import { canvasDisplayNodes, findBox } from './canvasDisplayNode';
import { removeDisplayNode, setExpansion, updateDisplayGeometry } from './displayModel';
import type { MappingCanvasState } from './mappingWorkspace';
import { diagramConnectionSchema, reconcileConnections, validateConnectionAnchor, validateConnections, type DiagramConnection } from '../../core/diagrams/diagramConnection';

export interface ControllerSnapshot { endpointBounds?: EndpointBounds; document: MappingGridDocument; canvas: MappingCanvasState; version: number; canUndo: boolean; canRedo: boolean; cell?: { width: number; height: number } }
export type DiagramOperation =
  | { method: 'patchDiagram'; nodeId: string; start: number; end: number; patch: string }
  | { method: 'setJumps'; nodeId: string; jumps: DiagramJump[] }
  | { method: 'edge-create'; edge: DiagramConnection }
  | { method: 'edge-update'; edge: DiagramConnection }
  | { method: 'edge-remove'; edgeId: string }
  | { method: 'diagram-create'; id: string; ascii: string; structureKind?: 'diagram' | 'tree'; source?: DiagramSourceBinding; parentId?: string; position?: GridPoint; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'replace'; nodeId: string; ascii: string; structureKind?: 'diagram' | 'tree'; source?: DiagramSourceBinding; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'move'; nodeId: string; position: GridPoint | { x: number; y: number } }
  | { method: 'collapse'; nodeId: string; contentNodeId?: string; collapsed: boolean }
  | { method: 'remove'; nodeId: string };
type State = Pick<ControllerSnapshot, 'document' | 'canvas'>;
export class MappingDocumentController {
  private past: State[] = [];
  private future: State[] = [];
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
    this.publish(this.resolveFloatingGeometry(this.snapshot), false, false);
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
  constructor(document: MappingGridDocument, canvas: MappingCanvasState, version = 0, cell?: ControllerSnapshot['cell'], endpointBounds?: EndpointBounds) {
    this.snapshot = { document: { ...document, edges: validateConnections(document.scene, document.edges) }, canvas, version, canUndo: false, canRedo: false, cell, endpointBounds };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  nodes() {
    if (this.nodeCache?.snapshot !== this.snapshot) this.nodeCache = { snapshot: this.snapshot,
      nodes: canvasDisplayNodes(this.snapshot.document, this.snapshot.canvas, this.snapshot.version, this.snapshot.cell, this.snapshot.endpointBounds) };
    return structuredClone(this.nodeCache.nodes);
  }
  private publish(next: State, record: boolean, increment = true) {
    if (next.document !== this.snapshot.document && next.document.scene !== this.snapshot.document.scene && record) {
      next = { ...next, document: { ...next.document, edges: reconcileConnections(this.snapshot.document.scene, next.document.scene, next.document.edges ?? []) } };
    }
    if (next.document !== this.snapshot.document && record) validateConnections(next.document.scene, next.document.edges);
    const diagramViews = normalizeDiagramViews(next.document.scene, next.canvas.diagramViews);
    if (diagramViews !== next.canvas.diagramViews) next = { ...next, canvas: { ...next.canvas, diagramViews } };
    next = this.resolveFloatingGeometry(next);
    if (next.document === this.snapshot.document && next.canvas === this.snapshot.canvas) return;
    if (record) { this.past = [...this.past.slice(-49), this.snapshot]; this.future = []; }
    const geometryChanged = next.document.scene !== this.snapshot.document.scene || next.canvas.diagramViews !== this.snapshot.canvas.diagramViews;
    const endpointBounds = geometryChanged && this.snapshot.endpointBounds ? {} : this.snapshot.endpointBounds;
    this.snapshot = { ...next, endpointBounds, cell: this.snapshot.cell, version: this.snapshot.version + Number(increment), canUndo: !!this.past.length, canRedo: !!this.future.length };
    this.listeners.forEach(listener => listener());
  }
  updateCanvas(value: MappingCanvasState | ((current: MappingCanvasState) => MappingCanvasState), record = false) {
    const next = typeof value === 'function' ? value(this.snapshot.canvas) : value;
    this.publish({ document: this.snapshot.document, canvas: next }, record, record);
  }
  commitDocument(document: MappingGridDocument) { projectCanvasSnapshot(document.scene); this.publish({ document, canvas: this.snapshot.canvas }, true); }
  undo(redo = false) {
    const target = redo ? this.future.shift() : this.past.pop();
    if (!target) return;
    if (redo) this.past.push(this.snapshot); else this.future.unshift(this.snapshot);
    this.publish(target, false);
  }
  transact(expectedVersion: number, operations: DiagramOperation[]) {
    if (expectedVersion !== this.snapshot.version) throw new Error('VERSION_CONFLICT: read the canvas again');
    if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw new Error('Expected 1–100 operations');
    let { document, canvas } = structuredClone(this.snapshot);
    const safeId = (id: string) => { if (typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('Invalid node ID'); };
    for (const op of operations) {
      if (op.method === 'patchDiagram') {
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
        const before = document.scene.contents[box.contentId];
        const { diagram, nodeIds, lineAfter } = patchDiagram(before, op.start, op.end, op.patch);
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
        const jumps = validateDiagramJumps(diagram.content, op.jumps, false);
        document = { ...document, scene: { ...document.scene, contents: { ...document.scene.contents, [box.contentId]: { ...diagram, jumps } } } };
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
          document = insertGridDiagram(document, parentId, { id: op.id, kind: 'diagram', contentId: op.id, collapsed: false, position: op.position ?? { column: 0, row: 0 } },
            createDiagram({ id: op.id, ascii, revision: 0, structureKind: op.structureKind, mappings, source: op.source, evidence: op.evidence }));
        } else {
          const id = this.gridId(op.nodeId), box = findBox(document.scene.root, id);
          if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
          const old = document.scene.contents[box.contentId];
          const replacement = createDiagram({ id: old.id, ascii, mappings, revision: old.revision + 1,
            structureKind: op.structureKind ?? old.content.structure.kind, source: op.source ?? old.sourceContext.binding,
            evidence: op.evidence ?? old.sourceContext.evidence });
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
    this.publish({ document, canvas }, true);
    return { version: this.snapshot.version, nodes: this.nodes() };
  }
  private gridId(id: string) { if (!id.startsWith('grid:')) throw new Error('Expected GridBox ID'); return id.slice(5); }
}
