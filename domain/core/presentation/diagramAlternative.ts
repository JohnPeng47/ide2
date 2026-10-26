import { z } from 'zod';
import type { DiagramRevision } from '../diagrams/diagramRevision';
import { revisionScope } from '../diagrams/diagramRevisionReview';
import { diagramContentNodes } from '../diagrams/diagramContentNodes';
import { migrateRevisionSelections, revisionSelectionKey, type RevisionSelections } from '../diagrams/diagramRevisionSelection';
import type { GridBox } from '../diagrams/lineGrid';
import { sha256 } from '../sha256';

const id = z.string().min(1).max(500).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s));
export const alternativeScopeSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('diagram') }).strict(),
  z.object({ kind: z.literal('subtree'), nodeRef: id }).strict()]);
export type DiagramScope = z.infer<typeof alternativeScopeSchema>;
export const alternativePartSchema = z.object({ target: alternativeScopeSchema,
  source: z.object({ revisionId: id, scope: alternativeScopeSchema }).strict(), baseRevisionId: id }).strict();
export const diagramAlternativeSchema = z.object({ id, name: z.string().trim().min(1).max(120), diagramId: id,
  presentationId: id, display: z.enum(['regular', 'diff']).optional(), parentAlternativeId: id.optional(), reviewId: id.optional(),
  parts: z.array(alternativePartSchema).min(1).max(100) }).strict();
export type DiagramAlternative = z.infer<typeof diagramAlternativeSchema>;
export type DiagramAlternativePart = z.infer<typeof alternativePartSchema>;
export const diagramSidePanelSchema = z.object({ id, kind: z.literal('diagram-side-panel'),
  attachment: z.object({ diagramPresentationId: id, nodeRef: id }).strict(), alternativeId: id,
  partIndex: z.number().int().nonnegative(), placement: z.enum(['flow', 'overlay']),
  display: z.enum(['regular', 'diff']), side: z.enum(['left', 'right']) }).strict();
export type DiagramSidePanel = z.infer<typeof diagramSidePanelSchema>;
export const diagramAlternativesSchema = z.object({ schemaVersion: z.literal(1),
  items: z.record(id, diagramAlternativeSchema), selected: z.record(id, z.array(id).max(1000)),
  panels: z.record(id, diagramSidePanelSchema) }).strict();
export type DiagramAlternatives = z.infer<typeof diagramAlternativesSchema>;
export const emptyDiagramAlternatives = (): DiagramAlternatives => ({ schemaVersion: 1, items: {}, selected: {}, panels: {} });
export const scopeOwner = (scope: DiagramScope) => scope.kind === 'diagram' ? 'root' : scope.nodeRef;
export const ownerScope = (owner: string): DiagramScope => owner === 'root' ? { kind: 'diagram' } : { kind: 'subtree', nodeRef: owner };
export const alternativeRevisionIds = (state?: DiagramAlternatives) => [...new Set(Object.values(state?.items ?? {}).flatMap(item => item.parts.flatMap(part => [part.baseRevisionId, part.source.revisionId])))];
const stableId = (...parts: string[]) => `alternative-${sha256(JSON.stringify(parts)).slice(0, 32)}`;

/** Read migration is deterministic and leaves immutable checkpoint records untouched. */
export function migrateDiagramAlternatives<T extends RevisionSelections & { alternatives?: DiagramAlternatives; scene: { root: GridBox } }>(
  input: T, get: (id: string) => DiagramRevision, bindings: Record<string, string> = {}): T & { alternatives?: DiagramAlternatives } {
  if (input.alternatives) { diagramAlternativesSchema.parse(input.alternatives); return input as T & { alternatives: DiagramAlternatives }; }
  if (!Object.keys(input.revisionReviews ?? {}).length && !Object.keys(input.revisionSelections ?? {}).length && !(input as any).variants && !(input as any).variantSelections) return input;
  const document = migrateRevisionSelections(input), state = emptyDiagramAlternatives();
  const boxes: Extract<GridBox, { kind: 'diagram' }>[] = [];
  const visit = (box: GridBox) => box.kind === 'diagram' ? boxes.push(box) : box.children.forEach(visit);
  visit(document.scene.root);
  for (const box of boxes) {
    const presentationId = `grid:${box.id}`, reviews = Object.values(document.revisionReviews ?? {}).filter(r => r.contentId === box.contentId);
    for (const review of reviews) {
      const key = stableId(presentationId, review.id);
      const source = get(review.headRevisionId);
      let owners = [review.ownerNodeId];
      if (review.replacementScope && source.diagram.content.structure.kind === 'tree') {
        const nodes = diagramContentNodes(source.diagram.content);
        const selected = nodes.filter(n => review.replacementScope!.ranges.some(r => n.line >= r.startLine && n.line <= r.endLine));
        const roots = selected.filter(n => !n.parentId || !selected.some(p => p.id === n.parentId));
        const baseRefs = new Set(Object.values(get(review.baseRevisionId).nodeRefs));
        if (roots.length && roots.every(n => baseRefs.has(source.nodeRefs[n.id]))) owners = roots.map(n => source.nodeRefs[n.id]);
      }
      state.items[key] = { id: key, name: review.name, diagramId: review.diagramId, presentationId, reviewId: review.id,
        ...(review.contextVariantId ? { parentAlternativeId: stableId(presentationId, review.contextVariantId) } : {}),
        parts: owners.map(owner => ({ target: ownerScope(owner), source: { revisionId: review.headRevisionId, scope: ownerScope(owner) }, baseRevisionId: review.baseRevisionId })) };
    }
    const choices = Object.values(document.revisionSelections ?? {}).filter(s => s.contentId === box.contentId);
    for (const choice of choices) {
      const matched = reviews.find(r => r.headRevisionId === choice.revisionId && r.ownerNodeId === choice.ownerNodeId
        && (r.contextVariantId ? document.revisionReviews?.[r.contextVariantId]?.headRevisionId : null) === choice.contextRevisionId);
      const key = matched ? stableId(presentationId, matched.id) : stableId(presentationId, choice.ownerNodeId, choice.contextRevisionId ?? '', choice.revisionId);
      if (!state.items[key]) {
        const source = get(choice.revisionId);
        const parent = Object.values(state.items).find(item => item.presentationId === presentationId && item.parts.some(p => p.source.revisionId === choice.contextRevisionId));
        state.items[key] = { id: key, name: 'Selected revision', diagramId: source.diagramId, presentationId,
          ...(parent ? { parentAlternativeId: parent.id } : {}), parts: [{ target: ownerScope(choice.ownerNodeId),
            source: { revisionId: choice.revisionId, scope: ownerScope(choice.sourceOwnerNodeId ?? choice.ownerNodeId) },
            baseRevisionId: choice.contextRevisionId ?? choice.baseRevisionId ?? bindings[box.contentId] ?? choice.revisionId }] };
      }
      if (!(state.selected[presentationId] ??= []).includes(key)) state.selected[presentationId].push(key);
    }
    // Anonymous nested selections may occur before their parent in the legacy map.
    for (const choice of choices) if (choice.contextRevisionId) {
      const item = Object.values(state.items).find(item => item.presentationId === presentationId && item.parts.some(p => p.source.revisionId === choice.revisionId && scopeOwner(p.target) === choice.ownerNodeId));
      let parent = Object.values(state.items).find(candidate => candidate.id !== item?.id && candidate.presentationId === presentationId && candidate.parts.some(p => p.source.revisionId === choice.contextRevisionId));
      if (!parent) {
        const key = stableId(presentationId, 'root', '', choice.contextRevisionId);
        parent = { id: key, name: 'Context revision', diagramId: get(choice.contextRevisionId).diagramId, presentationId,
          parts: [{ target: { kind: 'diagram' }, source: { revisionId: choice.contextRevisionId, scope: { kind: 'diagram' } },
            baseRevisionId: bindings[box.contentId] ?? choice.contextRevisionId }] };
        state.items[key] = parent;
      }
      if (item) item.parentAlternativeId = parent.id;
    }
  }
  return { ...document, alternatives: state };
}

/** Adapt explicit promoted choices to the existing immutable row composition engine. */
export function alternativeSelections(document: RevisionSelections & { alternatives?: DiagramAlternatives }, presentationId: string, contentId: string, base?: DiagramRevision): RevisionSelections {
  if (!document.alternatives) return document;
  const state = document.alternatives, selections: NonNullable<RevisionSelections['revisionSelections']> = {};
  const active = new Set(state.selected[presentationId] ?? []);
  const enabled = (item: DiagramAlternative, seen = new Set<string>()): boolean => {
    if (seen.has(item.id)) throw Error('Cyclic alternative context'); seen.add(item.id);
    if (base && !item.parentAlternativeId && item.parts.some(part => part.target.kind === 'subtree' && !Object.values(base.nodeRefs).includes(part.target.nodeRef))) return false;
    return active.has(item.id) && (!item.parentAlternativeId || !!state.items[item.parentAlternativeId] && enabled(state.items[item.parentAlternativeId], seen));
  };
  for (const item of Object.values(state.items)) if (item.presentationId === presentationId && enabled(item)) {
    for (const part of item.parts) {
      const ownerNodeId = scopeOwner(part.target);
      const contextRevisionId = item.parentAlternativeId ? part.baseRevisionId : null;
      selections[revisionSelectionKey(contentId, ownerNodeId, contextRevisionId)] = { contentId, ownerNodeId, contextRevisionId,
        revisionId: part.source.revisionId, sourceOwnerNodeId: scopeOwner(part.source.scope), baseRevisionId: part.baseRevisionId };
    }
  }
  return { revisionSelections: selections };
}

export function validateDiagramAlternatives(state: DiagramAlternatives, get: (id: string) => DiagramRevision) {
  diagramAlternativesSchema.parse(state);
  for (const [key, item] of Object.entries(state.items)) {
    if (key !== item.id) throw Error('Invalid alternative identity');
    if (item.display === 'diff' && (item.parentAlternativeId || item.parts.length !== 1 || item.parts[0].target.kind !== 'diagram' || item.parts[0].source.scope.kind !== 'diagram'))
      throw Error('Diff alternatives require one whole-Diagram part');
    const ancestors = new Set([key]);
    for (let parent = item.parentAlternativeId; parent; parent = state.items[parent]?.parentAlternativeId) {
      if (ancestors.has(parent) || state.items[parent]?.presentationId !== item.presentationId) throw Error('Invalid alternative parent');
      ancestors.add(parent);
    }
    const ranges = item.parts.map(part => {
      const base = get(part.baseRevisionId), source = get(part.source.revisionId);
      if (base.diagramId !== item.diagramId || source.diagramId !== item.diagramId) throw Error('Alternative belongs to another diagram');
      revisionScope(source, scopeOwner(part.source.scope));
      const target = revisionScope(base, scopeOwner(part.target));
      if (item.parentAlternativeId && !state.items[item.parentAlternativeId].parts.some(parent => {
        if (parent.source.revisionId !== base.id) return false;
        const scope = revisionScope(base, scopeOwner(parent.source.scope));
        return target.startLine >= scope.startLine && target.endLine <= scope.endLine;
      })) throw Error('Nested alternative is outside its parent source scope');
      return { revisionId: base.id, ...target };
    });
    if (ranges.some((a, i) => ranges.slice(i + 1).some(b => a.revisionId !== b.revisionId || a.startLine <= b.endLine && b.startLine <= a.endLine)))
      throw Error('Alternative parts require one base revision and disjoint targets');
  }
  for (const [owner, ids] of Object.entries(state.selected)) {
    if (new Set(ids).size !== ids.length || ids.some(id => state.items[id]?.presentationId !== owner)) throw Error('Invalid selected alternative');
    const selected = ids.map(id => state.items[id]);
    for (let i = 0; i < selected.length; i++) for (const other of selected.slice(i + 1))
      if (alternativesOverlap(selected[i], other, get)) throw Error('ALTERNATIVE_CONFLICT: deselect the overlapping alternative first');
  }
  for (const [key, panel] of Object.entries(state.panels)) {
    const item = state.items[panel.alternativeId], part = item?.parts[panel.partIndex];
    if (key !== panel.id || item?.presentationId !== panel.attachment.diagramPresentationId || !part || scopeOwner(part.target) !== panel.attachment.nodeRef)
      throw Error('Invalid side panel attachment');
  }
}
export function alternativesOverlap(a: DiagramAlternative, b: DiagramAlternative, get: (id: string) => DiagramRevision) {
  if (a.parentAlternativeId !== b.parentAlternativeId) return false;
  return a.parts.some(left => b.parts.some(right => {
    if (scopeOwner(left.target) === scopeOwner(right.target) || left.target.kind === 'diagram' || right.target.kind === 'diagram') return true;
    const base = get(left.baseRevisionId);
    try { const x = revisionScope(base, scopeOwner(left.target)), y = revisionScope(base, scopeOwner(right.target)); return x.startLine <= y.endLine && y.startLine <= x.endLine; }
    catch { return false; }
  }));
}
