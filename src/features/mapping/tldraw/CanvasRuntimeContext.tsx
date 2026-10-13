import { SelectionToolBridge } from './SelectionTools';
import { selectionContentNodes } from '../../../../domain/mapping/selection/selectionState';
import { createContext } from 'react';
import { atom, transact, type Atom, type Editor } from 'tldraw';
import type { CanvasSession } from '../workspace/canvasSession';
import type { DiagramJumpTarget } from '../../../../domain/core/diagrams/diagramJump';
import type { LocalChatVerbosity } from '../../../../domain/mapping/chat/localChat';
import type { ProjectRepresentationCatalogRecord } from '../../../../domain/core/representations/projectCatalog';
import { flattenGrid, resolveScene } from '../../../../domain/core/diagrams/lineGrid';
import type { Diagram } from '../../../../domain/core/diagrams/diagram';
import { canvasDisplayNodes, findBox, type CanvasDisplayNode } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { diagramProjection, type DiagramViewState } from '../../../../domain/mapping/workspace/diagramViewState';
import type { DisplayState, FloatingPane, SelectionRegion } from '../../../../domain/mapping/workspace/displayModel';
import type { DiagramAnchor, DiagramConnection } from '../../../../domain/core/diagrams/diagramConnection';
import { resolveEndpoint } from '../../../../domain/mapping/workspace/connectionLayout';
import type { ControllerSnapshot } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { DEFAULT_CELL } from './shapeProjection';
import { LocalAnchorStore } from './LocalAnchorStore';

/** Domain commands may clone a whole document. Preserve equal read-model branches
 * so a selector for diagram A does not change when diagram B is edited. */
export function shareEqual<T>(before: T, after: T): T {
  if (Object.is(before, after)) return before;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) return after;
  const old = before as Record<string, unknown>, next = after as Record<string, unknown>;
  const keys = Object.keys(next);
  let equal = Object.keys(old).length === keys.length;
  const result: Record<string, unknown> = Array.isArray(after) ? [] as unknown as Record<string, unknown> : {};
  for (const key of keys) { result[key] = shareEqual(old[key], next[key]); if (!Object.is(result[key], old[key]) || !(key in old)) equal = false; }
  return equal ? before : result as T;
}
class Models<T> {
  private entries = new Map<string, Atom<T | undefined>>();
  get(id: string) {
    let entry = this.entries.get(id);
    if (!entry) { entry = atom<T | undefined>(`mapping:${id}`, undefined); this.entries.set(id, entry); }
    return entry;
  }
  publish(values: Map<string, T>) {
    for (const [id, entry] of this.entries) if (!values.has(id)) entry.set(undefined);
    for (const [id, value] of values) { const entry = this.get(id); entry.set(shareEqual(entry.get(), value)); }
  }
}
export interface GridModel {
  id: string; frame: { boxId: string; kind: string; collapsed?: boolean; root: boolean; bounds: { column: number; row: number; columns: number; rows: number }; selected: boolean };
  diagram?: Diagram; view?: DiagramViewState; jumps: NonNullable<ControllerSnapshot['document']['jumps']>;
  node: CanvasDisplayNode; selectedContent: string[]; cell: { width: number; height: number }; layoutKey: string;
}
export interface FloatModel {
  node: FloatingPane; parent?: FloatingPane; root?: SelectionRegion;
  selected: boolean; missing: boolean; stale: boolean; visible: boolean; sourceRevisionId?: string;
}
export interface LocalEndpoint extends NonNullable<ReturnType<typeof resolveEndpoint>> { layoutKey: string }
export interface EdgeModel { edge: DiagramConnection; source?: LocalEndpoint; target?: LocalEndpoint }
export interface CanvasActions {
  undo(): void;
  escape(): void;
  jump(target: DiagramJumpTarget): void;
  collapse(nodeId: string, collapsed: boolean, contentNodeId?: string): void;
  move(id: string): void; group(id: string): void; remove(id: string): void;
  toggleConversation(id: string, expanded: boolean): void;
  submit(id: string, message: string): void; verbosity(id: string, value: LocalChatVerbosity): void; retry(id: string): void;
}
export class CanvasRuntime {
  private readonly editorState = atom<Editor | undefined>('mapping editor', undefined);
  get editor() { return this.editorState.get(); }
  set editor(value: Editor | undefined) { this.editorState.set(value); }
  readonly gestures = new SelectionToolBridge();
  readonly canUndo = atom('mapping undo available', false);
  readonly canEscape = atom('mapping escape available', true);
  readonly controller;
  readonly anchors = new LocalAnchorStore();
  readonly grids = new Models<GridModel>();
  readonly floats = new Models<FloatModel>();
  readonly edges = new Models<EdgeModel>();
  readonly focusedEdge = atom<{ id: string; point: { x: number; y: number } } | undefined>('focused mapping edge', undefined);
  readonly interaction = atom('mapping shape controls', { disabled: false, subtreeDisabled: false, jumps: false });
  readonly catalog = atom<{ catalog?: ProjectRepresentationCatalogRecord; dirtyIds?: string[] }>('mapping projection catalog', {});
  // Stable service object; callbacks are installed by the application command UI.
  actions?: CanvasActions;
  private previous?: ControllerSnapshot;
  private registry: CanvasDisplayNode[] = [];
  constructor(readonly session: CanvasSession) { this.controller = session.controller; this.sync(); }
  connect() { this.sync(); return this.controller.subscribe(() => this.sync()); }
  sync() {
    const s = this.controller.getSnapshot(), p = this.previous;
    if (p && s.document === p.document && s.canvas.display === p.canvas.display && s.canvas.diagramViews === p.canvas.diagramViews
      && s.canvas.selection === p.canvas.selection && s.cell === p.cell) return;
    this.previous = s;
    const cell = s.cell?.width ? s.cell : DEFAULT_CELL;
    if (!p || s.document !== p.document || s.canvas.diagramViews !== p.canvas.diagramViews || s.cell !== p.cell)
      this.registry = canvasDisplayNodes(s.document, { ...s.canvas, display: { nodes: {}, rootIds: [] } }, 0, cell);
    const boxes = flattenGrid(resolveScene(s.document.scene));
    const grids = new Map<string, GridModel>();
    for (const box of boxes) {
      const id = `grid:${box.box.id}`, diagram = box.contentId ? s.document.scene.contents[box.contentId] : undefined;
      const view = box.box.collapsed ? undefined : s.canvas.diagramViews?.[id];
      const selectedContent = s.canvas.selection.items.filter(item => item.displayNodeId === id && item.region && diagram?.content.ascii === item.region.sourceAscii)
        .flatMap(item => selectionContentNodes(diagram!, item.region).map(node => node.id));
      grids.set(id, { id, frame: { boxId: box.box.id, kind: box.box.kind, collapsed: box.box.collapsed, root: box.box.id === s.document.scene.root.id,
        bounds: box.bounds, selected: s.canvas.selection.items.some(item => item.displayNodeId === id && !item.region) },
        diagram, view, node: this.registry.find(node => node.id === id)!, cell, selectedContent,
        jumps: (s.document.jumps ?? []).filter(jump => jump.sourceDisplayNodeId === id),
        layoutKey: JSON.stringify([diagram?.content.revisionId, diagram?.content.asciiSha256, view, cell, box.box.collapsed]) });
    }
    const floats = new Map<string, FloatModel>(), nodes = Object.values(s.canvas.display.nodes);
    for (const node of nodes) {
      const parent = nodes.find(other => other.childIds.includes(node.id));
      let root = node.kind === 'selection' ? node : parent;
      const visited = new Set<string>();
      while (root && root.kind !== 'selection' && !visited.has(root.id)) { visited.add(root.id); const id = root.id; root = nodes.find(other => other.childIds.includes(id)); }
      const region = root?.kind === 'selection' ? root : undefined;
      const box = region && boxes.find(box => box.box.id === region.sourceBoxId);
      const content = region && s.document.scene.contents[region.sourceContentId]?.content;
      const stale = !!region && content?.ascii !== region.sourceAscii, missing = !!region && !box;
      const hiddenByAncestor = region && !box && !!findBox(s.document.scene.root, region.sourceBoxId);
      const visible = !region || !hiddenByAncestor && !box?.box.collapsed && (!box || stale || !!diagramProjection(s.document.scene, region.sourceBoxId, region.sourceContentId, s.canvas.diagramViews).selectionRect(region.rect));
      floats.set(node.id, { node, parent, root: region, missing, stale, visible: visible && (node.kind !== 'conversation' || !parent || parent.expansion === 'expanded'),
        selected: s.canvas.selection.items.some(item => item.id === node.id), sourceRevisionId: content?.revisionId });
    }
    transact(() => {
      this.grids.publish(grids); this.floats.publish(floats);
      this.anchors.retain(new Map([...grids].map(([id, model]) => [id, model.layoutKey])));
      this.edges.publish(new Map(s.document.edges.map(edge => [edge.id, { edge, source: this.resolveAnchor(edge.source), target: this.resolveAnchor(edge.target) }])));
      const focused = this.focusedEdge.get();
      if (focused && !s.document.edges.some(edge => edge.id === focused.id)) this.focusedEdge.set(undefined);
    });
  }
  resolveAnchor(anchor: DiagramAnchor): LocalEndpoint | undefined {
    const s = this.controller.getSnapshot(), cell = s.cell?.width ? s.cell : DEFAULT_CELL;
    const resolved = resolveEndpoint(s.document.scene, s.canvas.diagramViews, anchor, cell);
    const owner = resolved && this.grids.get(resolved.identity.displayNodeId).get();
    return resolved && owner ? { ...resolved, layoutKey: owner.layoutKey, rect: { ...resolved.rect,
      x: resolved.rect.x - owner.frame.bounds.column * cell.width, y: resolved.rect.y - owner.frame.bounds.row * cell.height } } : undefined;
  }
  updateDisplay(update: (state: DisplayState) => DisplayState, record = true) {
    this.controller.updateCanvas(current => { const display = update(current.display); return display === current.display ? current : { ...current, display }; }, record);
  }
}
export const CanvasRuntimeContext = createContext<CanvasRuntime | null>(null);
