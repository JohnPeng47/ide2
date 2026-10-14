import { expect, it } from 'vitest';
import { treemapDiagramColors, treemapLocColor, treemapMaxLoc, treemapLocScale } from '../treemapDiagramColors';
import type { ChangeTreemapNode } from '../../../../../domain/mapping/changes/changeTreemap';
const node = (id: string, value: number, kind: ChangeTreemapNode['kind'] = 'node', children: ChangeTreemapNode[] = []): ChangeTreemapNode => ({
  id, label: id, value, kind, added: value, deleted: 0, hunkIds: [], children,
  target: { representationId: 'doc', displayNodeId: 'grid:d', contentNodeId: kind === 'diagram' ? undefined : id }
});
it('uses LOC rather than hierarchy position, retaining the full map reference range', () => {
  const root = node('root', 100, 'root', [node('diagram', 100, 'diagram', [node('parent', 100, 'node', [node('a', 25), node('b', 25), node('direct', 50, 'direct')])])]);
  const { nodes } = treemapDiagramColors(root, 'continuous');
  expect(treemapMaxLoc(root)).toBe(100);
  expect(nodes.get('diagram')!.color).toBe(nodes.get('parent')!.color);
  expect(nodes.get('a')!.color).toBe(nodes.get('b')!.color);
  expect(nodes.get('a')!.color).toBe(treemapLocColor(25, 100));
  expect(nodes.get('direct')!.color).toBe(treemapLocColor(50, 100));
  expect(nodes.get('direct')!.position).toBe(nodes.get('parent')!.position);
  expect(nodes.get('direct')!.direct).toBe(true);
  expect(treemapLocColor(0, 0)).not.toContain('NaN');
  expect(treemapLocColor(1000, 100)).toBe(treemapLocColor(100, 100));
});

it('defaults to evenly spaced ranks despite outliers, with equal LOC sharing a shade', () => {
  const root = node('root', 1004, 'root', [node('diagram', 1004, 'diagram', [node('a', 1), node('b', 1), node('c', 2), node('outlier', 1000)])]);
  const scale = treemapLocScale(root);
  expect(scale.min).toBe(1);
  expect(scale.max).toBe(1004);
  expect(scale.color(1)).toBe(treemapLocColor(0, 1));
  expect(scale.color(2)).toBe(treemapLocColor(1, 3));
  expect(scale.color(1000)).toBe(treemapLocColor(2, 3));
  expect(scale.color(1004)).toBe(treemapLocColor(1, 1));
  const { nodes } = treemapDiagramColors(root);
  expect(nodes.get('a')!.color).toBe(nodes.get('b')!.color);
  expect(nodes.get('c')!.color).toBe(scale.color(2));
  root.children[0].children.reverse();
  expect(treemapDiagramColors(root).nodes.get('c')!.color).toBe(scale.color(2));
});
it('excludes unmapped values and handles empty and single-value maps', () => {
  expect(treemapLocScale().color(0)).toBe(treemapLocColor(0, 1));
  const root = node('root', 102, 'root', [node('diagram', 2, 'diagram', [node('a', 2)]), node('unmapped', 100, 'unmapped')]);
  const scale = treemapLocScale(root);
  expect([scale.min, scale.max]).toEqual([2, 2]);
  expect(scale.color(2)).toBe(treemapLocColor(1, 1));
  expect(treemapLocScale(root, 'continuous').color(2)).toBe(scale.color(2));
});
