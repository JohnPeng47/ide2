import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { highlightColorSchema } from '../../core/diagrams/diagramHighlight';
import { syncSelectionPresentation } from '../selection/selectionPresentation';
import { importLegacySelection } from '../selection/importLegacySelection';
import { updateSelection } from '../selection/canvasSelection';
import type { SelectionCommand } from '../selection/selectionState';
import { receiveDiagramRevision } from '../../core/diagrams/diagramRevisionTransfer';
import type { DiagramRevision } from '../../core/diagrams/diagramRevisionEditor';
import { DefaultCanvasHistoryService, type CanvasHistoryService, type CanvasEditingContext } from '../../core/diagrams/canvasHistoryService';
import { equalEndpointBounds, type EndpointBounds } from './endpointGeometry';
import type { CanvasHistoryRecord } from './canvasHistory';
import { RevisionedDiagramService, type DiagramService, type DiagramEdit } from '../../core/diagrams/diagramService';
import { connectionBox, type DiagramAnchor } from '../../core/diagrams/diagramConnection';
import { activeDiagramJumps, rebaseDiagramJumps, type DiagramJump } from '../../core/diagrams/diagramJump';
import { normalizeDiagramViews, resolveDiagramContent, projectDiagramContent } from './diagramViewState';
import { layoutFloatingSelections } from './floatingBoxLayout';
import { layoutConversationPane } from '../chat/conversationPaneLayout';
import { emptyCanvasDocument } from '../../core/diagrams/canvasTransfer';
import { flattenGrid, resolveScene, type GridBox } from '../../core/diagrams/lineGrid';
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
  | { method: 'highlight'; nodeId: string; contentNodeId?: string; color?: string; highlightId: string }
  | { method: 'removeHighlights'; nodeId: string; highlightIds?: string[] }
  | { method: 'duplicate-instance'; sourceNodeId: string; id: string; position: GridPoint }
  | { method: 'delete-diagrams'; nodeIds: string[] }
  | { method: 'diagram-revision-apply'; nodeId: string; expectedRevisionId: string; revision: DiagramRevision }
  | { method: 'setSourceMappings'; nodeId: string; expectedContentHash: string; mappings: DiagramElementMapping[]; evidence: Record<string, ProjectRepresentationEvidenceRecord>; source?: DiagramSourceBinding }
  | { method: 'patchDiagram'; nodeId: string; start: number; end: number; patch: string; mappings?: DiagramElementMapping[] }
  | { method: 'setJumps'; nodeId: string; jumps: DiagramJump[] }
  | { method: 'edge-create'; edge: DiagramConnection }
  | { method: 'edge-update'; edge: DiagramConnection }
  | { method: 'edge-remove'; edgeId: string }
  | { method: 'diagram-insert'; id: string; revisionId: string; parentId?: string; position?: GridPoint; minimumSize?: { columns: number; rows: number } }
  | { method: 'diagram-create'; id: string; ascii: string; structureKind?: 'diagram' | 'tree'; source?: DiagramSourceBinding; parentId?: string; position?: GridPoint; minimumSize?: { columns: number; rows: number }; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'replace'; nodeId: string; ascii: string; structureKind?: 'diagram' | 'tree'; source?: DiagramSourceBinding; mappings?: DiagramElementMapping[]; evidence?: Record<string, ProjectRepresentationEvidenceRecord> }
  | { method: 'move'; nodeId: string; position: GridPoint | { x: number; y: number } }
  | { method: 'collapse'; nodeId: string; contentNodeId?: string; collapsed: boolean }
  | { method: 'group'; nodeId: string; id: string }
  | { method: 'remove'; nodeId: string };
type State = Pick<ControllerSnapshot, 'document' | 'canvas'>;
const defaultHistoryService = new DefaultCanvasHistoryService();

export class MappingDocumentController {
  /** Installed only by a mounted live canvas. Headless proposals retain domain history. */
  private editorDriver?: { settle(): void; undo(redo: boolean): void };
  attachEditorDriver(driver: { settle(): void; undo(redo: boolean): void }) {
    if (this.editorDriver) throw new Error('A canvas already has a live editor');
    this.editorDriver = driver;
    return () => { if (this.editorDriver === driver) this.editorDriver = undefined; };
  }
  /** Native history restores an archived semantic checkpoint, without creating an edit. */
  restoreEditorCheckpoint(checkpointId: string) {
    const history = this.editorHistory();
    const redo = history.future.includes(checkpointId);
    if (checkpointId !== history.headId && !(redo ? history.future : history.past).includes(checkpointId))
      throw new Error('Unknown editor checkpoint');
    while (this.historyService.state(this.context).checkpointId !== checkpointId) {
      if (!this.historyService.navigate(this.context, redo)) throw new Error('Cannot restore editor checkpoint');
    }
    this.updateSnapshot({ document: this.historyService.document(this.context), canvas: this.historyService.state(this.context).view as MappingCanvasState }, false);
  }
  private readonly context: CanvasEditingContext;
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
  constructor(document: MappingGridDocument, canvas: MappingCanvasState, version = 0, cell?: ControllerSnapshot['cell'], endpointBounds?: EndpointBounds, history?: CanvasHistoryRecord, private readonly diagrams: DiagramService = new RevisionedDiagramService(), private readonly historyService: CanvasHistoryService = defaultHistoryService) {
    canvas = syncSelectionPresentation(importLegacySelection(canvas, document.scene));
    const normalized = history && structuredClone(history);
    if (normalized) for (const snapshot of Object.values(normalized.snapshots)) {
      if (!snapshot.view || typeof snapshot.view !== 'object' || !('display' in snapshot.view)) snapshot.view = structuredClone(canvas);
    }
    this.context = this.historyService.openContext(document, canvas, normalized);
    const historyState = this.historyService.state(this.context);
    this.snapshot = { contextId: this.context.contextId, canvasRevisionId: historyState.checkpointId, document: this.historyService.document(this.context), canvas, version, canUndo: historyState.canUndo, canRedo: historyState.canRedo, cell, endpointBounds };
  }
  getSnapshot = () => this.snapshot;
  prepareTransfer(input: import('../../core/diagrams/canvasTransfer').TransferInput, destination?: MappingDocumentController) {
    return this.historyService.prepareTransfer(this.context, input, destination?.context);
  }
  transferBoundary(transaction: import('../../core/diagrams/canvasTransfer').CanvasTransfer, canvasId: string, redo = false) {
    return this.historyService.transferBoundary(this.context, transaction, canvasId, redo);
  }
  prepareTransferNavigation(destination: MappingDocumentController, transaction: import('../../core/diagrams/canvasTransfer').CanvasTransfer, redo = false) {
    return this.historyService.prepareTransferNavigation(this.context, destination.context, transaction, redo);
  }
  /** Canonical persistence boundary. Legacy document snapshots are read projections. */
  persistenceChanges(since?: number) { return this.historyService.persistenceChanges(this.context, since); }
  retireTransactions(ids: ReadonlySet<string>) { this.historyService.retireTransactions(this.context, ids); }
  /** Exact pinned revisions only; never traverse or clone the undo archive. */
  exportRevisions(ids: readonly string[], allowMissing = false) { return [...new Set(ids)].flatMap(id => {
    try { return [structuredClone(this.diagrams.getRevision(id))]; }
    catch (error) { if (allowMissing && error instanceof Error && error.message.startsWith('Unknown diagram revision:')) return []; throw error; }
  }); }
  exportHistory() { return this.historyService.exportContext(this.context); }
  /** Navigation metadata only: mounting/undo must not clone the content archive. */
  editorHistory(): import('../../core/diagrams/canvasHistory').CanvasHistoryNavigation {
    if (this.historyService.navigation) return this.historyService.navigation(this.context);
    const record = this.exportHistory();
    return { headId: record.headId, past: record.past, future: record.future,
      undoTransactionId: record.snapshots[record.headId]?.transactionId,
      redoTransactionId: record.snapshots[record.future.at(-1)!]?.transactionId };
  }
  forkHistory(view = this.snapshot.canvas) { return this.historyService.forkContext(this.context, view); }
  resolveDiagram(diagramId: string) { return this.historyService.resolve(this.context, diagramId); }
  getCanvasSnapshot() { return this.historyService.state(this.context).document; }
  private prepareDiagramEdit(document: MappingGridDocument, diagramId: string, edit: DiagramEdit) {
    // MCP batches see preceding staged operations without advancing the live head.
    return this.diagrams.revise(document.scene.contents[diagramId].revisionId, edit);
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
    next = { ...next, canvas: syncSelectionPresentation(importLegacySelection(next.canvas, next.document.scene)) };
    if (next.document.scene !== this.snapshot.document.scene || next.canvas.selection !== this.snapshot.canvas.selection
      || next.canvas.controls.selectionFocusId !== this.snapshot.canvas.controls.selectionFocusId) {
      // Deleted instances disappear from membership; captured regions remain available as stale snapshots.
      const boxes = new Map<string, string>();
      const visit = (box: typeof next.document.scene.root) => {
        if (box.kind === 'container') box.children.forEach(visit); else boxes.set(`grid:${box.id}`, box.contentId);
      };
      visit(next.document.scene.root);
      const items = next.canvas.selection.items.filter(item => item.region || boxes.has(item.displayNodeId));
      const focus = items.find(item => item.id === next.canvas.controls.selectionFocusId);
      const validFocus = focus?.region && boxes.get(focus.displayNodeId) === focus.region.sourceContentId
        && next.document.scene.contents[focus.region.sourceContentId]?.content.ascii === focus.region.sourceAscii;
      if (items.length !== next.canvas.selection.items.length || next.canvas.controls.selectionFocusId && !validFocus)
        next = { ...next, canvas: { ...next.canvas, selection: { items },
          controls: { ...next.canvas.controls, selectionFocusId: validFocus ? next.canvas.controls.selectionFocusId : null } } };
    }

    if (next.document === this.snapshot.document && next.canvas === this.snapshot.canvas) return;
    if (next.document !== this.snapshot.document && next.document.scene !== this.snapshot.document.scene && record) {
      next = { ...next, document: { ...next.document, edges: reconcileConnections(this.snapshot.document.scene, next.document.scene, next.document.edges ?? []),
        ...(next.document.jumps ? { jumps: next.document.jumps.flatMap(jump => {
          const owner = connectionBox(next.document.scene, jump.sourceDisplayNodeId);
          if (owner?.kind !== 'diagram') return [];
          const previous = connectionBox(this.snapshot.document.scene, jump.sourceDisplayNodeId);
          const before = previous?.kind === 'diagram' && this.snapshot.document.scene.contents[previous.contentId];
          return [before ? { ...jump, ...rebaseDiagramJumps(before.content, next.document.scene.contents[owner.contentId].content, [jump])[0] } : jump];
        }) } : {}) } };
    }
    if (next.document !== this.snapshot.document && record) validateConnections(next.document.scene, next.document.edges);
    const diagramViews = normalizeDiagramViews(next.document.scene, next.canvas.diagramViews);
    if (diagramViews !== next.canvas.diagramViews) next = { ...next, canvas: { ...next.canvas, diagramViews } };
    next = this.resolveFloatingGeometry(next);
    if (next.document === this.snapshot.document && next.canvas === this.snapshot.canvas) return;
    if (record) this.historyService.append(this.context, next.document, next.canvas, this.pendingNodeIds);
    const geometryChanged = next.document.scene !== this.snapshot.document.scene || next.canvas.diagramViews !== this.snapshot.canvas.diagramViews;
    const endpointBounds = geometryChanged && this.snapshot.endpointBounds ? {} : this.snapshot.endpointBounds;
    // Transient selection/layout updates do not advance history. Reading state
    // clones the checkpoint's document and view, which can be large.
    const historyState = record || increment ? this.historyService.state(this.context) : {
      checkpointId: this.snapshot.canvasRevisionId, canUndo: this.snapshot.canUndo, canRedo: this.snapshot.canRedo
    };
    if (next.document !== this.snapshot.document) next = { ...next, document: { ...next.document,
      scene: { ...next.document.scene, contents: Object.freeze(Object.fromEntries(Object.entries(next.document.scene.contents)
        .map(([id, diagram]) => [id, this.diagrams.getRevision(diagram.revisionId).diagram]))) } } };
    this.snapshot = { ...next, contextId: this.context.contextId, canvasRevisionId: historyState.checkpointId, endpointBounds, cell: this.snapshot.cell, version: this.snapshot.version + Number(increment), canUndo: historyState.canUndo, canRedo: historyState.canRedo };
    this.listeners.forEach(listener => listener());
  }
  updateCanvas(value: MappingCanvasState | ((current: MappingCanvasState) => MappingCanvasState), record = false) {
    if (record) this.editorDriver?.settle();
    const next = typeof value === 'function' ? value(this.snapshot.canvas) : value;
    this.updateSnapshot({ document: this.snapshot.document, canvas: next }, record, record);
  }
  select(command: SelectionCommand) { this.updateCanvas(state => updateSelection(state, command), true); }
  commitDocument(document: MappingGridDocument) { this.editorDriver?.settle(); projectCanvasSnapshot(document.scene); this.updateSnapshot({ document, canvas: this.snapshot.canvas }, true); }
  undo(redo = false) {
    if (this.editorDriver) { this.editorDriver.undo(redo); return; }
    if (!this.historyService.navigate(this.context, redo)) return;
    this.updateSnapshot({ document: this.historyService.document(this.context), canvas: this.historyService.state(this.context).view as MappingCanvasState }, false);
  }
  reset() {
    this.historyService.reset(this.context);
    this.updateSnapshot({ document: this.historyService.document(this.context), canvas: this.historyService.state(this.context).view as MappingCanvasState }, false);
  }
  /** One shared command path. transact is retained as the MCP batch adapter. */
  applyUpdate(expectedVersion: number, operations: DiagramOperation[]) {
    this.editorDriver?.settle();
    this.pendingNodeIds.clear();
    try { return this.applyOperations(expectedVersion, operations); }
    finally { this.pendingNodeIds.clear(); }
  }
  transact(expectedVersion: number, operations: DiagramOperation[]) { return this.applyUpdate(expectedVersion, operations); }
  /** One native gesture, including selection/layout consequences, is one saved checkpoint. */
  commitEditorGesture(operations: DiagramOperation[], canvas: MappingCanvasState) {
    if (!operations.length) { this.updateSnapshot({ document: this.snapshot.document, canvas }, true); return; }
    return this.applyOperations(this.snapshot.version, operations, canvas);
  }
  private applyOperations(expectedVersion: number, operations: DiagramOperation[], editorCanvas?: MappingCanvasState) {
    if (expectedVersion !== this.snapshot.version) throw new Error('VERSION_CONFLICT: read the canvas again');
    if (!Array.isArray(operations) || !operations.length || operations.length > (editorCanvas ? 10000 : 100)) throw new Error('Expected 1–100 operations');
    let { document, canvas } = structuredClone(this.snapshot);
    if (editorCanvas) canvas = structuredClone(editorCanvas);
    const safeId = (id: string) => { if (typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,180}$/.test(id) || ['__proto__','constructor','prototype'].includes(id)) throw new Error('Invalid node ID'); };
    for (const op of operations) {
      if (op.method === 'delete-diagrams') {
        if (!op.nodeIds.length) throw new Error('Select one or more diagrams to delete');
        const selected = new Set(op.nodeIds);
        for (const id of selected) {
          if (findBox(document.scene.root, this.gridId(id))?.kind !== 'diagram') throw new Error('Deletion requires whole diagrams');
        }
        const prune = (box: GridBox): GridBox => box.kind === 'container'
          ? { ...box, children: box.children.filter(child => !selected.has(`grid:${child.id}`)).map(prune) } : box;
        const root = selected.has(`grid:${document.scene.root.id}`) ? emptyCanvasDocument().scene.root : prune(document.scene.root);
        const used = new Set<string>();
        const visit = (box: GridBox) => {
          if (box.collapsedContentId) used.add(box.collapsedContentId);
          if (box.kind === 'diagram') used.add(box.contentId); else box.children.forEach(visit);
        };
        visit(root);
        document = { ...document, scene: { root,
          contents: Object.fromEntries(Object.entries(document.scene.contents).filter(([id]) => used.has(id))) },
          sections: Object.fromEntries(Object.entries(document.sections).filter(([id]) => used.has(id))) };
        for (const node of Object.values(canvas.display.nodes)) {
          if (node.kind === 'selection' && selected.has(`grid:${node.sourceBoxId}`)) canvas.display = removeDisplayNode(canvas.display, node.id);
        }
        canvas = updateSelection(canvas, { type: 'replace', items: canvas.selection.items.filter(item => !selected.has(item.displayNodeId)) });
        canvas.controls = { ...canvas.controls,
          surfaces: Object.fromEntries(Object.entries(canvas.controls.surfaces).filter(([id]) => id === 'draft' || canvas.display.nodes[id] || canvas.selection.items.some(item => item.id === id))),
          activeThreadId: canvas.controls.activeThreadId && canvas.display.nodes[canvas.controls.activeThreadId] ? canvas.controls.activeThreadId : null };
      } else if (op.method === 'patchDiagram') {
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
        const jumps = document.jumps?.map(jump => {
          const owner = connectionBox(document.scene, jump.sourceDisplayNodeId), line = lineAfter(jump.source.line);
          if (owner?.kind !== 'diagram' || owner.contentId !== before.id || line === undefined || !activeDiagramJumps(before.content, [jump]).length) return jump;
          const nodeId = jump.source.contentNodeId ? nodeIds.get(jump.source.contentNodeId) : undefined;
          if (jump.source.contentNodeId && !nodeId) return jump;
          return { ...jump, source: { ...jump.source, line, revisionId: diagram.content.revisionId, contentHash: diagram.content.asciiSha256, contentNodeId: nodeId } };
        });
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
        document = { ...document, edges, ...(jumps ? { jumps } : {}), sections: { ...document.sections, [before.id]: sections },
          scene: layoutScene({ ...document.scene, contents: { ...document.scene.contents, [before.id]: diagram } }, box.id) };
      } else if (op.method === 'highlight' || op.method === 'removeHighlights') {
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw new Error('Highlights require a diagram GridBox');
        const diagram = document.scene.contents[box.contentId];
        let highlights = [...(diagram.highlights ?? [])];
        if (op.method === 'highlight') {
          if (op.contentNodeId && !diagramContentNodes(diagram.content).some(node => node.id === op.contentNodeId)) throw new Error('STALE_CONTENT_NODE: read current anchors');
          const existing = highlights.find(item => item.contentNodeId === op.contentNodeId);
          const highlight = { id: existing?.id ?? op.highlightId, color: highlightColorSchema.parse(op.color ?? 'yellow'),
            ...(op.contentNodeId ? { contentNodeId: op.contentNodeId } : {}) };
          highlights = [...highlights.filter(item => item.id !== highlight.id), highlight];
        } else {
          if (op.highlightIds?.some(id => !highlights.some(item => item.id === id))) throw new Error('Unknown highlight ID');
          highlights = op.highlightIds ? highlights.filter(item => !op.highlightIds!.includes(item.id)) : [];
        }
        const prepared = this.prepareDiagramEdit(document, diagram.id, { kind: 'highlights', highlights });
        this.trackNodes(prepared.nodeIds);
        document = { ...document, scene: { ...document.scene, contents: { ...document.scene.contents, [box.contentId]: prepared.diagram } } };
      } else if (op.method === 'setJumps' || op.method === 'setSourceMappings') {
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
        const diagram = document.scene.contents[box.contentId];
        const prepared = this.prepareDiagramEdit(document, diagram.id, op.method === 'setJumps' ? { kind: 'jumps', jumps: op.jumps }
          : { kind: 'source-mappings', expectedContentHash: op.expectedContentHash, mappings: op.mappings, evidence: op.evidence, source: op.source });
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
        const focused = canvas.selection.items.find(item => item.id === canvas.controls.selectionFocusId);
        if (focused?.region && focused.displayNodeId === op.nodeId
          && !projectDiagramContent(content, canvas.diagramViews[op.nodeId]).selectionRect(focused.region.rect))
          canvas.controls = { ...canvas.controls, selectionFocusId: null };
      } else if (op.method === 'diagram-revision-apply') {
        const box = findBox(document.scene.root, this.gridId(op.nodeId));
        if (box?.kind !== 'diagram') throw Error('Expected diagram GridBox');
        const before = document.scene.contents[box.contentId];
        if (before.revisionId !== op.expectedRevisionId) throw Error('VERSION_CONFLICT: diagram changed during generation');
        const prepared = receiveDiagramRevision(op.expectedRevisionId, op.revision);
        this.trackNodes(prepared.nodeIds);
        const scene = layoutScene({ ...document.scene, contents: { ...document.scene.contents, [before.id]: prepared.diagram } }, box.id);
        document = { ...document, scene, edges: reconcileConnections(document.scene, scene, document.edges, prepared.nodeIds) };
      } else if (op.method === 'duplicate-instance') {
        safeId(op.id);
        const source = findBox(document.scene.root, this.gridId(op.sourceNodeId));
        const boxes = flattenGrid(resolveScene(document.scene));
        const parent = boxes.find(box => box.children.some(child => child.box.id === source?.id));
        if (source?.kind !== 'diagram' || !parent || findBox(document.scene.root, op.id)) throw new Error('Cannot duplicate this diagram instance');
        const copy = { ...source, id: op.id, position: { column: op.position.column - parent.bounds.column, row: op.position.row - parent.bounds.row } };
        document = { ...document, scene: layoutScene(updateGridBox(document.scene, parent.box.id,
          box => box.kind === 'container' ? { ...box, children: [...box.children, copy] } : box), op.id) };
        const view = canvas.diagramViews?.[op.sourceNodeId];
        if (view) canvas.diagramViews = { ...canvas.diagramViews, [`grid:${op.id}`]: view };
      } else if (op.method === 'diagram-insert') {
        safeId(op.id);
        if (findBox(document.scene.root, op.id) || Object.hasOwn(document.scene.contents, op.id) || Object.hasOwn(document.scene.contents, `${op.id}-summary`)) throw new Error('Node ID already exists');
        const diagram = this.diagrams.getRevision(op.revisionId).diagram;
        if (diagram.id !== op.id) throw new Error('Diagram revision belongs to another diagram');
        document = insertGridDiagram(document, op.parentId ? this.gridId(op.parentId) : document.scene.root.id,
          { id: op.id, kind: 'diagram', contentId: op.id, collapsed: false, minimumSize: op.minimumSize, position: op.position ?? { column: 0, row: 0 } }, diagram, this.diagrams);
      } else if (op.method === 'diagram-create' || op.method === 'replace') {
        const ascii = op.ascii?.replace(/\r\n?/g, '\n');
        const mappings = op.mappings ?? [];

        if (op.method === 'diagram-create') {
          safeId(op.id);
          if (findBox(document.scene.root, op.id) || Object.hasOwn(document.scene.contents, op.id) || Object.hasOwn(document.scene.contents, `${op.id}-summary`)) throw new Error('Node ID already exists');
          const parentId = op.parentId ? this.gridId(op.parentId) : document.scene.root.id;
          document = insertGridDiagram(document, parentId, { id: op.id, kind: 'diagram', contentId: op.id, collapsed: false, minimumSize: op.minimumSize, position: op.position ?? { column: 0, row: 0 } },
            this.diagrams.create({ id: op.id, ascii, revision: 0, structureKind: op.structureKind, mappings, source: op.source, evidence: op.evidence }).diagram, this.diagrams);
        } else {
          const id = this.gridId(op.nodeId), box = findBox(document.scene.root, id);
          if (box?.kind !== 'diagram') throw new Error('Expected diagram GridBox');
          const old = document.scene.contents[box.contentId];
          const prepared = this.prepareDiagramEdit(document, old.id, { kind: 'replace', input: { ascii, mappings,
            structureKind: op.structureKind ?? old.content.structure.kind, source: op.source ?? old.sourceContext.binding,
            evidence: op.evidence ?? old.sourceContext.evidence } });
          const replacement = prepared.diagram;
          this.trackNodes(prepared.nodeIds);
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
        if (!box || id === document.scene.root.id && !(editorCanvas && op.method === 'move' && box.kind === 'diagram')) throw new Error('Unknown or protected GridBox');
        if (op.method === 'move') {
          if (!('column' in op.position) || !('row' in op.position)) throw new Error('GridBoxes require cell coordinates');
          const absolute = canvasDisplayNodes(document, canvas, 0).find(node => node.id === op.nodeId)!;
          if (absolute.layout !== 'grid') throw new Error('Expected GridBox');
          const position = { column: op.position.column - (absolute.geometry.bounds.column - box.position.column), row: op.position.row - (absolute.geometry.bounds.row - box.position.row) };
          const scene = updateGridBox(document.scene, id, item => ({ ...item, position }));
          document = { ...document, scene: editorCanvas ? scene : layoutScene(scene, id) };
        } else if (op.method === 'collapse') {
          if (typeof op.collapsed !== 'boolean') throw new Error('collapsed must be boolean');
          document = { ...document, scene: layoutScene(updateGridBox(document.scene, id, item => ({ ...item, collapsed: op.collapsed })), id) };
        } else if (op.method === 'group') {
          safeId(op.id);
          const summaryId = `${op.id}-summary`;
          if (findBox(document.scene.root, op.id) || Object.hasOwn(document.scene.contents, summaryId)) throw new Error('Node ID already exists');
          const summary = this.diagrams.create({ id: summaryId, revision: 0, ascii: '[Diagram group]' }).diagram;
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
          canvas = updateSelection(canvas, { type: 'remove', id });
          const controls = canvas.controls;
          canvas.controls = { ...controls, surfaces: Object.fromEntries(Object.entries(controls.surfaces).filter(([key]) => key === 'draft' || canvas.display.nodes[key])),

            activeThreadId: controls.activeThreadId && canvas.display.nodes[controls.activeThreadId] ? controls.activeThreadId : null };
        } else throw new Error('Unsupported FloatingBox operation');
      }
    }
    if (editorCanvas && operations.some(op => op.method === 'move' && op.nodeId.startsWith('grid:')))
      document = { ...document, scene: layoutScene(document.scene, document.scene.root.id) };
    projectCanvasSnapshot(document.scene);
    if (operations.some(op => op.method === 'remove') && !flattenGrid(resolveScene(document.scene)).some(node => node.contentId))
      throw Error('Canvas must contain a visible diagram; use a transfer to move the last diagram');
    const active = findBox(document.scene.root, canvas.controls.activeBoxId);
    if (!active) {
      const first = canvasDisplayNodes(document, canvas, 0).find(node => node.layout === 'grid' && node.kind === 'diagram');
      canvas.controls.activeBoxId = first?.layout === 'grid' ? first.boxId : document.scene.root.id;
    }
    this.updateSnapshot({ document, canvas }, true);
    return { version: this.snapshot.version, nodes: this.nodes() };
  }
  private gridId(id: string) { if (!id.startsWith('grid:')) throw new Error('Expected GridBox ID'); return id.slice(5); }
}
