import type { Diagram } from './diagram';
import { diagramContentNodes } from './diagramContentNodes';

export interface SubtreeRange { startLine: number; endLine: number }
export function diagramSubtreeRange(diagram: Diagram, contentNodeId: string): SubtreeRange {
  const nodes = diagramContentNodes(diagram.content), root = nodes.find(node => node.id === contentNodeId);
  if (!root) throw Error('STALE_SUBTREE: select a current node');
  const ids = new Set<string>();
  const visit = (id: string) => { if (ids.has(id)) return; ids.add(id); nodes.find(node => node.id === id)?.childIds.forEach(visit); };
  visit(root.id);
  const descendants = nodes.filter(node => ids.has(node.id));
  const last = Math.max(...descendants.map(node => node.line), ...root.foldRanges.map(range => range.endLine));
  if (nodes.some(node => node.line >= root.line && node.line <= last && !ids.has(node.id)))
    throw Error('This selection is not a contiguous subtree. Choose a tree branch.');
  return { startLine: root.line, endLine: last };
}

/** A candidate contains full context, but only the selected range may differ. */
export function subtreeReplacement(base: Diagram, ascii: string, range: SubtreeRange): string {
  const before = base.content.ascii.split('\n'), after = ascii.split('\n');
  const prefix = before.slice(0, range.startLine - 1), suffix = before.slice(range.endLine);
  if (after.length < prefix.length + suffix.length || prefix.some((line, i) => line !== after[i])
    || suffix.some((line, i) => line !== after[after.length - suffix.length + i]))
    throw Error('SUBTREE_SCOPE: preserve every line outside the selected subtree exactly');
  return after.slice(prefix.length, after.length - suffix.length).join('\n');
}

export type ReplaceMode = 'diagram' | 'subnode-single' | 'multi-contiguous' | 'multi-disjoint';
export interface SubtreeTarget { contentNodeId: string; revisionId: string }
/** Resolve revision-pinned subtree roots before invoking the model. Never widen a selection. */
export function diagramReplacementRanges(diagram: Diagram, mode: ReplaceMode, subtree?: SubtreeTarget, subtrees?: SubtreeTarget[]): SubtreeRange[] {
  if (mode === 'diagram') {
    if (subtree || subtrees) throw Error('REPLACEMENT_SCOPE: diagram mode cannot include subtree targets');
    return [];
  }
  const targets = mode === 'subnode-single' ? subtree && !subtrees ? [subtree] : [] : !subtree ? subtrees ?? [] : [];
  if (targets.length < (mode === 'subnode-single' ? 1 : 2)) throw Error('REPLACEMENT_SCOPE: supply subtree for subnode-single, or at least two subtrees for a multi mode');
  if (targets.some(target => target.revisionId !== diagram.content.revisionId)) throw Error('VERSION_CONFLICT: selected subtree changed; select it again');
  const ranges = targets.map(target => ({ ...diagramSubtreeRange(diagram, target.contentNodeId), id: target.contentNodeId })).sort((a, b) => a.startLine - b.startLine);
  if (ranges.some((range, i) => i > 0 && range.startLine <= ranges[i - 1].endLine)) throw Error('REPLACEMENT_SCOPE: subtree targets must not overlap or repeat');
  if (mode === 'multi-contiguous') {
    if (ranges.some((range, i) => i > 0 && diagram.content.ascii.split('\n').slice(ranges[i - 1].endLine, range.startLine - 1).some(line => line.trim())))
      throw Error('REPLACEMENT_SCOPE: multi-contiguous requires adjacent subtrees');
    return [{ startLine: ranges[0].startLine, endLine: ranges.at(-1)!.endLine }];
  }
  if (mode === 'multi-disjoint' && ranges.some((range, i) => i > 0 && range.startLine === ranges[i - 1].endLine + 1))
    throw Error('REPLACEMENT_SCOPE: adjacent subtrees use multi-contiguous');
  return ranges.map(({ startLine, endLine }) => ({ startLine, endLine }));
}

/** Output line ranges correspond, in order, to the requested input ranges. Empty output uses endLine = startLine - 1. */
export function scopedReplacements(base: Diagram, ascii: string, ranges: readonly SubtreeRange[], outputRanges?: readonly SubtreeRange[]) {
  const before = base.content.ascii.split('\n'), after = ascii.split('\n');
  if (!ranges.length) throw Error('REPLACEMENT_SCOPE: expected at least one range');
  if (ranges.length === 1 && !outputRanges) {
    const range = ranges[0];
    subtreeReplacement(base, ascii, range);
    outputRanges = [{ startLine: range.startLine, endLine: after.length - (before.length - range.endLine) }];
  }
  if (!outputRanges || outputRanges.length !== ranges.length) throw Error('REPLACEMENT_SCOPE: supply one output range for every selected range');
  let oldEnd = 0, newEnd = 0;
  const patches = ranges.map((range, i) => {
    const output = outputRanges![i];
    for (const [r, length, end] of [[range, before.length, oldEnd], [output, after.length, newEnd]] as const) {
      if (!Number.isInteger(r.startLine) || !Number.isInteger(r.endLine) || r.startLine <= end || r.startLine > length + 1 || r.endLine < r.startLine - 1 || r.endLine > length)
        throw Error('REPLACEMENT_SCOPE: invalid or overlapping line ranges');
    }
    const gap = before.slice(oldEnd, range.startLine - 1), nextGap = after.slice(newEnd, output.startLine - 1);
    if (gap.length !== nextGap.length || gap.some((line, j) => line !== nextGap[j])) throw Error('REPLACEMENT_SCOPE: preserve every line outside the selected ranges exactly');
    oldEnd = range.endLine; newEnd = output.endLine;
    return { start: range.startLine, end: range.endLine, patch: after.slice(output.startLine - 1, output.endLine) };
  });
  const tail = before.slice(oldEnd), nextTail = after.slice(newEnd);
  if (tail.length !== nextTail.length || tail.some((line, i) => line !== nextTail[i])) throw Error('REPLACEMENT_SCOPE: preserve every line outside the selected ranges exactly');
  return { patches, outputRanges: [...outputRanges] };
}
