import type { CompareCandidate, CompareDiagramTarget, CompareSource } from '../compare/comparePageSession';
import type { EvalReference, EvalReferenceGroup } from './evalReference';

// Not a valid group ID, so a group named "Ungrouped" cannot collide with it.
export const UNGROUPED_ID = '(ungrouped)';
export interface ReferenceGroupNode { id: string; name: string; group?: EvalReferenceGroup; references: EvalReference[] }

/** Named groups by name, then a trailing Ungrouped section. Empty groups stay so they can be filled; a filter hides them. */
export function referenceGroupNodes(references: EvalReference[], groups: EvalReferenceGroup[], query = ''): ReferenceGroupNode[] {
  const needle = query.trim().toLowerCase();
  const matches = (reference: EvalReference, group?: EvalReferenceGroup) => !needle
    || [reference.name, reference.id, reference.canvasName, reference.sourceName, reference.diagramName ?? '', reference.comment ?? '', group?.name ?? ''].join('\n').toLowerCase().includes(needle);
  const known = new Map(groups.map(group => [group.id, group]));
  const nodes = groups.map((group): ReferenceGroupNode => ({ id: group.id, name: group.name, group, references: references.filter(item => item.groupId === group.id && matches(item, group)) }));
  const loose = references.filter(item => !(item.groupId && known.has(item.groupId)) && matches(item));
  return [...nodes.filter(node => !needle || node.references.length), ...(loose.length ? [{ id: UNGROUPED_ID, name: 'Ungrouped', references: loose }] : [])];
}

export interface DiagramLeaf { key: string; source: CompareSource; candidate: CompareCandidate; diagram: CompareDiagramTarget; name: string }
/** A folder of the Canvas explorer: its children are either more folders or diagrams. */
export interface DiagramFolder { id: string; name: string; count: number; folders: DiagramFolder[]; diagrams: DiagramLeaf[] }

const sourceOf = ({ documentId, viewId, checkpointId }: CompareSource): CompareSource => ({ documentId, ...(viewId ? { viewId } : {}), checkpointId });
export const diagramLeafKey = (source: CompareSource, diagramId: string) => JSON.stringify([source.documentId, source.viewId ?? '', source.checkpointId, diagramId]);
const folder = (id: string, name: string, folders: DiagramFolder[], diagrams: DiagramLeaf[]): DiagramFolder =>
  ({ id, name, folders, diagrams, count: diagrams.length + folders.reduce((sum, item) => sum + item.count, 0) });

/**
 * Saved canvases, then generated canvases by their run context. A canvas with a single version shows its diagrams directly,
 * so the common case stays two levels deep. Versions with no matching diagrams, and the folders they empty, are dropped.
 */
export function diagramFolders(candidates: CompareCandidate[], query = ''): DiagramFolder[] {
  const needle = query.trim().toLowerCase();
  const leaves = (candidate: CompareCandidate): DiagramLeaf[] => candidate.diagrams.map(diagram => {
    const source = sourceOf(candidate);
    return { key: diagramLeafKey(source, diagram.diagramId), source, candidate, diagram, name: diagram.name.trim() || diagram.diagramId };
  }).filter(leaf => !needle || [leaf.name, leaf.candidate.name, leaf.candidate.canvasName].join('\n').toLowerCase().includes(needle));
  const versions = (id: string, name: string, items: CompareCandidate[], label: (candidate: CompareCandidate) => string): DiagramFolder => {
    const visible = items.map(candidate => [candidate, leaves(candidate)] as const).filter(([, diagrams]) => diagrams.length);
    if (visible.length === 1) return folder(id, name, [], visible[0][1]);
    return folder(id, name, visible.map(([candidate, diagrams]) => folder(`${id}/${candidate.viewId ?? candidate.documentId}`, label(candidate), [], diagrams)), []);
  };
  const byKey = (items: CompareCandidate[], key: (candidate: CompareCandidate) => string) => [...items.reduce((map, item) => map.set(key(item), [...(map.get(key(item)) ?? []), item]), new Map<string, CompareCandidate[]>())];
  const saved = byKey(candidates.filter(item => !item.generated), item => item.documentId)
    .map(([id, items]) => versions(`canvas/${id}`, items[0].canvasName, items, item => item.name));
  const generated = byKey(candidates.filter(item => item.generated), item => item.generated!.agentContextId)
    .map(([id, items]) => versions(`context/${id}`, items[0].generated!.contextName, items, item => item.canvasName === item.generated!.contextName ? item.name : item.canvasName));
  const sections = [folder('saved', 'Saved canvases', saved.filter(item => item.count), []), folder('generated', 'Generated', generated.filter(item => item.count), [])];
  return sections.filter(section => section.count);
}
