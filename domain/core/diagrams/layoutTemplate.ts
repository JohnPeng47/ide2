import { z } from 'zod';
import { flattenGrid, measureContent, type GridBounds, type GridPoint, type ResolvedGridBox } from './lineGrid';

const coordinate = z.number().int().min(0).max(20000);
export const layoutPointSchema = z.object({ column: coordinate, row: coordinate }).strict();
const slotSchema = z.object({ id: z.string().regex(/^slot-[1-9][0-9]*$/), position: layoutPointSchema,
  size: z.object({ columns: z.number().int().min(1).max(20000), rows: z.number().int().min(1).max(20000) }).strict() }).strict();
export const layoutGeometrySchema = z.object({ format: z.literal('layout-template-v1'),
  placement: z.object({ version: z.union([z.literal(1), z.literal(2)]), gap: z.literal(3) }).strict(),
  slots: z.array(slotSchema).min(1, 'The canvas has no visible diagrams.').max(20, 'A layout template supports at most 20 visible diagrams.')
}).strict().refine(value => new Set(value.slots.map(slot => slot.id)).size === value.slots.length, 'Duplicate layout slots')
  .refine(value => Math.min(...value.slots.map(slot => slot.position.column)) === 0
    && Math.min(...value.slots.map(slot => slot.position.row)) === 0, 'Normalize the layout origin to (0, 0)')
  .refine(value => value.slots.every(slot => slot.position.column + slot.size.columns <= 20000
    && slot.position.row + slot.size.rows <= 20000), 'Layout exceeds the 20,000-cell grid bounds');
export type LayoutGeometry = z.infer<typeof layoutGeometrySchema>;
export const layoutCaptureSchema = z.object({ geometry: layoutGeometrySchema,
  source: z.object({ documentId: z.string().min(1).max(200), checkpointId: z.string().min(1).max(200), viewId: z.string().min(1).max(200).optional() }).strict()
}).strict();
export type LayoutCapture = z.infer<typeof layoutCaptureSchema>;
export interface LayoutTemplate extends LayoutCapture {
  schemaVersion: 1; id: string; projectId: string; name: string; createdAt: string; archivedAt?: string;
}
export interface LayoutPlacement { slotId: string; requested: GridPoint; bounds: GridBounds; moved: boolean }

/** Only rendered content placements: collapsed summaries count, their hidden descendants do not. */
export function extractLayoutTemplate(resolved: ResolvedGridBox): LayoutGeometry {
  return layoutFromBounds(flattenGrid(resolved).filter(node => node.contentId).map(node => node.bounds));
}

/** Accept scene-space origins (including negative ones); normalize the bounding-box origin before validation. */
export function layoutFromBounds(bounds: readonly GridBounds[]): LayoutGeometry {
  if (!bounds.length) throw Error('The canvas has no visible diagrams.');
  if (bounds.some(b => !Number.isInteger(b.column) || !Number.isInteger(b.row))) throw Error('Layout origins must be integer grid coordinates.');
  const column = Math.min(...bounds.map(b => b.column)), row = Math.min(...bounds.map(b => b.row));
  const ordered = [...bounds].sort((a, b) => a.row - b.row || a.column - b.column);
  return layoutGeometrySchema.parse({ format: 'layout-template-v1', placement: { version: 1, gap: 3 },
    slots: ordered.map((b, index) => ({ id: `slot-${index + 1}`, position: { column: b.column - column, row: b.row - row }, size: { columns: b.columns, rows: b.rows } })) });
}

/** Version 1 retains historical row-band placement. Version 2 preserves free origins
 * and moves only colliding slots; existing pinned templates remain reproducible. */
export function placeLayoutSlots(geometry: LayoutGeometry, diagrams: readonly { slotId: string; ascii: string }[]): LayoutPlacement[] {
  geometry = layoutGeometrySchema.parse(geometry);
  const content = new Map(diagrams.map(diagram => [diagram.slotId, diagram.ascii]));
  if (content.size !== diagrams.length || content.size !== geometry.slots.length || geometry.slots.some(slot => !content.has(slot.id)))
    throw Error('Return exactly one diagram for every layout slot, with no duplicate or unknown slot IDs.');
  const ordered = [...geometry.slots].sort((a, b) => a.position.row - b.position.row || a.position.column - b.position.column || a.id.localeCompare(b.id));
  const placements: LayoutPlacement[] = [];
  if (geometry.placement.version === 2) {
    for (const slot of ordered) {
      const size = measureContent(content.get(slot.id)!), gap = geometry.placement.gap;
      // A feasible closest placement lies at the requested origin or just beyond
      // an already placed box. Enumerating these edges also handles several blockers.
      const columns = [...new Set([slot.position.column, ...placements.map(p => p.bounds.column + p.bounds.columns + gap)])]
        .filter(column => column >= slot.position.column);
      const rows = [...new Set([slot.position.row, ...placements.map(p => p.bounds.row + p.bounds.rows + gap)])]
        .filter(row => row >= slot.position.row);
      const candidates = rows.flatMap(row => columns.map(column => ({ column, row, ...size })))
        .filter(b => b.column + b.columns <= 20000 && b.row + b.rows <= 20000)
        .filter(a => placements.every(({ bounds: b }) => !(a.column < b.column + b.columns + gap
          && b.column < a.column + a.columns + gap && a.row < b.row + b.rows + gap && b.row < a.row + a.rows + gap)));
      // Grid rows are about twice as tall as columns; tie-breaks are stable.
      candidates.sort((a, b) => (a.column + 2 * a.row) - (b.column + 2 * b.row) || a.row - b.row || a.column - b.column);
      const bounds = candidates[0];
      if (!bounds) throw Error('Generated layout exceeds the 20,000-cell grid bounds. Use shorter diagrams or a smaller template.');
      placements.push({ slotId: slot.id, requested: { ...slot.position }, bounds,
        moved: bounds.column !== slot.position.column || bounds.row !== slot.position.row });
    }
    return placements;
  }
  let band = -1, row = 0, bottom = 0, right = 0;
  for (const slot of ordered) {
    if (slot.position.row !== band) {
      row = placements.length ? Math.max(slot.position.row, bottom + geometry.placement.gap) : slot.position.row;
      band = slot.position.row; right = 0;
    }
    const position = { column: Math.max(slot.position.column, right), row };
    const size = measureContent(content.get(slot.id)!);
    layoutPointSchema.parse(position);
    if (position.column + size.columns > 20000 || position.row + size.rows > 20000)
      throw Error('Generated layout exceeds the 20,000-cell grid bounds. Use shorter diagrams or a smaller template.');
    const bounds = { ...position, ...size };
    right = position.column + size.columns + geometry.placement.gap;
    bottom = Math.max(bottom, position.row + size.rows);
    placements.push({ slotId: slot.id, requested: { ...slot.position }, bounds,
      moved: position.column !== slot.position.column || position.row !== slot.position.row });
  }
  return placements;
}
