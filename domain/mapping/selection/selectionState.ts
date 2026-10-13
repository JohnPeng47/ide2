import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import type { DiagramContentNode } from '../../core/diagrams/diagramContent';
import type { Diagram } from '../../core/diagrams/diagram';
import { diagramSelectionNodes } from '../workspace/mappingDocument';
import type { MappingPocGridRect } from './mappingPoc';

export interface SelectionItem {
  readonly id: string;
  readonly displayNodeId: string;
  /** Absent means the entire diagram instance is selected. */
  readonly region?: {
    readonly sourceContentId: string;
    readonly sourceRevisionId?: string;
    readonly sourceAscii: string;
    /** Presentation envelope; never used to infer membership after capture. */
    readonly rect: MappingPocGridRect;
    /** Ordered canonical node membership. Absent only in legacy snapshots. */
    readonly contentNodeIds?: readonly string[];
    readonly selectedIds: readonly string[];
  };
}
/** Membership and insertion order only. Focus, panels and previews have separate lifetimes. */
export interface SelectionState { readonly items: readonly SelectionItem[] }
export type SelectionCommand =
  | { type: 'replace' | 'add'; items: readonly SelectionItem[] }
  | { type: 'toggleDiagram'; displayNodeId: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' };

export const diagramSelectionItem = (displayNodeId: string): SelectionItem => ({ id: displayNodeId, displayNodeId });
export const selectedDiagramIds = (state: SelectionState): string[] => state.items.filter(item => !item.region).map(item => item.displayNodeId);
export const sameSelectionRegion = (a: SelectionItem, b: SelectionItem) => a.displayNodeId === b.displayNodeId && a.region && b.region
  && a.region.sourceContentId === b.region.sourceContentId && a.region.sourceAscii === b.region.sourceAscii
  && JSON.stringify(a.region.contentNodeIds) === JSON.stringify(b.region.contentNodeIds)
  && a.region.rect.startLine === b.region.rect.startLine && a.region.rect.endLine === b.region.rect.endLine
  && a.region.rect.startColumn === b.region.rect.startColumn && a.region.rect.endColumn === b.region.rect.endColumn;

/** One reducer enforces identity and deduplication across diagrams and regions for every consumer. */
export function selectionCommand(state: SelectionState, command: SelectionCommand): SelectionState {
  if (command.type === 'clear') return state.items.length ? { items: [] } : state;
  if (command.type === 'remove') return { items: state.items.filter(item => item.id !== command.id) };
  if (command.type === 'toggleDiagram') {
    const existing = state.items.find(item => !item.region && item.displayNodeId === command.displayNodeId);
    return selectionCommand(state, existing ? { type: 'remove', id: existing.id }
      : { type: 'add', items: [diagramSelectionItem(command.displayNodeId)] });
  }
  let items = command.type === 'replace' ? [] : [...state.items];
  for (const requested of command.items) {
    // Repeated gestures reuse the identity of the same captured region.
    const equivalent = requested.region && (items.find(item => sameSelectionRegion(item, requested)) ?? state.items.find(item => sameSelectionRegion(item, requested)));
    const item = equivalent ? { ...requested, id: equivalent.id } : requested;
    const index = items.findIndex(old => old.id === item.id);
    if (index < 0) items.push(item); else items[index] = item;
  }
  return { items };
}

/** Capture a completed region once, before rendering or publishing it. */
export function regionSelectionItem(diagram: Diagram, boxId: string, rect: MappingPocGridRect, id: string = crypto.randomUUID()): SelectionItem {
  return { id, displayNodeId: `grid:${boxId}`, region: {
    sourceContentId: diagram.id, sourceRevisionId: diagram.content.revisionId, sourceAscii: diagram.content.ascii, rect: { ...rect },
    contentNodeIds: diagramContentNodes(diagram.content).filter(node => nodeIntersectsRect(node, rect)).map(node => node.id),
    selectedIds: diagramSelectionNodes(diagram).filter(node => node.head.line >= rect.startLine && node.head.line <= rect.endLine
      && node.head.startColumn <= rect.endColumn && node.head.endColumn >= rect.startColumn).map(node => node.id)
  } };
}

export function nodeIntersectsRect(node: Pick<DiagramContentNode, 'line' | 'startColumn' | 'endColumn'>, rect: MappingPocGridRect): boolean {
  return node.line >= rect.startLine && node.line <= rect.endLine && node.startColumn <= rect.endColumn && node.endColumn >= rect.startColumn;
}

/** Legacy rectangles are read once as membership; current selections use explicit IDs. */
export function selectionContentNodes(diagram: Diagram, region?: SelectionItem['region']): readonly DiagramContentNode[] {
  const nodes = diagramContentNodes(diagram.content);
  if (!region) return nodes;
  if (region.sourceContentId !== diagram.id || region.sourceAscii !== diagram.content.ascii) return [];
  if (region.contentNodeIds === undefined) return nodes.filter(node => nodeIntersectsRect(node, region.rect));
  const byId = new Map(nodes.map(node => [node.id, node]));
  return region.contentNodeIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}

/** Change membership without moving the envelope, changing identity, or reordering selections. */
export function withSelectionNodes(item: SelectionItem, diagram: Diagram, ids: readonly string[]): SelectionItem {
  const selected = new Set(ids), nodes = diagramContentNodes(diagram.content).filter(node => selected.has(node.id));
  const rect = item.region?.rect ?? {
    startLine: 1, endLine: diagram.content.ascii.split('\n').length, startColumn: 1,
    endColumn: Math.max(1, ...diagram.content.ascii.split('\n').map(line => line.length))
  };
  return { ...item, id: item.region ? item.id : crypto.randomUUID(), region: {
    sourceContentId: diagram.id, sourceRevisionId: diagram.content.revisionId, sourceAscii: diagram.content.ascii,
    rect, contentNodeIds: [...ids], selectedIds: diagramSelectionNodes(diagram).filter(mapping => nodes.some(node =>
      mapping.head.line === node.line && mapping.head.startColumn <= node.endColumn && mapping.head.endColumn >= node.startColumn)).map(mapping => mapping.id)
  } };
}

/** Native shape membership is one part of the selection, not a replacement for node selections. */
export function syncNativeDiagramSelection(state: SelectionState, selected: readonly string[]): SelectionState {
  const native = new Set(selected), existing = selectedDiagramIds(state);
  if (native.size === existing.length && existing.every(id => native.has(id))) return state;
  const items = state.items.filter(item => item.region || native.has(item.displayNodeId));
  const present = new Set(items.filter(item => !item.region).map(item => item.displayNodeId));
  return { items: [...items, ...[...native].filter(id => !present.has(id)).map(diagramSelectionItem)] };
}
