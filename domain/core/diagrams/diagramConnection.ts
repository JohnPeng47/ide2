import { z } from 'zod';
import type { GridBox, LineGridScene } from './lineGrid';
import { diagramContentNodes as connectionContentNodes } from './diagramContentNodes';
export { diagramContentNodes as connectionContentNodes } from './diagramContentNodes';

const id = z.string().min(1).max(500).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const offset = z.number().min(0).max(1).optional();
const side = z.enum(['auto', 'horizontal', 'left', 'right', 'top', 'bottom']).default('auto');
export const contentNodeAnchorSchema = z.object({
  kind: z.literal('content-node'), displayNodeId: id, contentNodeId: id, revisionId: id, side, offset
}).strict();
export const boxAnchorSchema = z.object({ kind: z.literal('box'), displayNodeId: id, side, offset }).strict();
export const anchorSchema = z.discriminatedUnion('kind', [contentNodeAnchorSchema, boxAnchorSchema]);
export const arrowLabelSchema = z.object({
  text: z.string().max(120),
  /** Absolute canvas pixels: horizontal center and text baseline, before pan/zoom. */
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional()
}).strict();
export const arrowAppearanceSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#88c0d0'),
  lineStyle: z.enum(['solid', 'dashed']).default('solid'),
  label: z.union([z.string().max(120), arrowLabelSchema]).default('')
}).strict();
export const diagramConnectionSchema = z.object({
  id, source: contentNodeAnchorSchema, target: anchorSchema,
  appearance: arrowAppearanceSchema
}).strict();
export type ContentNodeAnchor = z.infer<typeof contentNodeAnchorSchema>;
export type GridBoxAnchor = z.infer<typeof boxAnchorSchema>;
export type DiagramAnchor = ContentNodeAnchor | GridBoxAnchor;
export type DiagramConnection = z.infer<typeof diagramConnectionSchema>;
export type ArrowAppearance = DiagramConnection['appearance'];
export type ArrowLabel = z.infer<typeof arrowLabelSchema>;
export const defaultArrowAppearance: ArrowAppearance = { color: '#88c0d0', lineStyle: 'solid', label: '' };

/** Legacy saved edges and callers may still supply a plain string. */
export function getArrowLabel(appearance: ArrowAppearance): ArrowLabel {
  return typeof appearance.label === 'string' ? { text: appearance.label } : appearance.label;
}

export function connectionBox(scene: LineGridScene, displayNodeId: string): GridBox | undefined {
  if (!displayNodeId.startsWith('grid:')) return undefined;
  const find = (box: GridBox): GridBox | undefined => box.id === displayNodeId.slice(5) ? box
    : box.kind === 'container' ? box.children.map(find).find(Boolean) : undefined;
  return find(scene.root);
}

export function validateConnectionAnchor(scene: LineGridScene, anchor: DiagramAnchor, allowStale = false) {
  const box = connectionBox(scene, anchor.displayNodeId);
  if (!box) throw new Error('Connection requires an existing GridBox');
  if (anchor.kind === 'box') return;
  if (box.kind !== 'diagram') throw new Error('Content anchor requires a diagram');
  const content = scene.contents[box.contentId].content;
  if (allowStale && content.revisionId !== anchor.revisionId) return;
  if (content.revisionId !== anchor.revisionId || !connectionContentNodes(content).some(node => node.id === anchor.contentNodeId)) {
    throw new Error('STALE_CONTENT_NODE: choose a current connection endpoint');
  }
}

export function validateConnections(scene: LineGridScene, input: unknown): DiagramConnection[] {
  const edges = z.array(diagramConnectionSchema).max(2000).parse(input ?? []);
  const seen = new Set<string>();
  for (const edge of edges) {
    if (seen.has(edge.id)) throw new Error('Duplicate connection ID');
    seen.add(edge.id);
    validateConnectionAnchor(scene, edge.source, true);
    validateConnectionAnchor(scene, edge.target, true);
  }
  return edges;
}

/** Deletions remove incident edges. Only proven node correspondence can rebase changed content. */
export function reconcileConnections(before: LineGridScene, after: LineGridScene, edges: readonly DiagramConnection[], nodeIds?: ReadonlyMap<string, string>): DiagramConnection[] {
  const update = <T extends DiagramAnchor>(anchor: T): T => {
    if (anchor.kind !== 'content-node') return anchor;
    const oldBox = connectionBox(before, anchor.displayNodeId), newBox = connectionBox(after, anchor.displayNodeId);
    if (oldBox?.kind !== 'diagram' || newBox?.kind !== 'diagram') return anchor;
    const oldContent = before.contents[oldBox.contentId].content, content = after.contents[newBox.contentId].content;
    if (oldContent.revisionId === content.revisionId || oldContent.revisionId !== anchor.revisionId) return anchor;
    const mapped = nodeIds?.get(anchor.contentNodeId);
    if (mapped && connectionContentNodes(content).some(node => node.id === mapped))
      return { ...anchor, revisionId: content.revisionId, contentNodeId: mapped };
    if (oldContent.ascii !== content.ascii || oldContent.structure.kind !== content.structure.kind) return anchor;
    const oldNode = connectionContentNodes(oldContent).find(node => node.id === anchor.contentNodeId);
    const node = oldNode && connectionContentNodes(content).find(node => node.line === oldNode.line && node.startColumn === oldNode.startColumn);
    return node ? { ...anchor, revisionId: content.revisionId, contentNodeId: node.id } : anchor;
  };
  return edges.filter(edge => connectionBox(after, edge.source.displayNodeId) && connectionBox(after, edge.target.displayNodeId))
    .map(edge => ({ ...edge, source: update(edge.source), target: update(edge.target) }));
}
