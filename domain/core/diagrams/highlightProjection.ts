import { presentationHighlights, type DiagramPresentations } from '../presentation/diagramPresentation';
import { getDiagramRevision } from './diagramRevisionStore';
import { createStoredDiagram } from './diagramRevisionStore';
import { z } from 'zod';
import { activeDiagramHighlights } from './diagramHighlight';
import { CanvasHistory, documentFromHistory, type CanvasHistoryRecord, type ResolvedCanvasDocument } from './canvasHistory';
import { emptyCanvasDocument, prepareCanvasTransfer, type TransferInput } from './canvasTransfer';
import { flattenGrid, resolveScene, type GridBox, type LineGridScene } from './lineGrid';


export const projectionSettingsSchema = z.object({
  mode: z.enum(['original', 'compact']), centroid: z.enum(['mean', 'area', 'diagram', 'placeholder']),
  focusId: z.string().optional(),
  attraction: z.number().min(0).max(1), neighbors: z.number().min(0).max(1), fidelity: z.number().min(0).max(1),
  gap: z.number().int().min(0).max(20)
}).strict();
export type ProjectionSettings = z.infer<typeof projectionSettingsSchema>;
export const projectionPresets = {
  Default: { mode: 'compact', centroid: 'mean', attraction: 1, neighbors: 1, fidelity: 1, gap: 8 },
  Original: { mode: 'original', centroid: 'mean', attraction: 0, neighbors: 0, fidelity: 1, gap: 3 },
  Balanced: { mode: 'compact', centroid: 'mean', attraction: .4, neighbors: .35, fidelity: .75, gap: 3 },
  Tight: { mode: 'compact', centroid: 'mean', attraction: .9, neighbors: .7, fidelity: .25, gap: 2 },
  Connected: { mode: 'compact', centroid: 'mean', attraction: .15, neighbors: 1, fidelity: .5, gap: 3 }
} satisfies Record<string, ProjectionSettings>;
const coordinate = z.number().int().min(0).max(20000);
export const projectionLayoutSchema = z.object({
  sourceCanvasId: z.string().min(1), sourceRevisionId: z.string().min(1),
  placeholderId: z.string().min(1).optional(),
  settings: projectionSettingsSchema,
  cell: z.object({ width: z.number().positive().max(100), height: z.number().positive().max(100) }),
  nodes: z.array(z.object({ id: z.string().min(1), sourceId: z.string().min(1).optional(), label: z.string(),
    column: coordinate, row: coordinate, columns: coordinate.min(1), rows: coordinate.min(1) })).min(1).max(2000)
}).strict().refine(value => new Set(value.nodes.map(node => node.id)).size === value.nodes.length, 'Duplicate projected diagram');
export type ProjectionLayout = z.infer<typeof projectionLayoutSchema>;

const expand = (box: GridBox): GridBox => box.kind === 'container' ? { ...box, collapsed: false, children: box.children.map(expand) } : box;
export const projectDiagramsSchema = z.object({
  diagramIds: z.array(z.string().min(1).max(200)).min(1).max(1999)
    .refine(ids => new Set(ids).size === ids.length, 'Diagram IDs must be unique')
}).strict();
export const projectDiagramsCommandSchema = projectDiagramsSchema.extend({
  expectedVersion: z.number().int().nonnegative(), requestId: z.string().min(1).max(200)
}).strict();

export function highlightedDiagramIds(scene: LineGridScene, presentations?: DiagramPresentations): string[] {
  return flattenGrid(resolveScene({ ...scene, root: expand(scene.root) })).filter(({ box }) => {
    if (box.kind !== 'diagram') return false;
    const diagram = scene.contents[box.contentId];
    return activeDiagramHighlights(diagram.content, presentationHighlights(diagram, presentations?.[box.contentId], getDiagramRevision(diagram.revisionId).nodeRefs), diagram.revisionId).length > 0;
  }).map(({ box }) => `grid:${box.id}`);
}

/** Reuse copy's anchor/content remapping, then publish one checkpoint containing its layout provenance. */
export function prepareHighlightProjection(record: CanvasHistoryRecord, input: Omit<TransferInput, 'mode' | 'selectedIds'>,
  cell = { width: 8.4, height: 18 }) {
  const source = documentFromHistory(record), selectedIds = highlightedDiagramIds(source.scene, source.diagramPresentations);
  if (!selectedIds.length) throw Error('Highlight at least one diagram before projecting.');
  return prepareDiagramProjection(record, { ...input, selectedIds }, cell);
}

/** Project explicit diagram placements, regardless of their highlight state. */
export function prepareDiagramProjection(record: CanvasHistoryRecord, input: Omit<TransferInput, 'mode'>,
  cell = { width: 8.4, height: 18 }) {
  const source = documentFromHistory(record);
  const { diagramIds: selectedIds } = projectDiagramsSchema.parse({ diagramIds: input.selectedIds });
  const selected = new Set(selectedIds);
  const originals = flattenGrid(resolveScene({ ...source.scene, root: expand(source.scene.root) })).filter(({ box }) => selected.has(`grid:${box.id}`));
  const prepared = prepareCanvasTransfer(record, { ...input, mode: 'copy', selectedIds });
  let target = prepared.destination.document;
  const boxes = flattenGrid(resolveScene(target.scene)).filter(node => node.box.kind === 'diagram');
  const projectionLayout: ProjectionLayout = { sourceCanvasId: input.sourceId, sourceRevisionId: record.headId, cell,
    settings: { ...projectionPresets.Default }, nodes: boxes.map(({ box, bounds }, i) => ({
      id: box.id, sourceId: originals[i].box.id, ...bounds,
      label: box.kind === 'diagram' ? target.scene.contents[box.contentId].content.ascii.split('\n')[0].slice(0, 80) || `Diagram ${i + 1}` : box.id
    })) };
  const placeholderId = `diagram-${crypto.randomUUID()}`;
  const placeholder = createStoredDiagram({ id: placeholderId, revision: 0,
    ascii: Array.from({ length: 35 }, () => ' '.repeat(65)).join('\n'), structureKind: 'diagram' }).diagram;
  const center = {
    column: projectionLayout.nodes.reduce((sum, node) => sum + node.column + node.columns / 2, 0) / boxes.length,
    row: projectionLayout.nodes.reduce((sum, node) => sum + node.row + node.rows / 2, 0) / boxes.length
  };
  projectionLayout.placeholderId = placeholderId;
  projectionLayout.nodes.push({ id: placeholderId, label: 'Blank diagram (65 × 35)',
    column: Math.round(center.column - 65 / 2), row: Math.round(center.row - 35 / 2), columns: 65, rows: 35 });
  // Keep the baseline in legal grid coordinates, without changing source-to-source offsets.
  const minColumn = Math.min(...projectionLayout.nodes.map(node => node.column));
  const minRow = Math.min(...projectionLayout.nodes.map(node => node.row));
  projectionLayout.nodes = projectionLayout.nodes.map(node => ({ ...node, column: node.column - minColumn, row: node.row - minRow }));
  const positions = new Map(projectionLayout.nodes.map(node => [node.id, { column: node.column, row: node.row }]));
  if (target.scene.root.kind !== 'container') throw Error('Expected a projected canvas');
  target = { ...target, scene: { contents: { ...target.scene.contents, [placeholderId]: placeholder }, root: {
    ...target.scene.root, children: [
      ...target.scene.root.children.map(box => ({ ...box, position: positions.get(box.id)! })),
      { id: placeholderId, kind: 'diagram', contentId: placeholderId, collapsed: false, position: positions.get(placeholderId)! }
    ]
  } } };
  target = layoutHighlightProjection(target, projectionLayout, projectionLayout.settings);
  const view = { ...(input.destinationView as object), projectionLayout };
  const history = new CanvasHistory(emptyCanvasDocument(), input.destinationView);
  prepared.transaction.destinationBefore = history.head.id;
  history.append(target, view); history.linkTransaction(prepared.transaction.id);
  prepared.transaction.destinationAfter = history.head.id;
  prepared.destination = { document: target, view, history: history.export() };
  return prepared;
}

export interface ProjectionGeometry {
  sizes: { id: string; columns: number; rows: number }[];
  edges: { sourceId: string; targetId: string }[];
}
export type ProjectionPosition = { id: string; column: number; row: number };
/** Worker transport contains geometry only: no diagram text, evidence, or undo history. */
export function projectionGeometry(document: ResolvedCanvasDocument, projection: ProjectionLayout): ProjectionGeometry {
  const root = document.scene.root;
  const ids = new Set(projection.nodes.map(node => node.id));
  if (root.kind !== 'container' || root.children.length !== ids.size || root.children.some(box => box.kind !== 'diagram' || !ids.has(box.id)))
    throw Error('The diagram membership changed. Project the diagrams again to create a new layout baseline.');
  return {
    sizes: flattenGrid(resolveScene(document.scene)).filter(node => ids.has(node.box.id))
      .map(node => ({ id: node.box.id, columns: node.bounds.columns, rows: node.bounds.rows })),
    edges: document.edges.map(edge => ({ sourceId: edge.source.displayNodeId, targetId: edge.target.displayNodeId }))
  };
}
export function applyProjectionPositions(document: ResolvedCanvasDocument, positions: ProjectionPosition[]): ResolvedCanvasDocument {
  const root = document.scene.root, byId = new Map(positions.map(({ id, ...point }) => [id, point]));
  if (root.kind !== 'container' || root.children.length !== byId.size || root.children.some(box => !byId.has(box.id)))
    throw Error('The diagram membership changed. Project the diagrams again to create a new layout baseline.');
  const scene = { ...document.scene, root: { ...root, position: { column: 0, row: 0 },
    children: root.children.map(box => ({ ...box, position: byId.get(box.id)! })) } };
  resolveScene(scene);
  return { ...document, scene };
}
export function layoutHighlightProjection(document: ResolvedCanvasDocument, projection: ProjectionLayout, input: ProjectionSettings): ResolvedCanvasDocument {
  return applyProjectionPositions(document, calculateProjectionPositions(projectionGeometry(document, projection), projection, input));
}

type Constraint = { a: number; b: number; gap: number };
/** Fixed separation directions turn rectangle overlap avoidance into two acyclic constraint systems.
 * Weighted position/neighbor objectives are relaxed with projected iterations, then a topological
 * pass makes separation exact. Input order and original coordinates make the result deterministic.
 * This follows constraint-based layout (CoLa/VPSC), without adding a general graph-layout runtime.
 */
export function calculateProjectionPositions(geometry: ProjectionGeometry, projection: ProjectionLayout, input: ProjectionSettings): ProjectionPosition[] {
  const settings = projectionSettingsSchema.parse(input), { nodes, cell } = projection;
  const bounds = new Map(geometry.sizes.map(size => [size.id, size]));
  const w = nodes.map(n => bounds.get(n.id)!.columns * cell.width), h = nodes.map(n => bounds.get(n.id)!.rows * cell.height);
  const ox = nodes.map(n => (n.column + n.columns / 2) * cell.width), oy = nodes.map(n => (n.row + n.rows / 2) * cell.height);
  let x = [...ox], y = [...oy];
  if (settings.mode === 'compact' && nodes.length > 1) {
    const mass = nodes.map(n => settings.centroid === 'area' ? Math.max(1, n.columns * n.rows) : 1);
    const total = mass.reduce((a, b) => a + b, 0);
    const focus = nodes.findIndex(n => n.id === (settings.centroid === 'placeholder' ? projection.placeholderId : settings.focusId));
    const focusCentroid = (settings.centroid === 'diagram' || settings.centroid === 'placeholder') && focus >= 0;
    const cx = focusCentroid ? ox[focus] : ox.reduce((sum, v, i) => sum + v * mass[i], 0) / total;
    const cy = focusCentroid ? oy[focus] : oy.reduce((sum, v, i) => sum + v * mass[i], 0) / total;
    const radius = Math.max(1, Math.sqrt(ox.reduce((s, v, i) => s + (v - cx) ** 2 + (oy[i] - cy) ** 2, 0) / nodes.length));
    const gravity = nodes.map((_, i) => settings.attraction * 4 / (1 + Math.hypot(ox[i] - cx, oy[i] - cy) / radius));
    const index = new Map(nodes.map((n, i) => [`grid:${n.id}`, i]));
    const pairs = new Map<string, { a: number; b: number; weight: number }>();
    const pair = (a: number, b: number, weight: number) => {
      if (a === b) return;
      if (a > b) [a, b] = [b, a];
      const key = `${a}:${b}`; pairs.set(key, { a, b, weight: Math.max(weight, pairs.get(key)?.weight ?? 0) });
    };
    // Spatial neighbors also keep disconnected diagrams in their original neighborhood.
    nodes.forEach((_, i) => nodes.map((_, j) => ({ j, distance: Math.hypot(ox[i] - ox[j], oy[i] - oy[j]) }))
      .filter(n => n.j !== i).sort((a, b) => a.distance - b.distance || a.j - b.j).slice(0, 3).forEach(n => pair(i, n.j, .25)));
    for (const edge of geometry.edges) {
      const a = index.get(edge.sourceId), b = index.get(edge.targetId);
      if (a !== undefined && b !== undefined) pair(a, b, 1);
    }
    const constraints = (original: number[]) => {
      const order = nodes.map((_, i) => i).sort((a, b) => original[a] - original[b] || a - b);
      return { order, values: order.slice(1).map((b, i) => ({ a: order[i], b, gap: 0 })) as Constraint[] };
    };
    const horizontal = constraints(ox), vertical = constraints(oy);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const dx = Math.abs(ox[i] - ox[j]), dy = Math.abs(oy[i] - oy[j]);
      const originalW = (nodes[i].columns + nodes[j].columns) * cell.width / 2;
      const originalH = (nodes[i].rows + nodes[j].rows) * cell.height / 2;
      const separatedX = dx + 1e-7 >= originalW, separatedY = dy + 1e-7 >= originalH;
      const preferX = dx / Math.max(1, originalW) >= dy / Math.max(1, originalH);
      const useX = separatedX && !separatedY || separatedX === separatedY && preferX;
      const original = useX ? ox : oy, sizes = useX ? w : h;
      const [a, b] = original[i] <= original[j] ? [i, j] : [j, i];
      (useX ? horizontal : vertical).values.push({ a, b, gap: (sizes[a] + sizes[b]) / 2 + settings.gap * (useX ? cell.width : cell.height) });
    }
    const project = (values: number[], constraints: Constraint[]) => {
      for (const { a, b, gap } of constraints) {
        const correction = (gap - (values[b] - values[a])) / 2;
        if (correction > 0) { values[a] -= correction; values[b] += correction; }
      }
    };
    const fidelity = .15 + settings.fidelity * 5;
    for (let iteration = 0; iteration < 60; iteration++) {
      const weights = gravity.map(g => fidelity + g), nx = ox.map((v, i) => fidelity * v + gravity[i] * cx), ny = oy.map((v, i) => fidelity * v + gravity[i] * cy);
      for (const { a, b, weight } of pairs.values()) {
        const k = settings.neighbors * weight * 4, scale = 1 - settings.neighbors * .85;
        const dx = (ox[b] - ox[a]) * scale, dy = (oy[b] - oy[a]) * scale;
        nx[a] += k * (x[b] - dx); nx[b] += k * (x[a] + dx);
        ny[a] += k * (y[b] - dy); ny[b] += k * (y[a] + dy);
        weights[a] += k; weights[b] += k;
      }
      x = nx.map((v, i) => v / weights[i]); y = ny.map((v, i) => v / weights[i]);
      for (let pass = 0; pass < 4; pass++) { project(x, horizontal.values); project(y, vertical.values); }
    }
    // Round top-left coordinates, then enforce constraints in grid space. Ceil avoids
    // rounding away the requested gap; every arc follows the original axis ordering.
    const finish = (values: number[], sizes: number[], unit: number, system: ReturnType<typeof constraints>) => {
      const top = values.map((v, i) => Math.round((v - sizes[i] / 2) / unit));
      const incoming = new Map<number, Constraint[]>();
      for (const c of system.values) {
        if (!incoming.has(c.b)) incoming.set(c.b, []);
        incoming.get(c.b)!.push(c);
      }
      for (const b of system.order) for (const c of incoming.get(b) ?? [])
        top[b] = Math.max(top[b], top[c.a] + Math.ceil((c.gap + (sizes[c.a] - sizes[b]) / 2) / unit));
      return top;
    };
    x = finish(x, w, cell.width, horizontal); y = finish(y, h, cell.height, vertical);
  } else {
    x = nodes.map(n => n.column); y = nodes.map(n => n.row);
    // Exact source spacing may leave no room at its center. Original places the new
    // placeholder alongside the group; compact modes reserve space within the group.
    const placeholder = nodes.findIndex(node => node.id === projection.placeholderId);
    if (placeholder >= 0) x[placeholder] = Math.max(...nodes.filter(node => node.id !== projection.placeholderId)
      .map(node => node.column + bounds.get(node.id)!.columns)) + settings.gap;
  }
  const minX = Math.min(...x), minY = Math.min(...y);
  return nodes.map((n, i) => ({ id: n.id, column: x[i] - minX, row: y[i] - minY }));
}
