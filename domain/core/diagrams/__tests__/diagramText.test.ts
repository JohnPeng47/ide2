import { mutableFixture } from '../../../../tests/support/mappingDiagram';
import { describe, expect, it } from 'vitest';
import { validateDiagram } from '../diagram';
import { RevisionedDiagramService } from '../diagramService';
import { buildDiagramContent } from '../diagramContent';
import { parseAsciiTree, hiddenAsciiTreeLines } from '../asciiTree';
import { diagramTextRanges, textRow, mappingContentNodeId } from '../diagramText';
import { diagramSceneText } from '../../../mapping/workspace/diagramSceneText';
import { singleDiagramScene } from '../projectDiagramCanvas';
import { composeScene } from '../lineGrid';
import { projectDiagramContent } from '../../../mapping/workspace/diagramViewState';
import type { DiagramElementMapping } from '../../records/domain';

const ascii = 'Root\n|\n|-- Alpha\n|   |-- Beta\n|   `-- Gamma\n`-- Last  \n';
const mapping = (id: string, startColumn: number, endColumn: number): DiagramElementMapping => ({
  id, line: 3, startColumn, endColumn, entityId: 'entity', sourceRangeIndex: 0
});

describe('node-aware text and compatibility', () => {
  it('parses pipe branches with exact coordinates, ancestry and folds, ignoring standalone guides', () => {
    expect(parseAsciiTree(ascii).map(node => [node.text, node.line, node.parentLine, node.textColumn])).toEqual([
      ['Root', 1, undefined, 1], ['Alpha', 3, 1, 5], ['Beta', 4, 3, 9], ['Gamma', 5, 3, 9], ['Last', 6, 1, 5]
    ]);
    expect([...hiddenAsciiTreeLines(ascii, new Set([3]))]).toEqual([4, 5]);
  });

  it('keeps old saved structures valid without silently reparsing or migrating them', () => {
    const diagram = mutableFixture(new RevisionedDiagramService().create({ id: 'old', revision: 0, ascii, structureKind: 'tree' }).diagram);
    diagram.content = mutableFixture(buildDiagramContent(ascii, 'old:0', 'tree', 'ascii-tree-1'));
    const before = JSON.stringify(diagram);
    expect(() => validateDiagram(diagram)).not.toThrow();
    expect(JSON.stringify(diagram)).toBe(before);
    expect(parseAsciiTree(ascii, 'ascii-tree-1').some(node => node.text === 'Alpha')).toBe(false);
  });

  it('emits overlapping mappings once and associates only whole contained ranges with nodes', () => {
    const content = buildDiagramContent(ascii, 'v1', 'tree');
    const mappings = [mapping('inside', 5, 7), mapping('crosses-branch', 2, 8), mapping('overlap', 6, 9)];
    const ranges = diagramTextRanges({ ascii, content, displayNodeId: 'grid:a', mappings });
    const rows = ascii.split('\n').map((line, i) => textRow(line, ranges.get(i + 1)!));
    expect(rows.map(row => row.runs.map(run => run.text).join('')).join('\n')).toBe(ascii);
    expect(rows[2].runs.find(run => run.text === 'lp')?.mappings.map(m => m.id)).toEqual(['inside', 'crosses-branch', 'overlap']);
    expect(mappingContentNodeId(content, mappings[0])).toContain('line-3');
    expect(mappingContentNodeId(content, mappings[1])).toBeUndefined();
  });

  it('uses coordinate metadata without invented node IDs for prose, stale content and ambiguous ranges', () => {
    const prose = 'Unstructured heading';
    const content = buildDiagramContent(prose, 'v1', 'tree');
    const range = diagramTextRanges({ ascii: prose, content, displayNodeId: 'grid:a' });
    expect(textRow(prose, range.get(1)!).runs[0].owner?.contentNodeId).toBeUndefined();
    const stale = diagramTextRanges({ ascii, content, displayNodeId: 'grid:a' });
    expect([...stale.values()].flat().some(range => range.owner?.contentNodeId)).toBe(false);
    const parsed = mutableFixture(buildDiagramContent(ascii, 'v2', 'tree'));
    if (parsed.structure.kind !== 'tree') throw new Error();
    const node = Object.values(parsed.structure.nodes).find(node => node.line === 3)!;
    parsed.structure.nodes.duplicate = { ...node, id: 'duplicate' };
    const ambiguous = diagramTextRanges({ ascii, content: parsed, displayNodeId: 'grid:a' });
    expect(textRow('|-- Alpha', ambiguous.get(3)!).runs.some(run => run.owner?.contentNodeId)).toBe(false);
  });

  it('preserves scene painting, repeated instance identity and source coordinates after folding', () => {
    const scene = singleDiagramScene(ascii);
    scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
    if (scene.root.kind !== 'container') throw new Error();
    scene.root.children = [...scene.root.children, { ...scene.root.children[0], id: 'second', position: { column: 30, row: 2 } }];
    const content = scene.contents.overview.content;
    if (content.structure.kind !== 'tree') throw new Error();
    const alpha = Object.values(content.structure.nodes).find(node => node.line === 3)!;
    const views = { 'grid:overview': { contentRevisionId: content.revisionId, collapsedContentNodeIds: [alpha.id] } };
    const composed = diagramSceneText(scene, views);
    expect(composed.ascii).toBe(composeScene(scene, (d, box) => projectDiagramContent(d.content, box.id === 'overview' ? views['grid:overview'] : undefined).ascii));
    expect(composed.rows.map(row => row.runs.map(run => run.text).join('')).join('\n')).toBe(composed.ascii);
    const alphaRuns = composed.rows.flatMap(row => row.runs).filter(run => run.owner?.contentNodeId === alpha.id);
    expect(alphaRuns.map(run => run.owner?.displayNodeId)).toEqual(['grid:overview', 'grid:second']);
    const last = composed.rows[3].runs.find(run => run.text === 'Last');
    expect(last?.owner?.sourceLine).toBe(6);
  });
});
