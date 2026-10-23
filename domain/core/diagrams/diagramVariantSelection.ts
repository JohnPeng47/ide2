import type { DiagramRevision } from './diagramService';
import type { DiagramVariant } from './diagramVariant';
import { variantRange } from './diagramVariant';
import { diagramContentNodes } from './diagramContentNodes';

export interface BranchVariantSelection {
  contentId: string;
  ownerNodeId: string;
  contextVariantId: string | null;
  activeVariantId: string;
}
export const variantSelectionKey = (contentId: string, ownerNodeId: string, contextVariantId: string | null) =>
  JSON.stringify([contentId, ownerNodeId, contextVariantId]);
export interface VariantSelections {
  variants?: Record<string, DiagramVariant>;
  variantSelections?: Record<string, BranchVariantSelection>;
}
export function validateVariantSelections(document: VariantSelections) {
  for (const [key, selection] of Object.entries(document.variantSelections ?? {})) {
    const variant = document.variants?.[selection.activeVariantId];
    if (key !== variantSelectionKey(selection.contentId, selection.ownerNodeId, selection.contextVariantId)
      || !variant || variant.contentId !== selection.contentId || variant.ownerNodeId !== selection.ownerNodeId
      || (variant.contextVariantId ?? null) !== selection.contextVariantId) throw Error('Invalid branch variant selection');
  }
  for (const variant of Object.values(document.variants ?? {})) {
    const seen = new Set([variant.id]);
    for (let id = variant.contextVariantId; id; id = document.variants?.[id]?.contextVariantId) {
      if (seen.has(id)) throw Error('Cyclic variant context');
      seen.add(id);
      if (document.variants?.[id]?.contentId !== variant.contentId) throw Error('Invalid variant context');
    }
  }
}
export interface ResolvedVariantLine {
  revision: DiagramRevision;
  sourceLine: number;
  nodeRef?: string;
  variantId: string | null;
  /** Context and owner used by the variant picker on this row. */
  contextVariantId: string | null;
  ownerNodeId?: string;
}
/** Compose references to immutable source rows. No revisions are issued while rendering. */
export function resolveVariantLines(base: DiagramRevision, document: VariantSelections, get: (id: string) => DiagramRevision): ResolvedVariantLine[] {
  const contentId = base.diagram.id;
  const selected = (owner: string, context: string | null) => {
    const id = document.variantSelections?.[variantSelectionKey(contentId, owner, context)]?.activeVariantId;
    return id ? document.variants?.[id] : undefined;
  };
  const render = (revision: DiagramRevision, owner: string, context: string | null, depth: number, selectOwner = true): ResolvedVariantLine[] => {
    if (depth > 100) throw Error('Variant nesting is too deep');
    const alternative = selectOwner && selected(owner, context);
    if (alternative) {
      const rows = render(get(alternative.headRevisionId), owner, alternative.id, depth + 1, false);
      if (rows[0]) rows[0] = { ...rows[0], ownerNodeId: owner, contextVariantId: context };
      return rows;
    }
    const range = variantRange(revision, owner), nodes = diagramContentNodes(revision.diagram.content);
    const byLine = new Map(nodes.map(node => [node.line, node]));
    const rows: ResolvedVariantLine[] = [];
    for (let line = range.startLine; line <= range.endLine; line++) {
      const node = byLine.get(line), ref = node && revision.nodeRefs[node.id];
      // The first row already represents the selected scope. Its descendant selections are separate.
      if (ref && ref !== owner && !(owner === 'root' && line === range.startLine) && selected(ref, context)) {
        rows.push(...render(revision, ref, context, depth + 1));
        line = variantRange(revision, ref).endLine;
      } else rows.push({ revision, sourceLine: line, nodeRef: ref, variantId: context,
        contextVariantId: context, ownerNodeId: line === range.startLine ? owner : ref });
    }
    return rows;
  };
  return render(base, 'root', null, 0);
}
