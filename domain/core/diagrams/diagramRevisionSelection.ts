import type { DiagramRevision } from './diagramRevision';
import type { DiagramRevisionReview } from './diagramRevisionReview';
import { revisionScope } from './diagramRevisionReview';
import { diagramContentNodes } from './diagramContentNodes';

/** A presentation choice. It needs no review, branch object, or mutable head. */
export interface DiagramRevisionSelection {
  contentId: string;
  ownerNodeId: string;
  contextRevisionId: string | null;
  revisionId: string;
  sourceOwnerNodeId?: string;
  baseRevisionId?: string;
}
export const revisionSelectionKey = (contentId: string, ownerNodeId: string, contextRevisionId: string | null) =>
  JSON.stringify([contentId, ownerNodeId, contextRevisionId]);
export interface RevisionSelections {
  revisionReviews?: Record<string, DiagramRevisionReview>;
  revisionSelections?: Record<string, DiagramRevisionSelection>;
}

/** Decode old checkpoint fields once at the boundary; never mutate an immutable checkpoint. */
export function migrateRevisionSelections<T extends object>(input: T): T & RevisionSelections {
  const old = input as T & RevisionSelections & { variants?: Record<string, DiagramRevisionReview>; variantSelections?: Record<string, { contentId: string; ownerNodeId: string; contextVariantId: string | null; activeVariantId: string }> };
  if (!old.variants && !old.variantSelections) return input as T & RevisionSelections;
  const { variants, variantSelections, ...rest } = old;
  const reviews = old.revisionReviews ?? variants ?? {};
  const selections = { ...old.revisionSelections };
  for (const selection of Object.values(variantSelections ?? {})) {
    const review = reviews[selection.activeVariantId];
    if (!review) throw Error('Missing revision review for legacy selection');
    const contextRevisionId = selection.contextVariantId ? reviews[selection.contextVariantId]?.headRevisionId : null;
    if (contextRevisionId === undefined) throw Error('Missing legacy selection context');
    const value = { contentId: selection.contentId, ownerNodeId: selection.ownerNodeId, contextRevisionId,
      revisionId: review.headRevisionId, baseRevisionId: review.baseRevisionId };
    selections[revisionSelectionKey(value.contentId, value.ownerNodeId, contextRevisionId)] = value;
  }
  return { ...rest, ...(Object.keys(reviews).length ? { revisionReviews: reviews } : {}),
    ...(Object.keys(selections).length ? { revisionSelections: selections } : {}) } as T & RevisionSelections;
}

export function validateRevisionSelections(document: RevisionSelections, get?: (id: string) => DiagramRevision) {
  for (const [key, selection] of Object.entries(document.revisionSelections ?? {})) {
    if (key !== revisionSelectionKey(selection.contentId, selection.ownerNodeId, selection.contextRevisionId)
      || !selection.revisionId || !selection.ownerNodeId || !selection.contentId) throw Error('Invalid revision selection');
    if (get) {
      const revision = get(selection.revisionId);
      if (!revision || revision.diagram.id !== selection.contentId) throw Error('Revision selection belongs to another diagram');
      revisionScope(revision, selection.sourceOwnerNodeId ?? selection.ownerNodeId);
      for (const id of [selection.contextRevisionId, selection.baseRevisionId]) if (id && get(id).diagramId !== revision.diagramId)
        throw Error('Revision selection context belongs to another diagram');
    }
  }
  for (const review of Object.values(document.revisionReviews ?? {})) {
    const seen = new Set([review.id]);
    for (let id = review.contextVariantId; id; id = document.revisionReviews?.[id]?.contextVariantId) {
      if (seen.has(id)) throw Error('Cyclic review context');
      seen.add(id);
      if (document.revisionReviews?.[id]?.contentId !== review.contentId) throw Error('Invalid review context');
    }
  }
}
export interface ResolvedRevisionLine {
  revision: DiagramRevision;
  sourceLine: number;
  nodeRef?: string;
  contextRevisionId: string | null;
  ownerNodeId?: string;
}

/** Compose immutable source rows; no new content revision is issued during display. */
export function resolveRevisionLines(base: DiagramRevision, document: RevisionSelections, get: (id: string) => DiagramRevision, collapsedNodeRefs: ReadonlySet<string> = new Set()): ResolvedRevisionLine[] {
  const contentId = base.diagram.id;
  const selected = (owner: string, context: string | null) => document.revisionSelections?.[revisionSelectionKey(contentId, owner, context)];
  const render = (revision: DiagramRevision, owner: string, context: string | null, depth: number, selectOwner = true): ResolvedRevisionLine[] => {
    if (depth > 100) throw Error('Revision selection nesting is too deep');
    const alternative = selectOwner && selected(owner, context);
    if (alternative) {
      const next = get(alternative.revisionId);
      if (next.diagramId !== base.diagramId) throw Error('Revision selection belongs to another diagram');
      const rows = render(next, alternative.sourceOwnerNodeId ?? owner, next.id, depth + 1, false);
      if (rows[0]) rows[0] = { ...rows[0], ownerNodeId: owner, contextRevisionId: context };
      return collapsedNodeRefs.has(owner) ? rows.slice(0, 1) : rows;
    }
    const range = revisionScope(revision, owner), nodes = diagramContentNodes(revision.diagram.content);
    const byLine = new Map(nodes.map(node => [node.line, node]));
    const rows: ResolvedRevisionLine[] = [];
    for (let line = range.startLine; line <= range.endLine; line++) {
      const node = byLine.get(line), ref = node && revision.nodeRefs[node.id];
      if (ref && ref !== owner && selected(ref, context)) {
        rows.push(...render(revision, ref, context, depth + 1));
        line = revisionScope(revision, ref).endLine;
      } else {
        rows.push({ revision, sourceLine: line, nodeRef: ref, contextRevisionId: context, ownerNodeId: line === range.startLine ? owner : ref });
        if (ref && collapsedNodeRefs.has(ref)) line = revisionScope(revision, ref).endLine;
      }
    }
    return rows;
  };
  return render(base, 'root', null, 0);
}
