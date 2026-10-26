import { alternativeSelections, alternativesOverlap, emptyDiagramAlternatives, ownerScope, scopeOwner, validateDiagramAlternatives, type DiagramAlternative, type DiagramAlternativePart, type DiagramSidePanel } from '../../core/presentation/diagramAlternative';
import { getDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import type { MappingGridDocument } from './mappingGrid';
import { findBox } from './canvasDisplayNode';

export type AlternativeOperation =
  | { method: 'alternative-promote'; nodeId: string; alternativeId: string; name: string; parts: DiagramAlternativePart[]; display?: 'regular' | 'diff'; parentAlternativeId?: string; reviewId?: string; select?: boolean }
  | { method: 'alternative-select'; nodeId: string; alternativeId: string; selected: boolean; replace?: boolean }
  | { method: 'alternative-remove'; nodeId: string; alternativeId: string }
  | { method: 'side-panel'; nodeId: string; alternativeId: string; partIndex: number; close?: boolean; placement?: 'flow' | 'overlay'; display?: 'regular' | 'diff'; autoPlace?: boolean; side?: 'left' | 'right' };

export function applyAlternativeOperation(document: MappingGridDocument, op: AlternativeOperation) {
  const box = findBox(document.scene.root, op.nodeId.replace(/^grid:/, ''));
  if (box?.kind !== 'diagram' || op.nodeId !== `grid:${box.id}`) throw Error('Expected diagram presentation');
  const diagram = document.scene.contents[box.contentId];
  const state = document.alternatives = structuredClone(document.alternatives ?? emptyDiagramAlternatives());
  if (op.method === 'alternative-promote') {
    if (state.items[op.alternativeId]) throw Error('Alternative already exists');
    state.items[op.alternativeId] = { id: op.alternativeId, name: op.name, diagramId: diagram.diagramId, presentationId: op.nodeId,
      parts: structuredClone(op.parts), ...(op.display ? { display: op.display } : {}), ...(op.parentAlternativeId ? { parentAlternativeId: op.parentAlternativeId } : {}), ...(op.reviewId ? { reviewId: op.reviewId } : {}) };
    if (op.select) selectAlternative(document, state.items[op.alternativeId], true, false);
  } else {
    const item = state.items[op.alternativeId];
    if (!item || item.presentationId !== op.nodeId) throw Error('Alternative belongs to another presentation');
    if (op.method === 'alternative-select') selectAlternative(document, item, op.selected, !!op.replace);
    if (op.method === 'alternative-remove') {
      if (Object.values(state.items).some(child => child.parentAlternativeId === item.id)) throw Error('Remove nested alternatives first');
      delete state.items[item.id];
      state.selected[op.nodeId] = (state.selected[op.nodeId] ?? []).filter(id => id !== item.id);
      for (const panel of Object.values(state.panels)) if (panel.alternativeId === item.id) delete state.panels[panel.id];
    }
    if (op.method === 'side-panel') {
      const part = item.parts[op.partIndex];
      if (!part) throw Error('Unknown alternative part');
      const id = `panel:${item.id}:${op.partIndex}`, previous = state.panels[id];
      if (op.close) delete state.panels[id];
      else state.panels[id] = { id, kind: 'diagram-side-panel', attachment: { diagramPresentationId: op.nodeId, nodeRef: scopeOwner(part.target) },
        alternativeId: item.id, partIndex: op.partIndex, placement: op.placement ?? previous?.placement ?? 'overlay',
        display: op.display ?? previous?.display ?? item.display ?? 'regular', side: op.side ?? previous?.side ?? 'right' } satisfies DiagramSidePanel;
    }
  }
  validateDiagramAlternatives(state, getDiagramRevision);
}
function selectAlternative(document: MappingGridDocument, item: DiagramAlternative, selected: boolean, replace: boolean) {
  const state = document.alternatives!;
  let ids = (state.selected[item.presentationId] ?? []).filter(id => id !== item.id);
  if (selected) {
    const box = findBox(document.scene.root, item.presentationId.slice(5));
    if (!item.parentAlternativeId && box?.kind === 'diagram') {
      const refs = Object.values(getDiagramRevision(document.scene.contents[box.contentId].revisionId).nodeRefs);
      if (item.parts.some(part => part.target.kind === 'subtree' && !refs.includes(part.target.nodeRef))) throw Error('STALE_ALTERNATIVE: a target no longer exists');
    }
    if (replace) ids = ids.filter(id => !alternativesOverlap(item, state.items[id], getDiagramRevision));
    ids.push(item.id);
  }
  state.selected[item.presentationId] = ids;
}

/** Keep older clients working while choices now belong to individual placements. */
export function selectLegacyRevision(document: MappingGridDocument, nodeId: string, contentId: string, owner: string, context: string | null,
  revisionId: string | null | undefined, baseRevisionId: string, reviewId?: string) {
  const state = document.alternatives ??= emptyDiagramAlternatives();
  const parent = Object.values(state.items).find(item => item.presentationId === nodeId && item.parts.some(p => p.source.revisionId === context));
  for (const id of state.selected[nodeId] ?? []) {
    const item = state.items[id];
    if (item.parentAlternativeId === parent?.id && item.parts.some(p => scopeOwner(p.target) === owner)) selectAlternative(document, item, false, false);
  }
  if (!revisionId) return;
  const existing = Object.values(state.items).find(item => item.presentationId === nodeId && item.parentAlternativeId === parent?.id
    && item.parts.some(p => p.source.revisionId === revisionId && scopeOwner(p.target) === owner));
  if (existing) selectAlternative(document, existing, true, true);
  else applyAlternativeOperation(document, { method: 'alternative-promote', nodeId, alternativeId: `alternative-${crypto.randomUUID()}`,
    name: reviewId ? document.revisionReviews?.[reviewId]?.name ?? 'Alternative' : 'Selected revision',
    parts: [{ target: ownerScope(owner), source: { revisionId, scope: ownerScope(owner) }, baseRevisionId }], reviewId,
    parentAlternativeId: parent?.id, select: true });
  // The legacy map remains readable by older API consumers, but rendering uses per-placement choices.
  void contentId;
}
export { alternativeSelections };
