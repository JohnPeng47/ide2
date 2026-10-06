import { type Editor, type TLShapePartial } from 'tldraw';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import { updateSelection } from '../../../../domain/mapping/selection/canvasSelection';
import { diagramSelectionItem, selectedDiagramIds } from '../../../../domain/mapping/selection/selectionState';
import { updateDisplayGeometry } from '../../../../domain/mapping/workspace/displayModel';
import type { MappingDocumentController, DiagramOperation } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { DEFAULT_CELL, mappingShapeId, projectMappingShapes } from './shapeProjection';
import type { MappingShape } from './MappingShapeUtil';

/** The Editor owns live geometry and undo. The domain controller supplies semantic
 * commands and an immutable checkpoint archive for persistence/headless proposals.
 * No controller writes occur on camera or pointer-move frames. */
export class MappingEditorRuntime {
  private disposed = false;
  private syncing = false;
  private settling = false;
  private navigating = false;
  private dirty = false;
  private pendingProjection = false;
  private checkpoint = '';
  private unsubscribes: (() => void)[] = [];
  private publishedSelection?: ReturnType<MappingDocumentController['getSnapshot']>['canvas']['selection'];
  private projected = new Map<string, TLShapePartial<MappingShape>>();
  constructor(readonly editor: Editor, readonly controller: MappingDocumentController) {
    this.hydrate();
    this.unsubscribes.push(controller.attachEditorDriver({ settle: () => { if (!this.settling) { this.editor.complete(); this.settle(true, false); } }, undo: redo => this.undo(redo) }));
    let previous = controller.getSnapshot();
    this.unsubscribes.push(controller.subscribe(() => {
      const next = controller.getSnapshot();
      const relevant = next.canvasRevisionId !== previous.canvasRevisionId || next.document !== previous.document
        || next.canvas.display !== previous.canvas.display || next.canvas.diagramViews !== previous.canvas.diagramViews
        || next.canvas.selection !== previous.canvas.selection || next.cell !== previous.cell;
      previous = next;
      if (relevant) this.publish();
    }));
    // This synchronous observer distinguishes history navigation from an ordinary
    // shape edit before another API request can observe the old checkpoint.
    this.unsubscribes.push(editor.sideEffects.registerAfterChangeHandler('document', (_before, after) => {
      const id = after.meta.mappingCheckpoint;
      if (this.syncing || typeof id !== 'string' || id === controller.getSnapshot().canvasRevisionId) return;
      this.navigating = true;
      try { controller.restoreEditorCheckpoint(id); this.checkpoint = id; this.publish(false); }
      finally { this.navigating = false; }
    }));
    this.unsubscribes.push(editor.store.listen(({ changes }) => {
      if (Object.values(changes.added).some(record => record.typeName === 'shape')
        || Object.values(changes.removed).some(record => record.typeName === 'shape')
        || Object.values(changes.updated).some(([before, after]) => after.typeName === 'shape'
          || after.typeName === 'instance_page_state' && before.typeName === 'instance_page_state'
            && after.selectedShapeIds.join() !== before.selectedShapeIds.join())) this.dirty = true;
    }, { scope: 'all' }));
    const tick = () => {
      if (editor.inputs.getIsPointing() || editor.inputs.getIsDragging()) return;
      if (this.dirty) this.settle();
      if (this.pendingProjection) this.publish();
    };
    editor.on('tick', tick);
    this.unsubscribes.push(() => { editor.off('tick', tick); });
  }
  private setCheckpoint(id: string) {
    const document = this.editor.getDocumentSettings();
    // updateDocumentSettings intentionally ignores history in the SDK. This
    // application checkpoint is document data and must share the shape diff.
    this.editor.store.put([{ ...document, meta: { ...document.meta, mappingCheckpoint: id } }]);
  }
  /** Replay only checkpoint references. Old shape geometry is materialized lazily
   * on navigation, so startup does not reparse every historical ASCII document. */
  private hydrate() {
    this.syncing = true;
    try {
      const record = this.controller.editorHistory();
      const sequence = [...record.past, record.headId, ...[...record.future].reverse()];
      this.editor.run(() => this.setCheckpoint(sequence[0]), { history: 'ignore' });
      this.editor.clearHistory();
      for (const id of sequence.slice(1)) {
        this.editor.markHistoryStoppingPoint('mapping checkpoint');
        this.setCheckpoint(id);
      }
      for (let i = 0; i < record.future.length; i++) this.editor.undo();
      this.checkpoint = record.headId;
      this.writeShapes(false);
    } finally { this.syncing = false; }
  }
  private writeShapes(record: boolean) {
    const shapes = projectMappingShapes(this.controller.getSnapshot()).map(shape => ({ ...shape, parentId: shape.parentId ?? this.editor.getCurrentPageId() }));
    const ids = new Set(shapes.map(shape => shape.id));
    this.editor.run(() => {
      const removed = this.editor.getCurrentPageShapes().filter(shape => shape.type === 'mapping-box' && !ids.has(shape.id));
      this.editor.deleteShapes(removed.map(shape => shape.id));
      const create: TLShapePartial<MappingShape>[] = [], update: TLShapePartial<MappingShape>[] = [];
      for (const shape of shapes) {
        const current = this.editor.getShape<MappingShape>(shape.id);
        if (!current) create.push(shape);
        else if (current.parentId !== (shape.parentId ?? this.editor.getCurrentPageId()) || current.x !== shape.x || current.y !== shape.y || current.isLocked !== shape.isLocked
          || JSON.stringify(current.props) !== JSON.stringify(shape.props)) update.push(shape);
      }
      if (create.length) this.editor.createShapes(create);
      if (update.length) this.editor.updateShapes(update);
      // Edges stay behind diagram shapes, including after creation and history replay.
      const edgeIds = shapes.filter(shape => shape.props?.kind === 'arrow').map(shape => shape.id);
      this.editor.run(() => this.editor.sendToBack(edgeIds), { ignoreShapeLock: true });
      this.projected = new Map(shapes.map(shape => [shape.props!.nodeId!, shape]));
      const selected = selectedDiagramIds(this.controller.getSnapshot().canvas.selection).map(mappingShapeId).filter(id => this.editor.getShape(id));
      const selection = this.controller.getSnapshot().canvas.selection;
      if (selection !== this.publishedSelection) { this.editor.setSelectedShapes(selected); this.publishedSelection = selection; }
    }, { history: record ? 'record' : 'ignore' });
  }
  private publish(record = true) {
    if (this.syncing || this.disposed) return;
    this.syncing = true;
    try {
      const id = this.controller.getSnapshot().canvasRevisionId;
      const changed = id !== this.checkpoint;
      if (!changed && this.editor.inputs.getIsPointing()) { this.pendingProjection = true; return; }
      this.pendingProjection = false;
      if (changed && record && !this.settling && !this.navigating) this.editor.markHistoryStoppingPoint('mapping command');
      this.editor.run(() => {
        this.writeShapes(changed && record && !this.navigating);
        this.setCheckpoint(id);
      }, { history: changed && record && !this.navigating ? 'record' : 'ignore' });
      this.checkpoint = id;
    } finally { this.syncing = false; }
  }
  settle(force = false, captureSelection = true) {
    if (this.syncing || this.settling || this.navigating || this.disposed) return;
    if (!force && this.editor.inputs.getIsPointing()) return;
    this.dirty = false;
    this.settling = true;
    try {
      let selected = this.editor.getSelectedShapes().filter(shape => shape.type === 'mapping-box' && shape.props.kind === 'diagram')
        .map(shape => (shape as MappingShape).props.nodeId);
      const snapshot = this.controller.getSnapshot();
      const cell = snapshot.cell?.width ? snapshot.cell : DEFAULT_CELL;
      const boxes = flattenGrid(resolveScene(snapshot.document.scene));
      const nativeShapes = this.editor.getCurrentPageShapes();
      const clones = nativeShapes.filter(shape => shape.type === 'mapping-box' && shape.id !== mappingShapeId(shape.props.nodeId));
      const unsupportedClone = clones.some(shape => shape.type === 'mapping-box' && (shape.props.kind !== 'diagram'
        || !boxes.some(box => box.children.some(child => `grid:${child.box.id}` === shape.props.nodeId))));
      if (unsupportedClone) { this.editor.deleteShapes(clones.map(shape => shape.id)); selected = []; }
      const moves: DiagramOperation[] = [];
      let display = snapshot.canvas.display;
      for (const shape of this.editor.getCurrentPageShapes()) {
        if (shape.type !== 'mapping-box') continue;
        const previous = this.projected.get(shape.props.nodeId);
        if (!previous) continue;
        if (shape.id !== mappingShapeId(shape.props.nodeId)) {
          if (shape.props.kind === 'diagram') {
            const id = `copy-${crypto.randomUUID()}`, point = this.editor.getShapePageBounds(shape)!;
            moves.push({ method: 'duplicate-instance', sourceNodeId: shape.props.nodeId, id,
              position: { column: Math.max(0, Math.round(point.x / cell.width)), row: Math.max(0, Math.round(point.y / cell.height)) } });
            if (this.editor.getSelectedShapeIds().includes(shape.id)) selected = selected.map(nodeId => nodeId === shape.props.nodeId ? `grid:${id}` : nodeId);
          } else {
            // Pane and group copies need semantic ownership remapping. Until such
            // a command exists, cancel these temporary native clones.
            this.editor.deleteShapes([shape.id]);
          }
          continue;
        }
        if (shape.props.nodeId.startsWith('grid:')) {
          if (shape.x === previous.x && shape.y === previous.y) continue;
          const id = shape.props.nodeId.slice(5), parent = boxes.find(box => box.children.some(child => child.box.id === id));
          if (!parent && shape.props.kind !== 'diagram') continue;
          const point = this.editor.getShapePageBounds(shape)!;
          moves.push({ method: 'move', nodeId: shape.props.nodeId, position: {
            column: Math.max(0, Math.round(point.x / cell.width)),
            row: Math.max(0, Math.round(point.y / cell.height)) } });
        } else {
          const node = display.nodes[shape.props.nodeId.slice(9)];
          if (!node) continue;
          if (shape.x === previous.x && shape.y === previous.y && shape.props.w === previous.props?.w && shape.props.h === previous.props?.h) continue;
          display = updateDisplayGeometry(display, node.id, { position: { x: shape.x, y: shape.y }, bounds: { width: shape.props.w, height: shape.props.h } });
          display = { ...display, nodes: { ...display.nodes, [node.id]: { ...display.nodes[node.id],
            geometryPolicy: { placement: 'manual', sizing: shape.props.w !== previous.props?.w || shape.props.h !== previous.props?.h ? 'fixed' : node.geometryPolicy.sizing },
            ...(node.kind === 'conversation' && node.expansion === 'collapsed' ? { canvasAnchor: { x: shape.x, y: shape.y } } : {}) } } };
        }
      }
      let canvas = display === snapshot.canvas.display ? snapshot.canvas : { ...snapshot.canvas, display };
      const existing = selectedDiagramIds(canvas.selection);
      if (captureSelection && selected.join() !== existing.join()) canvas = updateSelection(canvas, { type: 'replace', items: selected.map(diagramSelectionItem) });
      if (moves.length || canvas !== snapshot.canvas) this.controller.commitEditorGesture(moves, canvas);
    } finally { this.settling = false; }
  }
  undo(redo = false) {
    this.editor.complete(); this.settle();
    const history = this.controller.editorHistory();
    if ((redo ? history.redoTransactionId : history.undoTransactionId))
      throw new Error('Use workspace undo/redo for a canvas transfer.');
    if (redo) this.editor.redo(); else this.editor.undo();
  }
  dispose() {
    this.editor.complete(); this.settle(); this.disposed = true;
    this.unsubscribes.splice(0).reverse().forEach(dispose => dispose());
  }
}
