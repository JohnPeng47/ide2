import { describe, expect, it } from 'vitest';
import { buildDiagramContent } from '../diagramContent';
import { diagramContentNodes } from '../diagramContentNodes';
import { contentNodeIntersectsRect, contentNodeRect, contentNodeSpans, contentNodeText } from '../contentNodeGeometry';
import { nodeIntersectsRect } from '../../../mapping/selection/selectionState';

const ascii = [
  'MappingWorkspacePage',
  '  |',
  '  +--------------------+',
  '  |                    |',
  '  v                    v',
  'CanvasWorkspace      WorkspaceStorage',
  'drafts + controllers   load / save'
].join('\n');

describe('span-based content nodes', () => {
  const content = buildDiagramContent(ascii, 'r:0');
  const nodes = diagramContentNodes(content);
  const byLabel = (label: string) => nodes.find(node => node.label.split('\n')[0] === label)!;

  it('derives multi-line graph boxes for non-tree diagrams, keeping the first span as the anchor', () => {
    const workspace = byLabel('CanvasWorkspace');
    expect(workspace.label).toBe('CanvasWorkspace\ndrafts + controllers');
    expect(contentNodeSpans(workspace)).toEqual([{ line: 6, startColumn: 1, endColumn: 15 }, { line: 7, startColumn: 1, endColumn: 20 }]);
    expect([workspace.line, workspace.startColumn, workspace.endColumn]).toEqual([6, 1, 15]);
    expect(workspace.id).toBe('r:0:' + content.asciiSha256 + ':node-6-1');
    expect(contentNodeRect(workspace)).toEqual({ startLine: 6, endLine: 7, startColumn: 1, endColumn: 20 });
    expect(contentNodeText(workspace, ascii.split('\n'))).toBe('CanvasWorkspace\ndrafts + controllers');
  });

  it('selects a box when the rectangle intersects any of its lines', () => {
    const secondLineOnly = { startLine: 7, endLine: 7, startColumn: 1, endColumn: 5 };
    expect(nodeIntersectsRect(byLabel('CanvasWorkspace'), secondLineOnly)).toBe(true);
    expect(nodeIntersectsRect(byLabel('WorkspaceStorage'), secondLineOnly)).toBe(false);
    // Wire cells inside a box's bounds do not make the box intersect.
    expect(contentNodeIntersectsRect(byLabel('MappingWorkspacePage'), { startLine: 2, endLine: 5, startColumn: 1, endColumn: 40 })).toBe(false);
  });

  it('treats stored single-line tree nodes as one span', () => {
    const tree = buildDiagramContent('Root\n+-- child', 't:0', 'tree');
    const child = diagramContentNodes(tree).find(node => node.label === 'child')!;
    expect(contentNodeSpans(child)).toEqual([{ line: 2, startColumn: 5, endColumn: 9 }]);
  });
});

describe('pinned derivation for unstructured diagrams', () => {
  it('keeps the legacy node IDs for stored content without a parser version', () => {
    const fresh = buildDiagramContent(ascii, 'r:0');
    expect(fresh.structure).toEqual({ kind: 'diagram', parserVersion: 'ascii-graph-1' });
    const stored = buildDiagramContent(ascii, 'r:0', 'diagram', 'legacy-diagram');
    expect(stored.structure).toEqual({ kind: 'diagram' });
    // Saved revisions key nodeRefs by these IDs; the legacy derivation splits title and description lines.
    const legacy = diagramContentNodes(stored);
    expect(legacy.some(node => node.label === 'drafts + controllers')).toBe(true);
    expect(legacy.every(node => node.lines === undefined)).toBe(true);
  });
});
