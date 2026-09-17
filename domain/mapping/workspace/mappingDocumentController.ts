import { normalizeDiagramViews, resolveDiagramContent, projectDiagramContent } from './diagramViewState';
import { layoutFloatingSelections } from './floatingBoxLayout';
import { layoutConversationPane } from '../chat/conversationPaneLayout';
import { flattenGrid, resolveScene } from '../../core/diagrams/lineGrid';
import { projectCanvasSnapshot } from '../../core/diagrams/projectDiagramCanvas';
import { layoutScene, updateGridBox, type GridPoint } from '../../core/diagrams/lineGrid';
import type { DiagramElementMapping } from '../../core/records/domain';
import { buildDiagramContent } from '../../core/diagrams/diagramContent';
import type { ProjectRepresentationEvidenceRecord } from '../../core/representations/projectCatalog';
import { insertGridDiagram, type MappingGridDocument } from './mappingGrid';
import { mappingDocumentFromScene } from './mappingDocument';
import { canvasDisplayNodes, findBox } from './canvasDisplayNode';
import { removeDisplayNode, setExpansion, updateDisplayGeometry } from './displayModel';
import type { MappingCanvasState } from './mappingWorkspace';

export interface ControllerSnapshot { document: MappingGridDocument; canvas: MappingCanvasState; version: number; canUndo: boolean; canRedo: boolean }
export type DiagramOperation =
  | { method: 'draw'; id: string; ascii: string; structureKind?: 'diagram' | 'tree'; parentId?: string; position?: GridPoint; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'replace'; nodeId: string; ascii: string; structureKind?: 'diagram' | 'tree'; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'move'; nodeId: string; position: GridPoint | { x: number; y: number } }
  | { method: 'collapse'; nodeId: string; contentNodeId?: string; collapsed: boolean }
  | { method: 'remove'; nodeId: string };
type State = Pick<ControllerSnapshot, 'document' | 'canvas'>;
export class MappingDocumentController {
  private past: State[] = [];
  private future: State[] = [];
  private listeners = new Set<() => void>();
  private snapshot: ControllerSnapshot;
  private layout?: { cell: { width: number; height: number }; viewport: { width: number; height: number } };
  configureLayout(cell: { width: number; height: number }, viewport: { width: number; height: number }) {
    this.layout = { cell, viewport };
    this.publish(this.resolveFloatingGeometry(this.snapshot), false, false);
  }
  private resolveFloatingGeometry(state: State): State {
    if (!this.layout) return state;
    let display = layoutFloatingSelections(state.canvas.display, flattenGrid(resolveScene(state.document.scene)), state.document.scene, this.layout.cell, state.canvas.diagramViews);
    for (const node of Object.values(display.nodes)) if (node.kind === 'conversation') display = layoutConversationPane(display, node, this.layout.viewport);
    return display === state.canvas.display ? state : { ...state, canvas: { ...state.canvas, display } };
  }
  constructor(document: MappingGridDocument, canvas: MappingCanvasState, version = 0) {
    this.snapshot = { document, canvas, version, canUndo: false, canRedo: false };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  nodes() { return canvasDisplayNodes(this.snapshot.document, this.snapshot.canvas, this.snapshot.version); }
  private publish(next: State, record: boolean, increment = true) {
    const diagramViews = normalizeDiagramViews(next.document.scene, next.canvas.diagramViews);
    if (diagramViews !== next.canvas.diagramViews) next = { ...next, canvas: { ...next.canvas, diagramViews } };
    next = this.resolveFloatingGeometry(next);
    if (next.document === this.snapshot.document && next.canvas === this.snapshot.canvas) return;
    if (record) { this.past = [...this.past.slice(-49), this.snapshot]; this.future = []; }
    this.snapshot = { ...next, version: this.snapshot.version + Number(increment), canUndo: !!this.past.length, canRedo: !!this.future.length };
    this.listeners.forEach(listener => listener());
  }
  updateCanvas(value: MappingCanvasState | ((current: MappingCanvasState) => MappingCanvasState), record = false) {
    const next = typeof value === 'function' ? value(this.snapshot.canvas) : value;
    this.publish({ document: this.snapshot.document, canvas: next }, record, record);
  }
  commitDocument(document: MappingGridDocument) { this.publish({ document, canvas: this.snapshot.canvas }, true); }
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
      if (op.method === 'collapse' && op.contentNodeId !== undefined) {
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
      } else if (op.method === 'draw' || op.method === 'replace') {
        const ascii = op.ascii?.replace(/\r\n?/g, '\n');
        const mappings = op.mappings ?? [];
        buildDiagramContent(ascii, 'validation', op.structureKind ?? 'diagram', mappings);
        if (op.evidence) document.evidence = { ...document.evidence, ...op.evidence };
        if (op.method === 'draw') {
          safeId(op.id);
          if (findBox(document.scene.root, op.id) || Object.hasOwn(document.scene.contents, op.id) || Object.hasOwn(document.scene.contents, `${op.id}-summary`)) throw new Error('Node ID already exists');
          const parentId = op.parentId ? this.gridId(op.parentId) : document.scene.root.id;
          document = insertGridDiagram(document, parentId, { id: op.id, kind: 'diagram', contentId: op.id, collapsed: false, position: op.position ?? { column: 0, row: 0 } },
            { id: op.id, ascii, revision: 0, structureKind: op.structureKind, mappings });
        } else {
          const id = this.gridId(op.nodeId), box = findBox(document.scene.root, id);
          if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
          const old = document.scene.contents[box.contentId];
          const scene = layoutScene({ ...document.scene, contents: { ...document.scene.contents, [old.id]: { ...old, ascii, mappings, revision: old.revision + 1, structureKind: op.structureKind ?? old.structureKind } } }, id);
          document = mappingDocumentFromScene(scene, document.evidence ?? {});
        }
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
          document = { ...document, scene: { ...document.scene, root: prune(document.scene.root) } };
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
    projectCanvasSnapshot(document.scene, document.evidence ?? {});
    if (operations.some(op => op.method === 'draw' || op.method === 'replace')) document = { ...document, scene: { ...document.scene, contents: Object.fromEntries(Object.entries(document.scene.contents).map(([id, content]) => [id,
      { ...content, diagramContent: buildDiagramContent(content.ascii, `${content.id}:${content.revision}`, content.structureKind ?? 'diagram', content.mappings) }])) } };
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
