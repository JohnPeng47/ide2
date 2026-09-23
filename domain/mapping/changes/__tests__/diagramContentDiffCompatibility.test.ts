import { expect, it } from 'vitest';
import { buildDiagramContent, type DiagramContent } from '../../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { createDiagram } from '../../../core/diagrams/diagram';
import { patchDiagram } from '../../../core/diagrams/patchDiagram';
import { diffDiagramContent } from '../diagramContentDiff';

const tree = (text: string, revision = 'new', version: 'ascii-tree-1' | 'ascii-tree-2' = 'ascii-tree-2') => buildDiagramContent(text, revision, 'tree', version);
const node = (content: DiagramContent, label: string) => diagramContentNodes(content).find(node => node.label === label)!;
const topology = (content: DiagramContent) => {
  const nodes = diagramContentNodes(content), byId = new Map(nodes.map(node => [node.id, node]));
  return nodes.map(node => [node.label, byId.get(node.parentId ?? '')?.label]);
};

it('handles nested partial wrappers and their removal without moving deeper descendants', () => {
  const a = tree('Root\n|-- A\n|   `-- Leaf\n`-- Keep', 'old');
  const b = tree('Root\n|-- Outer\n|   `-- Inner\n|       `-- A\n|           `-- Leaf\n`-- Keep');
  expect(diffDiagramContent(a, b).counts).toEqual({ added: 2, removed: 0, modified: 0, moved: 1 });
  expect(diffDiagramContent(b, a).counts).toEqual({ added: 0, removed: 2, modified: 0, moved: 1 });
  expect(diffDiagramContent(a, b).proposed.nodes.get(node(b, 'Leaf').id)).toBeUndefined();
});

it('recovers a moved and renamed container, then an edited child in its new context', () => {
  const a = tree('Root\n|-- A\n|   `-- Before\n|       |-- Anchor\n|       `-- Old field\n`-- B', 'old');
  const b = tree('Root\n|-- A\n`-- B\n    `-- After\n        |-- Anchor\n        `-- New field');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 2, moved: 1 });
  expect(diff.proposed.nodes.get(node(b, 'After').id)).toEqual({ status: 'modified', moved: true, containsChanges: true });
  expect(diff.proposed.nodes.get(node(b, 'Anchor').id)).toBeUndefined();
});

it('detects reordering with an unrelated insertion', () => {
  const a = tree('Root\n|-- A\n|-- B\n`-- C', 'old'), b = tree('Root\n|-- New\n|-- C\n|-- A\n`-- B');
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 1, removed: 0, modified: 0, moved: 1 });
  expect(diff.proposed.nodes.get(node(b, 'C').id)).toEqual({ moved: true });
});

it('compares forests without leaking parents across blank lines', () => {
  const a = tree('First\n`-- Moving\n\nSecond\n`-- Keep', 'old');
  const b = tree('First\n`-- Added\n\nSecond\n|-- Keep\n`-- Moving');
  expect(topology(a)).toEqual([['First', undefined], ['Moving', 'First'], ['Second', undefined], ['Keep', 'Second']]);
  expect(topology(b)).toEqual([['First', undefined], ['Added', 'First'], ['Second', undefined], ['Keep', 'Second'], ['Moving', 'Second']]);
  expect(diffDiagramContent(a, b).counts).toEqual({ added: 1, removed: 0, modified: 0, moved: 1 });
});

it.each(['+--', '`--', '\\--', '|--'])('preserves v2 topology across the %s branch marker', marker => {
  const a = tree('Root\n`-- Leaf', 'old'), b = tree(`Root\n${marker} Leaf`);
  expect(topology(b)).toEqual([['Root', undefined], ['Leaf', 'Root']]);
  expect(diffDiagramContent(a, b).counts).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 });
});

it('retains legacy grammar and does not turn parser metadata changes into a visual diff', () => {
  const ascii = 'Root\n|-- A\n`-- B', a = tree(ascii, 'old', 'ascii-tree-1'), b = tree(ascii);
  expect(topology(a)).toEqual([['B', undefined]]);
  expect(topology(b)).toEqual([['Root', undefined], ['A', 'Root'], ['B', 'Root']]);
  const snapshot = structuredClone(a);
  expect(diffDiagramContent(a, b).counts).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 });
  expect(a).toEqual(snapshot);
  expect(diffDiagramContent(tree('Root\n+-- Old\n`-- Keep', 'old', 'ascii-tree-1'),
    tree('Root\n+-- New\n`-- Keep', 'new', 'ascii-tree-1')).counts.modified).toBe(1);
});

it('retains headed-branch and indentation-only parsing contracts', () => {
  const headed = tree('Root\n+--> Leaf');
  expect(topology(headed)).toEqual([['Leaf', undefined]]);
  const a = tree('Root\n  Old child', 'old'), b = tree('Root\n  New child');
  expect(topology(a)).toEqual([]);
  expect([...diffDiagramContent(a, b).proposed.lines]).toEqual([[2, 'modified']]);
});

it('ignores branch spacing and connector-only lines without fabricating moves', () => {
  const a = tree('Root\n|-- A\n`-- B', 'old'), b = tree('\nRoot\n|\n|--   A\n|\n`-- B\n');
  expect(topology(b)).toEqual(topology(a));
  expect(diffDiagramContent(a, b).counts).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 });
});

it('keeps internal tree-label spacing as text but ignores trimmed trailing whitespace', () => {
  const a = tree('Root\n|-- placement automatic\n`-- Keep', 'old');
  expect(diffDiagramContent(a, tree('Root\n|-- placement    automatic\n`-- Keep')).counts.modified).toBe(1);
  expect(diffDiagramContent(a, tree('Root\n|-- placement automatic   \n`-- Keep ')).counts.modified).toBe(0);
});

it('addresses independent mixed-mode columns and repeated occurrences on the same row', () => {
  const a = buildDiagramContent('Left    Right\n|-- Same    |-- Same\n`-- EndL    `-- EndR', 'old');
  const b = buildDiagramContent('Left    Right\n|-- Same    |-- Edit\n`-- EndL    `-- EndR', 'new');
  const repeated = diagramContentNodes(a).filter(node => node.label === 'Same');
  expect(repeated).toHaveLength(2);
  expect(repeated[0].line).toBe(repeated[1].line);
  expect(repeated[0].startColumn).not.toBe(repeated[1].startColumn);
  const diff = diffDiagramContent(a, b);
  expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 1, moved: 0 });
  expect(diff.original.nodes.get(repeated[0].id)).toBeUndefined();
  expect(diff.original.nodes.get(repeated[1].id)?.status).toBe('modified');
  const edited = node(b, 'Edit');
  expect(b.ascii.split('\n')[edited.line - 1].slice(edited.startColumn - 1, edited.endColumn)).toBe('Edit');
});

it('keeps unmarked continuation text separate and visible in the raw-line diff', () => {
  const a = tree('Root\n|-- Ready /\n|   Applied\n`-- End', 'old');
  const b = tree('Root\n|-- Ready /\n|   Pending\n`-- End');
  expect(topology(a)).toEqual([['Root', undefined], ['Ready /', 'Root'], ['End', 'Root']]);
  const diff = diffDiagramContent(a, b);
  expect([...diff.proposed.lines]).toEqual([[3, 'modified']]);
  expect(diff.proposed.nodes.get(node(b, 'Root').id)).toEqual({ containsChanges: true });
});

it('falls back to raw lines for multiline mixed-mode prose and normalized quote coordinates', () => {
  const a = buildDiagramContent('First note\nSecond note', 'old'), b = buildDiagramContent('First note\nChanged note', 'new');
  expect([...diffDiagramContent(a, b).proposed.lines]).toEqual([[2, 'modified']]);
  const quotedA = tree('> Root\n> `-- Old', 'old'), quotedB = tree('> Root\n> `-- New');
  const diff = diffDiagramContent(quotedA, quotedB);
  expect(diff.proposed.nodes.size).toBe(0);
  expect([...diff.proposed.lines]).toEqual([[2, 'modified']]);
});

it.each(['call(a -> b) | literal ---', '[source -> target]', '{a | b}', '(unfinished -> text'])('preserves literal tree label %s', label => {
  const a = tree(`Root\n|-- ${label}\n\x60-- Old`, 'old'), b = tree(`Root\n|-- ${label}\n\x60-- New`);
  expect(node(a, label)?.label).toBe(label);
  expect(diffDiagramContent(a, b).proposed.nodes.get(node(b, label).id)).toBeUndefined();
});

it('keeps one-character and last-character label edits inside inclusive source bounds', () => {
  const a = tree('Root\n|-- X\n`-- field ending a', 'old'), b = tree('Root\n|-- Y\n`-- field ending b');
  // Both edits need enough evidence: the long field anchors recovery of the single-character gap.
  expect(diffDiagramContent(a, b).counts.modified).toBe(2);
  const character = node(b, 'Y');
  expect(character.startColumn).toBe(character.endColumn);
  expect(b.ascii.split('\n')[character.line - 1].slice(character.startColumn - 1, character.endColumn)).toBe('Y');
});

it('does not mutate content/provenance after a broad patch or depend on patch history for unique nodes', () => {
  const a = createDiagram({ id: 'test', revision: 0, ascii: 'Root\n|-- Before\n|   `-- Leaf\n`-- Keep', structureKind: 'tree' });
  const text = 'Root\n|-- Wrapper\n|   `-- After\n|       `-- Leaf\n`-- Keep';
  const patched = patchDiagram(a, 1, 4, text);
  const origins = Object.fromEntries([...patched.nodeIds].map(([old, next]) => [next, old]));
  const snapshot = structuredClone({ a, diagram: patched.diagram, origins });
  const diff = diffDiagramContent(a.content, patched.diagram.content, origins);
  expect(diff.counts).toEqual({ added: 1, removed: 0, modified: 1, moved: 1 });
  expect(diffDiagramContent(a.content, tree(text, 'independent-history')).counts).toEqual(diff.counts);
  expect({ a, diagram: patched.diagram, origins }).toEqual(snapshot);
  const reverted = patchDiagram(patched.diagram, 1, 5, a.content.ascii);
  expect(diffDiagramContent(a.content, reverted.diagram.content).counts).toEqual({ added: 0, removed: 0, modified: 0, moved: 0 });
});

it.each(['', '   ', 'Root\tChild', 'Root\r\nChild', 'Root\n\u2514-- Child', '\x1b[31mRed', 'x'.repeat(20001)])('preserves strict builder input validation (%#)', ascii => {
  expect(() => tree(ascii)).toThrow('printable ASCII');
});

it('normalizes patch newlines while retaining trailing blank lines and rejecting invalid ranges', () => {
  const original = createDiagram({ id: 'd', revision: 0, ascii: 'Root\n`-- Old', structureKind: 'tree' });
  const next = patchDiagram(original, 2, 2, '|-- New\r\n`-- Added\r').diagram.content;
  expect(next.ascii).toBe('Root\n|-- New\n`-- Added\n');
  expect(() => patchDiagram(original, 0, 1, 'X')).toThrow();
  expect(() => patchDiagram(original, 1, 3, 'X')).toThrow();
  expect(() => patchDiagram(original, 1, 2, '')).toThrow();
});
