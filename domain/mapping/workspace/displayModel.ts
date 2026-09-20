import type { MappingPocGridRect } from '../selection/mappingPoc';
import type { ProjectionSelectionResult } from '../../core/diagrams/diagramProjection';
import type { projectCompactions } from '../../core/representations/compactionProjection';
import type { LocalChatThread, LocalChatVariant } from '../chat/localChat';

export type Expansion = 'expanded' | 'collapsed';
export type ChildDisplayMode = 'stacked' | 'chained';
export interface DisplayPosition { x: number; y: number }
export interface DisplayBounds { width: number; height: number }
export interface DisplayGeometry {
  /** Unscaled CSS pixels, relative to the canvas origin or viewport top-left. */
  position: DisplayPosition;
  bounds: DisplayBounds;
  coordinateSpace: 'canvas' | 'viewport';
}
export interface DisplayNodeBase extends DisplayGeometry {
  id: string;
  childIds: string[];
  expansion: Expansion;
  geometryPolicy: { placement: 'automatic' | 'manual'; sizing: 'content' | 'fixed' };
  /** Restores the expanded allocation after rendering a collapsed header/bubble. */
  expandedGeometry?: DisplayGeometry;
}
export function displayGeometry(position: DisplayPosition = { x: 0, y: 0 },
  bounds: DisplayBounds = { width: 500, height: 200 }): Pick<DisplayNodeBase, keyof DisplayGeometry | 'geometryPolicy'> {
  return { position, bounds, coordinateSpace: 'canvas', geometryPolicy: { placement: 'automatic', sizing: 'content' } };
}
export interface SelectionRegion extends DisplayNodeBase {
  kind: 'selection';
  sourceBoxId: string;
  sourceContentId: string;
  sourceAscii: string;
  sourceRevisionId?: string;
  rect: MappingPocGridRect;
  selectedIds: string[];
  displayMode: ChildDisplayMode;
  activeChildId?: string;
}
export type ProjectedFile = ReturnType<typeof projectCompactions>[number];
export interface SourceCodePaneContent {
  kind: 'source-code';
  sourceId?: string;
  projectId: string;
  /** Projection metadata; navigation may select a file outside this list. */
  files: ProjectedFile[];
  /** Repository-relative path of the currently viewed file. */
  sourceFile: string;
  showCompactions: boolean;
  rangeIndex: number;
  /** Saved checkpoint; live scrolling is owned by SourcePaneViewState. */
  scroll?: { top: number; left: number };
}
export interface ProjectedPane extends DisplayNodeBase {
  kind: 'projection';
  title: string;
  projectionId?: string;
  sourceRevisionId?: string;
  targetRevisionId?: string;
  activeChildId?: string;
  content: { kind: 'call-tree'; result: ProjectionSelectionResult; coverage: string }
    | { kind: 'compaction'; files: ProjectedFile[] }
    | SourceCodePaneContent;
}
export interface ConversationPane extends DisplayNodeBase {
  kind: 'conversation';
  presentation: LocalChatVariant;
  thread: LocalChatThread;
  /** Semantic attachment for the bubble; independent of an expanded or docked panel. */
  canvasAnchor: DisplayPosition;
  draft: string;
}
export interface DetailPane extends DisplayNodeBase {
  kind: 'detail'; title: string; ascii: string; sectionId?: string;
}
export type FloatingPane = SelectionRegion | ProjectedPane | ConversationPane | DetailPane;
export type FloatingBox = FloatingPane | import('./connectionLayout').FloatingBoxArrow;
// Arrows are derived from document.edges, never a second persisted copy here.
export interface DisplayState { rootIds: string[]; nodes: Record<string, FloatingPane> }
export const emptyDisplayState = (): DisplayState => ({ rootIds: [], nodes: {} });
export function addDisplayNode(state: DisplayState, node: FloatingPane, ownerId?: string): DisplayState {
  if (state.nodes[node.id]) throw new Error('Display ID already exists');
  const owner = ownerId ? state.nodes[ownerId] : undefined;
  if (ownerId && !owner) throw new Error('Display owner does not exist');
  return { rootIds: owner ? state.rootIds : [...state.rootIds, node.id], nodes: {
    ...state.nodes, [node.id]: node,
    ...(owner ? { [owner.id]: { ...owner, childIds: [...owner.childIds, node.id],
      ...((owner.kind === 'projection' || owner.kind === 'selection') && node.kind === 'projection' ? { activeChildId: node.id } : {}) } } : {})
  } };
}
export function removeDisplayNode(state: DisplayState, id: string): DisplayState {
  const removed = new Set<string>();
  const walk = (key: string) => { if (removed.has(key)) return; removed.add(key); state.nodes[key]?.childIds.forEach(walk); };
  walk(id);
  return { rootIds: state.rootIds.filter(key => !removed.has(key)), nodes: Object.fromEntries(
    Object.values(state.nodes).filter(node => !removed.has(node.id)).map(node => [node.id, {
      ...node, childIds: node.childIds.filter(key => !removed.has(key)),
      ...((node.kind === 'projection' || node.kind === 'selection') && node.activeChildId && removed.has(node.activeChildId) ? { activeChildId: node.childIds.filter(key => !removed.has(key) && state.nodes[key]?.kind === 'projection').at(-1) } : {})
    }])
  ) };
}
export function setExpansion(state: DisplayState, id: string, expansion: Expansion): DisplayState {
  const node = state.nodes[id];
  if (!node || node.expansion === expansion) return state;
  const geometry = expansion === 'expanded' ? node.expandedGeometry : undefined;
  return { ...state, nodes: { ...state.nodes, [id]: { ...node, ...geometry, expansion,
    expandedGeometry: expansion === 'collapsed'
      ? { position: node.position, bounds: node.bounds, coordinateSpace: node.coordinateSpace } : undefined
  } } };
}
/** Layout and measurement share one write path; no-op updates preserve React identity. */
export function updateDisplayGeometry(state: DisplayState, id: string, geometry: Partial<DisplayGeometry>): DisplayState {
  const node = state.nodes[id]; if (!node) return state;
  const next = { ...node, ...geometry };
  if (node.position.x === next.position.x && node.position.y === next.position.y
    && node.bounds.width === next.bounds.width && node.bounds.height === next.bounds.height
    && node.coordinateSpace === next.coordinateSpace) return state;
  return { ...state, nodes: { ...state.nodes, [id]: next } };
}
export function measureDisplayNode(state: DisplayState, id: string, width: number, height: number): DisplayState {
  const node = state.nodes[id];
  if (!node || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || (node.geometryPolicy.sizing === 'fixed' && node.expansion === 'expanded')) return state;
  return updateDisplayGeometry(state, id, { bounds: { width, height } });
}
/** Scene boxes remain authoritative in LineGridScene; annotations are derived from these nodes. */
export function visibleProjectionIds(state: DisplayState, id: string, mode: ChildDisplayMode): string[] {
  const node = state.nodes[id];
  if (!node) return [];
  if (node.expansion === 'collapsed') return node.kind === 'projection' ? [id] : [];
  const children = (node.kind === 'projection' || node.kind === 'selection') && mode === 'stacked'
    ? (node.activeChildId ? [node.activeChildId] : []) : node.childIds;
  const descendants = children.flatMap(child => visibleProjectionIds(state, child, mode));
  return node.kind === 'projection' ? mode === 'stacked' && descendants.length ? descendants : [id, ...descendants] : descendants;
}

export type { CanvasDisplayNode as DisplayNode } from './canvasDisplayNode';
