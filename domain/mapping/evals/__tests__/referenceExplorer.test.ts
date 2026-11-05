import { describe, expect, it } from 'vitest';
import type { CompareCandidate } from '../../compare/comparePageSession';
import { referenceExcerpt, renderReference, renderReferences, type EvalReference, type EvalReferenceGroup } from '../evalReference';
import { diagramFolders, diagramLeafKey, referenceGroupNodes, UNGROUPED_ID } from '../referenceExplorer';

const reference = (id: string, groupId?: string): EvalReference => ({ schemaVersion: 1, id, projectId: 'p', requestId: id, name: `Name ${id}`, ascii: 'x', source: { documentId: 'd', checkpointId: 'c' },
  sourceName: 's', canvasName: 'canvas', createdAt: '', updatedAt: '', ...(groupId ? { groupId } : {}) });
const group = (id: string, name = id): EvalReferenceGroup => ({ schemaVersion: 1, id, projectId: 'p', requestId: id, name, createdAt: '', updatedAt: '' });
const diagrams = (...names: string[]) => names.map(name => ({ diagramId: `grid:${name}`, revisionId: `r-${name}`, name }));
const candidate = (documentId: string, canvasName: string, name: string, names: string[], extra: Partial<CompareCandidate> = {}): CompareCandidate =>
  ({ documentId, checkpointId: `c-${name}`, canvasName, name, diagrams: diagrams(...names), ...extra });
const generated = (contextName: string) => ({ generated: { agentContextId: contextName, contextName } as CompareCandidate['generated'] });

describe('reference tree', () => {
  it('lists named groups then Ungrouped, treating a dangling group as ungrouped', () => {
    const nodes = referenceGroupNodes([reference('a', 'g1'), reference('b'), reference('c', 'gone')], [group('g1'), group('empty')]);
    expect(nodes.map(node => [node.id, node.references.map(item => item.id)])).toEqual([['g1', ['a']], ['empty', []], [UNGROUPED_ID, ['b', 'c']]]);
  });
  it('filtering hides groups with no match and matches on the group name', () => {
    const items = [reference('a', 'g1'), reference('b')];
    expect(referenceGroupNodes(items, [group('g1', 'Trees'), group('empty')], 'name b').map(node => node.id)).toEqual([UNGROUPED_ID]);
    expect(referenceGroupNodes(items, [group('g1', 'Trees'), group('empty')], 'trees').map(node => node.id)).toEqual(['g1']);
  });
});

describe('diagram explorer', () => {
  const saved = candidate('doc', 'Domain model', 'Current saved canvas', ['A', 'B']);
  const view = candidate('doc', 'Domain model', 'Review view', ['A'], { viewId: 'v1' });
  it('flattens a canvas with one version and splits one with several', () => {
    expect(diagramFolders([saved])[0].folders[0]).toMatchObject({ name: 'Domain model', count: 2, folders: [] });
    const [section] = diagramFolders([saved, view]);
    expect(section.folders[0].diagrams).toEqual([]);
    expect(section.folders[0].folders.map(item => [item.name, item.count])).toEqual([['Current saved canvas', 2], ['Review view', 1]]);
  });
  it('groups generated canvases by run context, after saved canvases', () => {
    const sections = diagramFolders([candidate('g1', 'Output 1', 'Output 1', ['X'], generated('Ctx')), candidate('g2', 'Output 2', 'Output 2', ['Y'], generated('Ctx')), saved]);
    expect(sections.map(section => section.name)).toEqual(['Saved canvases', 'Generated']);
    expect(sections[1].folders[0].folders.map(item => item.name)).toEqual(['Output 1', 'Output 2']);
  });
  it('filters to matching diagrams and drops what is left empty', () => {
    const sections = diagramFolders([saved, candidate('other', 'Other', 'Current saved canvas', ['Z'])], 'b');
    expect(sections).toHaveLength(1);
    expect(sections[0].folders.map(item => item.name)).toEqual(['Domain model']);
    expect(sections[0].folders[0].diagrams.map(leaf => leaf.name)).toEqual(['B']);
    expect(sections[0].folders[0].diagrams[0].key).toBe(diagramLeafKey(saved, 'grid:B'));
  });
});

describe('reference comments in prompts', () => {
  it('places the comment verbatim after the excerpt', () => {
    expect(renderReference('a\nb\n', 'Keep this nesting.')).toBe('```text\na\nb\n```\nKeep this nesting.');
    expect(renderReferences([{ name: 'One', ascii: 'a', comment: 'Note' }, { name: 'Two', ascii: 'b' }])).toBe('### One\n```text\na\n```\nNote\n\n### Two\n```text\nb\n```');
  });
  it('leaves a reference without a comment rendering exactly as before', () => {
    expect(renderReference('a')).toBe('```text\na\n```');
    expect(renderReference('a', '')).toBe('```text\na\n```');
  });
  it('is searchable', () => {
    const noted = { ...reference('a'), comment: 'unique phrase' };
    expect(referenceGroupNodes([noted, reference('b')], [], 'unique phrase')[0].references.map(item => item.id)).toEqual(['a']);
  });
});

describe('reference excerpts from a selection', () => {
  it('removes the code entities section, listed or empty', () => {
    expect(referenceExcerpt('Root\n`-- Leaf\nAssociated Code Entities:')).toBe('Root\n`-- Leaf');
    expect(referenceExcerpt('Root\n`-- Leaf\nAssociated Code Entities:\nLeaf: src/leaf.ts:1-9\nRoot: src/root.ts:2-3')).toBe('Root\n`-- Leaf');
  });
  it('re-roots a subtree: ancestor rails, its lead-in row and its connector all go', () => {
    expect(referenceExcerpt([
      '|   |',
      '|   `-- [O] CanvasWorkspace',
      '|       |-- [M] Exposes lifecycle',
      '|       |-- [O] Creates sessions',
      '|       |   `-- drafts: CanvasDraft',
      '|       |       |-- identity',
      '|       |',
      '|       `-- [M] Disposes',
    ].join('\n'))).toBe([
      '[O] CanvasWorkspace',
      '|-- [M] Exposes lifecycle',
      '|-- [O] Creates sessions',
      '|   `-- drafts: CanvasDraft',
      '|       |-- identity',
      '|',
      '`-- [M] Disposes',
    ].join('\n'));
  });
  it('re-roots a branch that still has unselected siblings', () => {
    expect(referenceExcerpt('    |-- Branch\n    |   |-- A\n    |   `-- B')).toBe('Branch\n|-- A\n`-- B');
  });
  it('keeps the connectors of sibling branches, removing only what they share', () => {
    expect(referenceExcerpt('|   |-- A\n|   |   `-- A1\n|   `-- B')).toBe('|-- A\n|   `-- A1\n`-- B');
  });
  it('keeps the rails a selection still needs when it climbs out of a subtree', () => {
    const climbing = '|   `-- deep\n`-- shallow';
    expect(referenceExcerpt(climbing)).toBe(climbing);
  });
  it('leaves a selection that already starts at its root unchanged', () => {
    const rooted = 'Root\n|-- A\n`-- B';
    expect(referenceExcerpt(rooted)).toBe(rooted);
    expect(referenceExcerpt(referenceExcerpt('|   `-- A\n|       `-- B'))).toBe('A\n`-- B');
  });
  it('handles unicode trees', () => {
    expect(referenceExcerpt('│   └── A\n│       └── B')).toBe('A\n└── B');
  });
  it('does not mistake box borders for rails', () => {
    expect(referenceExcerpt('  | foo |\n  | bar |')).toBe('| foo |\n| bar |');
    expect(referenceExcerpt('+---+\n| x |\n+---+')).toBe('+---+\n| x |\n+---+');
  });
  it('is empty when only rails were selected and nothing is a tree row around them', () => {
    expect(referenceExcerpt('\n  \nAssociated Code Entities:')).toBe('');
  });
});
