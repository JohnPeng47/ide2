import type { DiagramContent, DiagramContentNode } from '../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';

export type DiffStatus = 'added' | 'removed' | 'modified';
export interface NodeDiff { status?: DiffStatus; moved?: boolean; containsChanges?: boolean }
export interface DiagramDiffSide {
  nodes: Map<string, NodeDiff>;
  /** Unparsed text only, keyed by its original 1-based source line. */
  lines: Map<number, DiffStatus>;
}
export interface DiagramContentDiff {
  original: DiagramDiffSide; proposed: DiagramDiffSide;
  counts: { added: number; removed: number; modified: number; moved: number };
}

/** Indices in one longest increasing subsequence; insertions do not imply moves. */
function orderedIndices(values: number[]): Set<number> {
  const tails: number[] = [], previous: number[] = [];
  values.forEach((value, index) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[tails[mid]] < value) lo = mid + 1; else hi = mid; }
    previous[index] = lo ? tails[lo - 1] : -1; tails[lo] = index;
  });
  const result = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) result.add(index);
  return result;
}

/** Rendering-only correspondence. Never use these heuristic matches for edge anchors. */
export function diffDiagramContent(before: DiagramContent | undefined, after: DiagramContent | undefined,
  origins: Readonly<Record<string, string>> = {}): DiagramContentDiff {
  const result: DiagramContentDiff = { original: { nodes: new Map(), lines: new Map() },
    proposed: { nodes: new Map(), lines: new Map() }, counts: { added: 0, removed: 0, modified: 0, moved: 0 } };
  if (before?.ascii === after?.ascii) return result;
  const index = (content?: DiagramContent) => {
    const lines = content?.ascii.split('\n') ?? [];
    const nodes = (content ? diagramContentNodes(content) : []).filter(n =>
      lines[n.line - 1]?.slice(n.startColumn - 1, n.endColumn) === n.label);
    return { lines, nodes, byId: new Map(nodes.map(n => [n.id, n])) };
  };
  const a = index(before), b = index(after);
  const forward = new Map<string, string>(), reverse = new Map<string, string>();
  const pair = (old: DiagramContentNode, next: DiagramContentNode) => {
    if (forward.has(old.id) || reverse.has(next.id)) return;
    forward.set(old.id, next.id); reverse.set(next.id, old.id);
  };
  for (const next of b.nodes) {
    const old = a.byId.get(origins[next.id]);
    if (old?.label === next.label) pair(old, next);
  }

  // Intern subtree shapes across both versions, without revision IDs or line numbers.
  const shapes = new Map<string, number>();
  const signatures = (side: typeof a) => {
    const ids = new Map<string, number>();
    const visit = (node: DiagramContentNode): number => {
      if (ids.has(node.id)) return ids.get(node.id)!;
      const key = JSON.stringify([node.label, node.childIds.flatMap(id => side.byId.has(id) ? [visit(side.byId.get(id)!)] : [])]);
      if (!shapes.has(key)) shapes.set(key, shapes.size);
      ids.set(node.id, shapes.get(key)!); return ids.get(node.id)!;
    };
    side.nodes.forEach(visit); return ids;
  };
  const sa = signatures(a), sb = signatures(b);
  const uniquePairs = (left: DiagramContentNode[], right: DiagramContentNode[],
    leftKey: (n: DiagramContentNode) => string | number, rightKey = leftKey) => {
    const group = (nodes: DiagramContentNode[], key: typeof leftKey) => {
      const buckets = new Map<string | number, DiagramContentNode[]>();
      for (const n of nodes) {
        const k = key(n), bucket = buckets.get(k);
        if (bucket) bucket.push(n); else buckets.set(k, [n]);
      }
      return buckets;
    };
    const old = group(left, leftKey), next = group(right, rightKey);
    for (const [key, nodes] of old) if (nodes.length === 1 && next.get(key)?.length === 1) pair(nodes[0], next.get(key)![0]);
  };
  uniquePairs(a.nodes, b.nodes, n => sa.get(n.id)!, n => sb.get(n.id)!);
  const children = (side: typeof a, parent?: string) => parent
    ? (side.byId.get(parent)?.childIds ?? []).flatMap(id => side.byId.has(id) ? [side.byId.get(id)!] : [])
    : side.nodes.filter(n => !n.parentId || !side.byId.has(n.parentId));
  const localMatches = () => {
    // Map iteration visits newly matched parents too, allowing nested matches in one pass.
    const match = (left: DiagramContentNode[], right: DiagramContentNode[]) => {
      uniquePairs(left, right, n => n.label);
      // Equal repeated subtrees under a matched parent correspond in sibling order.
      // Different multiplicities are ambiguous and deliberately remain unmatched.
      const group = (nodes: DiagramContentNode[], signatures: Map<string, number>) => {
        const groups = new Map<number, DiagramContentNode[]>();
        for (const node of nodes) {
          const shape = signatures.get(node.id)!, bucket = groups.get(shape);
          if (bucket) bucket.push(node); else groups.set(shape, [node]);
        }
        return groups;
      };
      const old = group(left, sa), next = group(right, sb);
      for (const [shape, l] of old) {
        const r = next.get(shape);
        if (l.length > 1 && l.length === r?.length) l.forEach((n, i) => pair(n, r[i]));
      }
    };
    match(children(a), children(b));
    for (const [old, next] of forward) match(children(a, old), children(b, next));
  };
  localMatches();
  // Unique labels can identify a reparented node with edited descendants.
  uniquePairs(a.nodes, b.nodes, n => n.label);
  localMatches();

  // A single replacement between ordered sibling anchors is a label edit. Repeated
  // labels or multi-node replacement gaps stay additions/removals when ambiguous.
  const replacements = (left: DiagramContentNode[], right: DiagramContentNode[]) => {
    const positions = new Map(right.map((n, i) => [n.id, i]));
    const anchors = left.flatMap((n, i) => {
      const j = positions.get(forward.get(n.id) ?? ''); return j === undefined ? [] : [{ i, j }];
    });
    const stable = orderedIndices(anchors.map(x => x.j));
    const boundaries = [{ i: -1, j: -1 }, ...anchors.filter((_, i) => stable.has(i)), { i: left.length, j: right.length }];
    for (let k = 1; k < boundaries.length; k++) {
      const l = left.slice(boundaries[k - 1].i + 1, boundaries[k].i).filter(n => !forward.has(n.id));
      const r = right.slice(boundaries[k - 1].j + 1, boundaries[k].j).filter(n => !reverse.has(n.id));
      if (l.length !== 1 || r.length !== 1) continue;
      if ([l[0].label, r[0].label].some(label => left.filter(n => n.label === label).length > 1 || right.filter(n => n.label === label).length > 1)) continue;
      const oldChildren = children(a, l[0].id), newChildren = children(b, r[0].id);
      if (oldChildren.length || newChildren.length) {
        if (!oldChildren.length || !newChildren.length || !oldChildren.some(n => newChildren.some(m => forward.get(n.id) === m.id))) continue;
      }
      pair(l[0], r[0]);
    }
  };
  replacements(children(a), children(b));
  for (const [old, next] of forward) {
    uniquePairs(children(a, old), children(b, next), n => n.label);
    replacements(children(a, old), children(b, next));
  }

  const update = (side: DiagramDiffSide, id: string, value: NodeDiff) => side.nodes.set(id, { ...side.nodes.get(id), ...value });
  for (const n of a.nodes) if (!forward.has(n.id)) { update(result.original, n.id, { status: 'removed' }); result.counts.removed++; }
  for (const n of b.nodes) if (!reverse.has(n.id)) { update(result.proposed, n.id, { status: 'added' }); result.counts.added++; }
  const moved = new Set<string>();
  for (const [oldId, nextId] of forward) {
    const old = a.byId.get(oldId)!, next = b.byId.get(nextId)!;
    if (old.label !== next.label) {
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
  const lineDiff = (left: typeof oldText, right: typeof newText) => {
    let start = 0, endA = left.length, endB = right.length;
    while (start < endA && start < endB && left[start].text === right[start].text) start++;
    while (endA > start && endB > start && left[endA - 1].text === right[endB - 1].text) { endA--; endB--; }
    const l = left.slice(start, endA), r = right.slice(start, endB);
    const oldPositions = new Map<string, number[]>(), newPositions = new Map<string, number[]>();
    l.forEach((n, i) => oldPositions.set(n.text, [...(oldPositions.get(n.text) ?? []), i]));
    r.forEach((n, i) => newPositions.set(n.text, [...(newPositions.get(n.text) ?? []), i]));
    const anchors = l.flatMap((n, i) => oldPositions.get(n.text)?.length === 1 && newPositions.get(n.text)?.length === 1 ? [{ i, j: newPositions.get(n.text)![0] }] : []);
    const stable = orderedIndices(anchors.map(n => n.j)), ordered = anchors.filter((_, i) => stable.has(i));
    if (ordered.length) {
      let i = 0, j = 0;
      for (const n of ordered) { lineDiff(l.slice(i, n.i), r.slice(j, n.j)); i = n.i + 1; j = n.j + 1; }
      lineDiff(l.slice(i), r.slice(j)); return;
    }
    const modified = l.length === 1 && r.length === 1;
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
  return result;
}
