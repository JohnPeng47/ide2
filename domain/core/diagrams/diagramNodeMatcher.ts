import type { DiagramContentNode } from './diagramContent';
import { orderedIndices } from './orderedIndices';

type Node = DiagramContentNode;
type Key = string | number;

/** Recovery work is bounded per sibling gap; exact anchors have no such cutoff. */
export const MAX_LABEL_ALIGNMENT_NODES = 64;
export const MAX_LABEL_ALIGNMENT_CELLS = 4096;

function group(nodes: readonly Node[], key: (node: Node) => Key): Map<Key, Node[]> {
  const groups = new Map<Key, Node[]>();
  for (const node of nodes) {
    const k = key(node), bucket = groups.get(k);
    if (bucket) bucket.push(node); else groups.set(k, [node]);
  }
  return groups;
}

/** Source order is explicit; object insertion order and revision IDs are irrelevant. */
function index(input: readonly Node[], shapes: Map<string, number>) {
  const nodes = [...input].sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const roots = nodes.filter(node => !node.parentId || !byId.has(node.parentId));
  const children = new Map(nodes.map(node => [node.id, node.childIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])]));
  const preorder: Node[] = [], postorder: Node[] = [];
  const start = new Map<string, number>(), end = new Map<string, number>(), signature = new Map<string, number>();
  const visit = (node: Node) => {
    start.set(node.id, preorder.length); preorder.push(node);
    const childNodes = children.get(node.id)!;
    childNodes.forEach(visit);
    end.set(node.id, preorder.length); postorder.push(node);
    const key = JSON.stringify([node.label, childNodes.map(child => signature.get(child.id))]);
    if (!shapes.has(key)) shapes.set(key, shapes.size);
    signature.set(node.id, shapes.get(key)!);
  };
  roots.forEach(visit);
  const descendants = (node: Node) => end.get(node.id)! - start.get(node.id)! - 1;
  return { nodes, byId, roots, children, preorder, postorder, start, end, signature, descendants };
}

type Label = { words: Set<string>; bigrams: Set<string>; normalized: string };
function labelFeatures(text: string): Label {
  const normalized = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const compact = normalized.replace(/ /g, '');
  return { normalized, words: new Set(normalized.split(' ').filter(word => word.length >= 3)),
    bigrams: new Set(Array.from({ length: Math.max(0, compact.length - 1) }, (_, i) => compact.slice(i, i + 2))) };
}

function labelSimilarity(a: Label, b: Label): number {
  if (a.normalized && a.normalized === b.normalized) return 1;
  let commonWords = 0, commonBigrams = 0;
  for (const word of a.words) if (b.words.has(word)) commonWords++;
  // Shared punctuation, a tiny suffix (e.g. Id), or edit position is not identity.
  if (!commonWords) return 0;
  for (const gram of a.bigrams) if (b.bigrams.has(gram)) commonBigrams++;
  return 0.5 * (2 * commonWords / (a.words.size + b.words.size))
    + 0.5 * (2 * commonBigrams / Math.max(1, a.bigrams.size + b.bigrams.size));
}

/**
 * Rendering-only, one-to-one correspondence over already parsed nodes. Independently
 * implements the staged exact-anchor / bottom-up idea evaluated in
 * docs/research/gumtree-change-session-diff.md; no upstream source is copied.
 * Inferred matches must never be used to rebase real anchors or patch provenance.
 */
export function matchDiagramNodes(before: readonly Node[], after: readonly Node[], origins: Readonly<Record<string, string>> = {},
  correspondence: Readonly<Record<string, string>> = {}) {
  const shapes = new Map<string, number>(), a = index(before, shapes), b = index(after, shapes);
  const forward = new Map<string, string>(), reverse = new Map<string, string>();
  const compatible = (old: Node, next: Node) => (!forward.has(old.id) || forward.get(old.id) === next.id)
    && (!reverse.has(next.id) || reverse.get(next.id) === old.id);
  const pair = (old: Node, next: Node) => {
    if (!compatible(old, next)) return;
    forward.set(old.id, next.id); reverse.set(next.id, old.id);
  };
  const exactTree = (old: Node, next: Node) => {
    if (a.signature.get(old.id) !== b.signature.get(next.id)) return;
    const pairs: [Node, Node][] = [];
    const collect = (left: Node, right: Node): boolean => {
      if (!compatible(left, right)) return false;
      pairs.push([left, right]);
      return a.children.get(left.id)!.every((child, i) => collect(child, b.children.get(right.id)![i]));
    };
    // Check the whole subtree before writing anything: seeds cannot be overwritten.
    if (collect(old, next)) for (const [left, right] of pairs) pair(left, right);
  };
  const unique = (left: readonly Node[], right: readonly Node[], leftKey: (node: Node) => Key,
    rightKey = leftKey, accept = pair) => {
    const l = group(left, leftKey), r = group(right, rightKey);
    for (const [key, nodes] of l) if (nodes.length === 1 && r.get(key)?.length === 1) accept(nodes[0], r.get(key)![0]);
  };

  // Proven logical identities can establish continuity even when labels change.
  const claims = new Map<string, number>();
  for (const next of b.nodes) if (Object.hasOwn(correspondence, next.id)) {
    const oldId = correspondence[next.id]; claims.set(oldId, (claims.get(oldId) ?? 0) + 1);
  }
  for (const next of b.nodes) {
    const oldId = correspondence[next.id], old = a.byId.get(oldId);
    if (old && claims.get(oldId) === 1) pair(old, next);
  }

  // Invalid/conflicting hints provide no evidence; do not select a survivor by
  // object iteration order when two proposed nodes claim the same old occurrence.
  const hints = b.nodes.flatMap(next => {
    const old = Object.hasOwn(origins, next.id) ? a.byId.get(origins[next.id]) : undefined;
    return old?.label === next.label ? [{ old, next }] : [];
  });
  const hintCounts = new Map<string, number>();
  hints.forEach(({ old }) => hintCounts.set(old.id, (hintCounts.get(old.id) ?? 0) + 1));
  for (const { old, next } of hints) if (hintCounts.get(old.id) === 1) pair(old, next);

  // Preserve exact labels (including leaves and visible roots) before inferring
  // containers from descendant overlap. Match complete exact subtrees atomically.
  unique(a.nodes, b.nodes, node => node.label);
  unique([...a.nodes].sort((x, y) => a.descendants(y) - a.descendants(x)), b.nodes,
    node => a.signature.get(node.id)!, node => b.signature.get(node.id)!, exactTree);

  const contexts = (match: (left: Node[], right: Node[]) => void) => {
    match(a.roots, b.roots);
    for (const [old, next] of forward) match(a.children.get(old)!, b.children.get(next)!);
  };
  const localExact = () => contexts((left, right) => {
    unique(left, right, node => node.label);
    unique(left, right, node => a.signature.get(node.id)!, node => b.signature.get(node.id)!, exactTree);
    const l = group(left, node => a.signature.get(node.id)!), r = group(right, node => b.signature.get(node.id)!);
    for (const [key, nodes] of l) {
      const peers = r.get(key);
      // Provenance may already distinguish occurrences. Only fill gaps whose
      // whole positional pairing agrees with it; unequal multiplicities stay open.
      if (nodes.length > 1 && nodes.length === peers?.length && nodes.every((node, i) => compatible(node, peers[i]))) {
        nodes.forEach((node, i) => exactTree(node, peers[i]));
      }
    }
  });
  const labels = new Map([...a.nodes, ...b.nodes].map(node => [node, labelFeatures(node.label)]));
  const similarities = new Map<Node, Map<Node, number>>();
  const similarity = (old: Node, next: Node) => {
    let row = similarities.get(old);
    if (!row) { row = new Map(); similarities.set(old, row); }
    const cached = row.get(next);
    if (cached !== undefined) return cached;
    const value = labelSimilarity(labels.get(old)!, labels.get(next)!);
    row.set(next, value); return value;
  };

  const bottomUp = () => {
    type Candidate = { old: Node; next: Node; score: number };
    const candidates: Candidate[] = [];
    // Aggregate once per subtree instead of revisiting every mapped descendant's
    // full ancestor chain for every old ancestor (particularly costly in chains).
    const overlaps = new Map<string, Map<string, number>>();
    for (const old of a.postorder) {
      const overlap = new Map<string, number>();
      for (const child of a.children.get(old.id)!) {
        for (const [id, common] of overlaps.get(child.id)!) overlap.set(id, (overlap.get(id) ?? 0) + common);
        let parent = b.byId.get(forward.get(child.id) ?? '')?.parentId;
        while (parent && b.byId.has(parent)) {
          if (!reverse.has(parent)) overlap.set(parent, (overlap.get(parent) ?? 0) + 1);
          parent = b.byId.get(parent)!.parentId;
        }
      }
      overlaps.set(old.id, overlap);
      const oldSize = a.descendants(old);
      if (forward.has(old.id) || !oldSize) continue;
      for (const [id, common] of overlap) {
        const next = b.byId.get(id)!, newSize = b.descendants(next);
        const coverage = common / Math.max(oldSize, newSize);
        // Generic ASCII labels need stronger evidence than the upstream dynamic
        // threshold alone: at least half the larger subtree must correspond.
        if (coverage < Math.max(0.5, 1 / (1 + Math.log(oldSize + newSize)))) continue;
        const oldChildren = a.children.get(old.id)!, nextChildren = b.children.get(id)!;
        const nextIds = new Set(nextChildren.map(node => node.id));
        const direct = oldChildren.filter(node => nextIds.has(forward.get(node.id) ?? '')).length
          / Math.max(oldChildren.length, nextChildren.length);
        const sameParent = old.parentId ? forward.has(old.parentId) && forward.get(old.parentId) === next.parentId : !next.parentId;
        candidates.push({ old, next, score: coverage + 0.5 * direct + 0.25 * similarity(old, next) + (sameParent ? 0.1 : 0) });
      }
    }
    const byOld = new Map<string, Candidate[]>(), byNext = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      for (const [map, key] of [[byOld, candidate.old.id], [byNext, candidate.next.id]] as const) {
        const bucket = map.get(key); if (bucket) bucket.push(candidate); else map.set(key, [candidate]);
      }
    }
    const winner = (bucket: Candidate[]) => {
      bucket.sort((x, y) => y.score - x.score);
      return bucket.length === 1 || bucket[0].score - bucket[1].score > 0.1 ? bucket[0] : undefined;
    };
    const nextWinners = new Map([...byNext].map(([id, bucket]) => [id, winner(bucket)]));
    for (const bucket of byOld.values()) {
      const best = winner(bucket);
      if (best && nextWinners.get(best.next.id) === best) pair(best.old, best.next);
    }
  };

  const replacements = () => contexts((left, right) => {
    const positions = new Map(right.map((node, i) => [node.id, i]));
    const anchors = left.flatMap((node, i) => {
      const j = positions.get(forward.get(node.id) ?? ''); return j === undefined ? [] : [{ i, j }];
    });
    const stable = orderedIndices(anchors.map(anchor => anchor.j));
    const boundaries = [{ i: -1, j: -1 }, ...anchors.filter((_, i) => stable.has(i)), { i: left.length, j: right.length }];
    const oldLabels = group(left, node => node.label), newLabels = group(right, node => node.label);
    const repeated = (label: string) => (oldLabels.get(label)?.length ?? 0) > 1 || (newLabels.get(label)?.length ?? 0) > 1;
    const admissible = (old: Node, next: Node) => {
      if (repeated(old.label) || repeated(next.label)) return false;
      const l = a.children.get(old.id)!, r = b.children.get(next.id)!;
      return !l.length && !r.length || l.some(child => r.some(peer => forward.get(child.id) === peer.id));
    };
    for (let k = 1; k < boundaries.length; k++) {
      const l = left.slice(boundaries[k - 1].i + 1, boundaries[k].i).filter(node => !forward.has(node.id));
      const r = right.slice(boundaries[k - 1].j + 1, boundaries[k].j).filter(node => !reverse.has(node.id));
      if (l.length === 1 && r.length === 1) {
        if (admissible(l[0], r[0])) pair(l[0], r[0]);
        continue;
      }
      if (!l.length || !r.length || l.length > MAX_LABEL_ALIGNMENT_NODES || r.length > MAX_LABEL_ALIGNMENT_NODES
        || l.length * r.length > MAX_LABEL_ALIGNMENT_CELLS) continue;
      const scores = l.map(old => r.map(next => admissible(old, next) ? similarity(old, next) : 0));
      // Both sides need a clear best candidate. This prevents repeated/similar
      // fields from acquiring identity merely because sequence order breaks a tie.
      const allowed = scores.map((row, i) => row.map((score, j) => score >= 0.65
        && row.every((other, x) => x === j || score - other > 0.1)
        && scores.every((other, x) => x === i || score - other[j] > 0.1)));
      const dp = Array.from({ length: l.length + 1 }, () => new Float64Array(r.length + 1));
      for (let i = l.length - 1; i >= 0; i--) for (let j = r.length - 1; j >= 0; j--) {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], allowed[i][j] ? scores[i][j] + dp[i + 1][j + 1] : 0);
      }
      let i = 0, j = 0;
      while (i < l.length && j < r.length) {
        if (allowed[i][j] && dp[i][j] === scores[i][j] + dp[i + 1][j + 1]) { pair(l[i++], r[j++]); }
        else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
        else j++;
      }
    }
  });

  let previousSize: number;
  do {
    previousSize = forward.size;
    localExact(); bottomUp(); localExact(); replacements();
  } while (forward.size !== previousSize);
  return { forward, reverse };
}
