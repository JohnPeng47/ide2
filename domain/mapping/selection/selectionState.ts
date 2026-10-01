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
    readonly rect: MappingPocGridRect;
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
const sameRegion = (a: SelectionItem, b: SelectionItem) => a.displayNodeId === b.displayNodeId && a.region && b.region
  && a.region.sourceContentId === b.region.sourceContentId && a.region.sourceAscii === b.region.sourceAscii
  && a.region.rect.startLine === b.region.rect.startLine && a.region.rect.endLine === b.region.rect.endLine
  && a.region.rect.startColumn === b.region.rect.startColumn && a.region.rect.endColumn === b.region.rect.endColumn;

/** One reducer enforces identity, deduplication and diagram/region exclusion for every consumer. */
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
    const equivalent = requested.region && (items.find(item => sameRegion(item, requested)) ?? state.items.find(item => sameRegion(item, requested)));
    const item = equivalent ? { ...requested, id: equivalent.id } : requested;
    items = items.filter(old => old.id === item.id || old.displayNodeId !== item.displayNodeId || Boolean(old.region && item.region));
    const index = items.findIndex(old => old.id === item.id);
    if (index < 0) items.push(item); else items[index] = item;
  }
  return { items };
}

/** Capture a completed region once, before rendering or publishing it. */
export function regionSelectionItem(diagram: Diagram, boxId: string, rect: MappingPocGridRect, id: string = crypto.randomUUID()): SelectionItem {
  return { id, displayNodeId: `grid:${boxId}`, region: {
    sourceContentId: diagram.id, sourceRevisionId: diagram.content.revisionId, sourceAscii: diagram.content.ascii, rect: { ...rect },
    selectedIds: diagramSelectionNodes(diagram).filter(node => node.head.line >= rect.startLine && node.head.line <= rect.endLine
      && node.head.startColumn <= rect.endColumn && node.head.endColumn >= rect.startColumn).map(node => node.id)
  } };
}
