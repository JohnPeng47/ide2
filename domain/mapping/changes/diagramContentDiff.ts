import type { DiagramContent } from '../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { matchDiagramNodes } from './diagramNodeMatcher';
import { orderedIndices } from './orderedIndices';

export type DiffStatus = 'added' | 'removed' | 'modified';
export interface NodeDiff { status?: DiffStatus; moved?: boolean; containsChanges?: boolean }
export interface DiagramDiffSide {
  nodes: Map<string, NodeDiff>;
  /** Unparsed text only, keyed by its original 1-based source line. */
  lines: Map<number, DiffStatus>;
}
export interface DiagramContentDiff {
  original: DiagramDiffSide; proposed: DiagramDiffSide;
  modifications: { original: ModifiedText; proposed: ModifiedText }[];
  /** Baseline-only text inserted before a proposed source line, without live anchors. */
  removals: { text: string; beforeLine: number; ancestorIds: string[]; spans: { start: number; end: number; contentNodeId?: string }[] }[];
  counts: { added: number; removed: number; modified: number; moved: number };
}
export interface ModifiedText { contentNodeId?: string; sourceLine: number; text: string }

/** Rendering-only correspondence. Never use these heuristic matches for edge anchors. */
export function diffDiagramContent(before: DiagramContent | undefined, after: DiagramContent | undefined,
  origins: Readonly<Record<string, string>> = {}): DiagramContentDiff {
  const result: DiagramContentDiff = { original: { nodes: new Map(), lines: new Map() },
    proposed: { nodes: new Map(), lines: new Map() }, modifications: [], removals: [], counts: { added: 0, removed: 0, modified: 0, moved: 0 } };
  if (before?.ascii === after?.ascii) return result;
  const index = (content?: DiagramContent) => {
    const lines = content?.ascii.split('\n') ?? [];
    const nodes = (content ? diagramContentNodes(content) : []).filter(n =>
      lines[n.line - 1]?.slice(n.startColumn - 1, n.endColumn) === n.label);
    return { lines, nodes, byId: new Map(nodes.map(n => [n.id, n])) };
  };
  const a = index(before), b = index(after);
  const { forward, reverse } = matchDiagramNodes(a.nodes, b.nodes, origins);
  const children = (side: typeof a, parent?: string) => parent
    ? (side.byId.get(parent)?.childIds ?? []).flatMap(id => side.byId.has(id) ? [side.byId.get(id)!] : [])
    : side.nodes.filter(n => !n.parentId || !side.byId.has(n.parentId));

  const update = (side: DiagramDiffSide, id: string, value: NodeDiff) => side.nodes.set(id, { ...side.nodes.get(id), ...value });
  for (const n of a.nodes) if (!forward.has(n.id)) { update(result.original, n.id, { status: 'removed' }); result.counts.removed++; }
  for (const n of b.nodes) if (!reverse.has(n.id)) { update(result.proposed, n.id, { status: 'added' }); result.counts.added++; }
  const moved = new Set<string>();
  for (const [oldId, nextId] of forward) {
    const old = a.byId.get(oldId)!, next = b.byId.get(nextId)!;
    if (old.label !== next.label) {
      result.modifications.push({ original: { contentNodeId: oldId, sourceLine: old.line, text: old.label },
        proposed: { contentNodeId: nextId, sourceLine: next.line, text: next.label } });
      update(result.original, oldId, { status: 'modified' }); update(result.proposed, nextId, { status: 'modified' }); result.counts.modified++;
    }
    if (old.parentId ? !forward.has(old.parentId) || forward.get(old.parentId) !== next.parentId : !!next.parentId) moved.add(oldId);
  }
  for (const parent of [undefined, ...a.nodes.map(n => n.id)]) {
    const left = children(a, parent), targetParent = parent ? forward.get(parent) : undefined;
    if (parent && !targetParent) continue;
    const positions = new Map(children(b, targetParent).map((n, i) => [n.id, i]));
    const matched = left.flatMap(n => { const j = positions.get(forward.get(n.id) ?? ''); return j === undefined ? [] : [{ id: n.id, j }]; });
    const stable = orderedIndices(matched.map(n => n.j));
    matched.forEach((n, i) => { if (!stable.has(i)) moved.add(n.id); });
  }
  for (const old of moved) {
    update(result.original, old, { moved: true }); update(result.proposed, forward.get(old)!, { moved: true }); result.counts.moved++;
  }
  const ancestors = (side: typeof a, output: DiagramDiffSide, other: DiagramDiffSide, matches: Map<string, string>) => {
    for (const [id, diff] of [...output.nodes]) if (diff.status || diff.moved) {
      let parent = side.byId.get(id)?.parentId;
      while (parent) {
        update(output, parent, { containsChanges: true });
        const peer = matches.get(parent); if (peer) update(other, peer, { containsChanges: true });
        parent = side.byId.get(parent)?.parentId;
      }
    }
  };
  ancestors(a, result.original, result.proposed, forward); ancestors(b, result.proposed, result.original, reverse);

  // Text without a structural label still participates in review. Unique unchanged
  // lines anchor ordered gaps; equal repeated blocks remain unchanged.
  const loose = (side: typeof a) => {
    const occupied = new Set(side.nodes.map(n => n.line));
    return side.lines.flatMap((text, i) => !occupied.has(i + 1) && /[^\s|+`\\/-]/.test(text) ? [{ text, line: i + 1 }] : []);
  };
  const oldText = loose(a), newText = loose(b);
  const lineMatches = new Map<number, number>();
  for (const [oldId, newId] of forward) lineMatches.set(a.byId.get(oldId)!.line, b.byId.get(newId)!.line);
  const lineDiff = (left: typeof oldText, right: typeof newText) => {
    let start = 0, endA = left.length, endB = right.length;
    while (start < endA && start < endB && left[start].text === right[start].text) {
      lineMatches.set(left[start].line, right[start].line); start++;
    }
    while (endA > start && endB > start && left[endA - 1].text === right[endB - 1].text) { endA--; endB--; lineMatches.set(left[endA].line, right[endB].line); }
    const l = left.slice(start, endA), r = right.slice(start, endB);
    const oldPositions = new Map<string, number[]>(), newPositions = new Map<string, number[]>();
    l.forEach((n, i) => oldPositions.set(n.text, [...(oldPositions.get(n.text) ?? []), i]));
    r.forEach((n, i) => newPositions.set(n.text, [...(newPositions.get(n.text) ?? []), i]));
    const anchors = l.flatMap((n, i) => oldPositions.get(n.text)?.length === 1 && newPositions.get(n.text)?.length === 1 ? [{ i, j: newPositions.get(n.text)![0] }] : []);
    const stable = orderedIndices(anchors.map(n => n.j)), ordered = anchors.filter((_, i) => stable.has(i));
    if (ordered.length) {
      let i = 0, j = 0;
      for (const n of ordered) { lineMatches.set(l[n.i].line, r[n.j].line); lineDiff(l.slice(i, n.i), r.slice(j, n.j)); i = n.i + 1; j = n.j + 1; }
      lineDiff(l.slice(i), r.slice(j)); return;
    }
    const modified = l.length === 1 && r.length === 1;
    if (modified) lineMatches.set(l[0].line, r[0].line);
    if (modified) result.modifications.push({ original: { sourceLine: l[0].line, text: l[0].text },
      proposed: { sourceLine: r[0].line, text: r[0].text } });
    for (const n of l) result.original.lines.set(n.line, modified ? 'modified' : 'removed');
    for (const n of r) result.proposed.lines.set(n.line, modified ? 'modified' : 'added');
    result.counts.modified += Number(modified);
    if (!modified) { result.counts.removed += l.length; result.counts.added += r.length; }
  };
  lineDiff(oldText, newText);
  const foldedText = (side: typeof a, output: DiagramDiffSide, other: DiagramDiffSide, matches: Map<string, string>) => {
    for (const n of side.nodes) if ([...output.lines.keys()].some(line => n.foldRanges.some(range => line >= range.startLine && line <= range.endLine))) {
      update(output, n.id, { containsChanges: true });
      const peer = matches.get(n.id); if (peer) update(other, peer, { containsChanges: true });
    }
  };
  foldedText(a, result.original, result.proposed, forward); foldedText(b, result.proposed, result.original, reverse);
  // Place deleted text near surviving context. A surviving ancestor bounds the
  // search so a deleted final child stays inside its branch, even after a move.
  const rows = new Map<number, typeof a.nodes>();
  for (const node of a.nodes) rows.set(node.line, [...(rows.get(node.line) ?? []), node]);
  const anchors = [...lineMatches].sort(([left], [right]) => left - right);
  for (let line = 1; line <= a.lines.length; line++) {
    const nodes = rows.get(line) ?? [];
    const removed = nodes.filter(node => result.original.nodes.get(node.id)?.status === 'removed');
    if (!removed.length && result.original.lines.get(line) !== 'removed') continue;
    // For multi-column diagrams, do not repeat surviving labels on the ghost row.
    const chars = a.lines[line - 1].split('');
    for (const node of nodes) if (!removed.includes(node)) chars.fill(' ', node.startColumn - 1, node.endColumn);
    const containing = a.nodes.filter(node => node.foldRanges.some(range => line >= range.startLine && line <= range.endLine)
      && node.line !== line && forward.has(node.id));
    const ancestorIds = containing.map(node => forward.get(node.id)!);
    const parent = containing.sort((left, right) => right.line - left.line)[0];
    const parentEnd = parent ? Math.max(parent.line, ...parent.foldRanges.map(range => range.endLine)) : a.lines.length;
    const next = anchors.find(([oldLine]) => oldLine > line && oldLine <= parentEnd);
    const proposedParent = parent && b.byId.get(forward.get(parent.id)!);
    const previous = anchors.filter(([oldLine]) => oldLine < line).at(-1);
    const beforeLine = next?.[1] ?? (proposedParent
      ? Math.max(proposedParent.line, ...proposedParent.foldRanges.map(range => range.endLine)) + 1
      : previous ? previous[1] + 1 : b.lines.length + 1);
    const text = chars.join('').trimEnd();
    const spans = removed.length ? removed.map(node => ({ start: node.startColumn - 1, end: node.endColumn, contentNodeId: node.id }))
      : [{ start: text.length - text.trimStart().length, end: text.length }];
    result.removals.push({ text, beforeLine, ancestorIds, spans });
  }
  return result;
}
