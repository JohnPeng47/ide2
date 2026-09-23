import { describe, expect, it } from 'vitest';
import { buildDiagramContent, type DiagramContentNode } from '../../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { matchDiagramNodes, MAX_LABEL_ALIGNMENT_NODES } from '../diagramNodeMatcher';
import { diffDiagramContent } from '../diagramContentDiff';

type Tree = { label: string; children: Tree[] };
const t = (label: string, ...children: Tree[]): Tree => ({ label, children });
function content(root: Tree, revision = 'old') {
  const lines = [root.label];
  const expected: { label: string; parent?: string }[] = [{ label: root.label }];
  const visit = (node: Tree, prefix: string) => node.children.forEach((child, i) => {
    const last = i === node.children.length - 1;
    lines.push(prefix + (last ? '`-- ' : '|-- ') + child.label);
    expected.push({ label: child.label, parent: node.label });
    visit(child, prefix + (last ? '    ' : '|   '));
  });
  visit(root, '');
  const result = buildDiagramContent(lines.join('\n'), revision, 'tree');
  const nodes = diagramContentNodes(result), byId = new Map(nodes.map(node => [node.id, node]));
  // Do not accidentally test a topology that the application's parser doesn't produce.
  expect(nodes.map(node => ({ label: node.label, parent: node.parentId ? byId.get(node.parentId)!.label : undefined }))).toEqual(expected);
  return result;
}
const nodes = (root: Tree, revision: string) => diagramContentNodes(content(root, revision));
const byLabel = (values: readonly DiagramContentNode[], label: string) => values.find(node => node.label === label)!;
function matches(old: Tree, next: Tree) {
  const a = nodes(old, 'old'), b = nodes(next, 'new');
  const result = matchDiagramNodes(a, b);
  return { ...result, a, b, peer: (label: string) => b.find(node => node.id === result.forward.get(byLabel(a, label).id))?.label };
}

describe('exact anchors and conservative identity', () => {
  it('preserves the exact Root when a wrapper has the same descendants', () => {
    const result = matches(t('Root', t('Leaf')), t('Wrapper', t('Root', t('Leaf'))));
    expect(result.peer('Root')).toBe('Root');
    expect(result.forward.size).toBe(2);
  });

  it('preserves containers A/B rather than renaming them to explain a move', () => {
    const result = matches(t('Root', t('A', t('Moving', t('Leaf'))), t('B')),
      t('Root', t('A'), t('B', t('Moving', t('Leaf')))));
    expect(result.a.map(node => result.peer(node.label))).toEqual(result.a.map(node => node.label));
  });

  it('matches an entire exact subtree including repeated descendants', () => {
    const result = matches(t('Root', t('Group', t('Same'), t('Same')), t('Other')),
      t('Root', t('Other'), t('Wrapper', t('Group', t('Same'), t('Same')))));
    expect(result.forward.size).toBe(5);
    const oldSame = result.a.filter(node => node.label === 'Same'), newSame = result.b.filter(node => node.label === 'Same');
    expect(oldSame.map(node => result.forward.get(node.id))).toEqual(newSame.map(node => node.id));
  });

  it('does not partially map an exact subtree that conflicts with provenance', () => {
    const a = nodes(t('Root', t('Group', t('Same'), t('Same')), t('Keep')), 'old');
    const b = nodes(t('Root', t('Group', t('Same'), t('Same')), t('Added'), t('Keep')), 'new');
    const oldSame = a.filter(node => node.label === 'Same'), newSame = b.filter(node => node.label === 'Same');
    const result = matchDiagramNodes(a, b, { [newSame[1].id]: oldSame[0].id });
    expect(result.forward.get(oldSame[0].id)).toBe(newSame[1].id);
    expect(result.forward.has(oldSame[1].id)).toBe(false);
    expect(result.reverse.get(newSame[1].id)).toBe(oldSame[0].id);
  });

  it('leaves indistinguishable deletion unresolved, but accepts exact surviving provenance', () => {
    const a = nodes(t('Root', t('Same'), t('Same'), t('Keep')), 'old');
    const b = nodes(t('Root', t('Same'), t('Keep')), 'new');
    const same = a.filter(node => node.label === 'Same'), survivor = byLabel(b, 'Same');
    expect(matchDiagramNodes(a, b).reverse.has(survivor.id)).toBe(false);
    const result = matchDiagramNodes(a, b, { [survivor.id]: same[1].id });
    expect(result.reverse.get(survivor.id)).toBe(same[1].id);
    expect(result.forward.has(same[0].id)).toBe(false);
  });

  it('preserves a copied subtree in its established parent context', () => {
    const result = matches(t('Root', t('A', t('Copy', t('Leaf'))), t('B')),
      t('Root', t('A', t('Copy', t('Leaf'))), t('B', t('Copy', t('Leaf')))));
    const copy = result.b.find(node => node.id === result.forward.get(byLabel(result.a, 'Copy').id))!;
    expect(result.b.find(node => node.id === copy.parentId)?.label).toBe('A');
    expect(result.forward.size).toBe(result.a.length);
  });

  it('disambiguates repeated labels by distinct descendants after reordering', () => {
    const result = matches(t('Root', t('Same', t('Alpha')), t('Same', t('Beta'))),
      t('Root', t('Same', t('Beta')), t('Same', t('Alpha'))));
    for (const old of result.a.filter(node => node.label === 'Same')) {
      const next = result.b.find(node => node.id === result.forward.get(old.id))!;
      expect(result.forward.get(old.childIds[0])).toBe(next.childIds[0]);
    }
  });

  it('ignores stale, mismatched and conflicting hints without breaking bijection', () => {
    const a = nodes(t('Root', t('Same'), t('Same'), t('Keep')), 'old');
    const b = nodes(t('Root', t('Same'), t('Same'), t('Keep'), t('New')), 'new');
    const same = a.filter(node => node.label === 'Same'), peers = b.filter(node => node.label === 'Same');
    const hints = { stale: same[0].id, [peers[0].id]: same[0].id, [peers[1].id]: same[0].id,
      [byLabel(b, 'Keep').id]: 'missing', [byLabel(b, 'New').id]: byLabel(a, 'Root').id };
    const result = matchDiagramNodes(a, b, hints);
    expect(result.forward.get(same[0].id)).toBe(peers[0].id);
    expect(result.forward.get(same[1].id)).toBe(peers[1].id);
    expect(result.reverse.has(byLabel(b, 'New').id)).toBe(false);
    expect(new Set(result.forward.values()).size).toBe(result.forward.size);
  });
});

describe('renamed containers and edited siblings', () => {
  it('finds a renamed child rather than the new competing wrapper', () => {
    const result = matches(t('Root', t('Original parent', t('Leaf'))),
      t('Root', t('Wrapper', t('Renamed parent', t('Leaf')))));
    expect(result.peer('Original parent')).toBe('Renamed parent');
    expect(result.reverse.has(byLabel(result.b, 'Wrapper').id)).toBe(false);
  });

  it('recovers nested renamed parents from the bottom up', () => {
    const result = matches(t('Root', t('Outer old', t('Inner old', t('Leaf')))),
      t('Root', t('Wrapper', t('Outer new', t('Inner new', t('Leaf'))))));
    expect(result.peer('Outer old')).toBe('Outer new');
    expect(result.peer('Inner old')).toBe('Inner new');
  });

  it('keeps equally supported split containers unresolved', () => {
    const result = matches(t('Root', t('Original', t('One'), t('Two')), t('Keep')),
      t('Root', t('First', t('One')), t('Second', t('Two')), t('Keep')));
    expect(result.peer('Original')).toBeUndefined();
    expect(result.peer('One')).toBe('One');
    expect(result.peer('Two')).toBe('Two');
  });

  it('keeps equally supported merge containers unresolved in either direction', () => {
    const a = t('Root', t('First', t('One')), t('Second', t('Two')), t('Keep'));
    const b = t('Root', t('Merged', t('One'), t('Two')), t('Keep'));
    expect(matches(a, b).peer('First')).toBeUndefined();
    expect(matches(a, b).peer('Second')).toBeUndefined();
    expect(matches(b, a).peer('Merged')).toBeUndefined();
  });

  it('uses parent context for repeated leaves without stealing the other branch', () => {
    const result = matches(t('Root', t('A', t('Same')), t('B', t('Same'))),
      t('Root', t('A', t('Edited')), t('B', t('Same'))));
    const old = result.a.filter(node => node.label === 'Same');
    expect(result.forward.get(old[0].id)).toBe(byLabel(result.b, 'Edited').id);
    expect(result.forward.get(old[1].id)).toBe(byLabel(result.b, 'Same').id);
  });

  it('aligns distinct edited fields around an inserted sibling', () => {
    const result = matches(t('Root', t('placement: automatic | manual'), t('sizing: content | fixed')),
      t('Root', t('placement = automatic / manual'), t('Description'), t('sizing = content / fixed')));
    expect(result.peer('placement: automatic | manual')).toBe('placement = automatic / manual');
    expect(result.peer('sizing: content | fixed')).toBe('sizing = content / fixed');
    expect(result.reverse.has(byLabel(result.b, 'Description').id)).toBe(false);
  });

  it('does not align tied, generic fields just because their order agrees', () => {
    const result = matches(t('Root', t('field old a'), t('field old b')),
      t('Root', t('field new c'), t('field new d')));
    expect(result.forward.size).toBe(1);
  });

  it('does not require a node to stay a leaf or a container', () => {
    const a = content(t('Root', t('Branch'), t('Keep'))), b = content(t('Root', t('Branch', t('New')), t('Keep')), 'new');
    expect(diffDiagramContent(a, b).counts).toEqual({ added: 1, removed: 0, modified: 0, moved: 0 });
    expect(diffDiagramContent(b, a).counts).toEqual({ added: 0, removed: 1, modified: 0, moved: 0 });
  });

  it.each(['FIELD Name', 'field  name', 'field: name'])('retains raw changes after normalizing %s for correspondence', label => {
    const a = content(t('Root', t('field name'), t('sizing content fixed')));
    const b = content(t('Root', t(label), t('sizing: content | fixed')), 'new');
    expect(diffDiagramContent(a, b).counts.modified).toBe(2);
  });
});

describe('invariants and bounded recovery', () => {
  it.each([63, 64, 65])('bounds label alignment at %i unmatched nodes while preserving anchors', size => {
    // Distinct long alphabetic keys provide a clear textual winner for every field.
    const key = (i: number) => String.fromCharCode(97 + Math.floor(i / 26)).repeat(6) + String.fromCharCode(97 + i % 26).repeat(6);
    const a = content(t('Root', ...Array.from({ length: size }, (_, i) => t(`${key(i)}: value`)), t('Keep')));
    const b = content(t('Root', ...Array.from({ length: size }, (_, i) => t(`${key(i)} = value`)), t('Keep')), 'new');
    const diff = diffDiagramContent(a, b);
    expect(diff.counts).toEqual(size <= MAX_LABEL_ALIGNMENT_NODES
      ? { added: 0, removed: 0, modified: size, moved: 0 }
      : { added: size, removed: size, modified: 0, moved: 0 });
  });

  it('keeps labels resembling object properties ordinary', () => {
    const result = matches(t('Root', t('__proto__'), t('constructor'), t('prototype')),
      t('Root', t('Added'), t('__proto__'), t('constructor'), t('prototype')));
    expect(result.forward.size).toBe(4);
  });

  it('is independent of storage order and does not mutate nodes or provenance', () => {
    const a = nodes(t('Root', t('Branch old', t('Leaf')), t('Same'), t('Same')), 'old');
    const b = nodes(t('Root', t('Wrapper', t('Branch new', t('Leaf'))), t('Same'), t('Same')), 'new');
    const before = structuredClone({ a, b });
    const origins = Object.freeze({ [byLabel(b, 'Leaf').id]: byLabel(a, 'Leaf').id });
    const freeze = (value: unknown) => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(a); freeze(b);
    const first = matchDiagramNodes(a, b, origins), second = matchDiagramNodes([...a].reverse(), [...b].reverse(), origins);
    expect([...second.forward].sort()).toEqual([...first.forward].sort());
    expect({ a, b }).toEqual(before);
    for (const [old, next] of first.forward) expect(first.reverse.get(next)).toBe(old);
    expect(Object.keys(origins)).toHaveLength(1);
  });

  it('recovers generated unambiguous wrapper/move/rename combinations across revision IDs', () => {
    let state = 17;
    const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let trial = 0; trial < 40; trial++) {
      const width = 2 + Math.floor(random() * 5), moving = Math.floor(random() * width);
      const branches = Array.from({ length: width }, (_, i) => t(`Branch ${i}`, t(`Leaf ${i}`)));
      const old = t('Root', t('A', ...branches), t('B'));
      const moved = t(`Branch ${moving} renamed`, t(`Leaf ${moving}`));
      const next = t('Root', t('A', ...branches.filter((_, i) => i !== moving)), t('B', t('Wrapper', moved)));
      const a = content(old, `old-${trial}`), b = content(next, `new-${trial}`);
      const oldNodes = diagramContentNodes(a), nextNodes = diagramContentNodes(b), result = matchDiagramNodes(oldNodes, nextNodes);
      expect(result.forward.size).toBe(oldNodes.length);
      expect(new Set(result.forward.values()).size).toBe(result.forward.size);
      for (const node of oldNodes) {
        const peer = nextNodes.find(nextNode => nextNode.id === result.forward.get(node.id))!;
        expect(peer.label).toBe(node.label === `Branch ${moving}` ? moved.label : node.label);
        expect(result.reverse.get(peer.id)).toBe(node.id);
        expect(b.ascii.split('\n')[peer.line - 1].slice(peer.startColumn - 1, peer.endColumn)).toBe(peer.label);
      }
      expect(diffDiagramContent(a, b).counts).toEqual({ added: 1, removed: 0, modified: 1, moved: 1 });
      expect(diffDiagramContent(b, a).counts).toEqual({ added: 0, removed: 1, modified: 1, moved: 1 });
    }
  });
});
