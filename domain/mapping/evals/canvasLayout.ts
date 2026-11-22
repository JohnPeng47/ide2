import { z } from 'zod';
import { boxesOverlap, type GridBounds } from '../../core/diagrams/lineGrid';
import { layoutPointSchema } from '../../core/diagrams/layoutTemplate';

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/);
const label = z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/);
const extent = z.number().int().positive().max(20000);
const endpoint = z.object({ canvas: id, diagram: id, node: id }).strict();
const diagram = z.object({
  id, title: label, position: layoutPointSchema,
  size: z.object({ columns: extent, lines: extent }).strict(),
  nodes: z.array(z.object({ id, line: extent, label }).strict()).max(200)
}).strict();

export const canvasLayoutSchema = z.object({
  canvases: z.array(z.object({ id, title: label, diagrams: z.array(diagram).min(1).max(100) }).strict()).min(1).max(30),
  edges: z.array(z.object({ source: endpoint, target: endpoint, label }).strict()).max(2000)
}).strict().superRefine((layout, ctx) => {
  const canvasIds = new Set<string>(), anchors = new Set<string>(), attached = new Set<string>();
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  for (const canvas of layout.canvases) {
    if (canvasIds.has(canvas.id)) issue('Duplicate canvas ' + canvas.id);
    canvasIds.add(canvas.id);
    const diagramIds = new Set<string>();
    const footprints: GridBounds[] = [];
    for (const d of canvas.diagrams) {
      if (diagramIds.has(d.id)) issue('Duplicate diagram ' + canvas.id + '/' + d.id);
      diagramIds.add(d.id);
      const bounds = { ...d.position, columns: d.size.columns, rows: d.size.lines };
      if (footprints.some(prior => boxesOverlap(prior, bounds))) issue('Overlapping diagram ' + canvas.id + '/' + d.id);
      footprints.push(bounds);
      const lines = new Set<number>();
      for (const node of d.nodes) {
        const key = [canvas.id, d.id, node.id].join('/');
        if (anchors.has(key)) issue('Duplicate anchor ' + key);
        if (node.line < 2 || node.line > d.size.lines || lines.has(node.line)) issue('Invalid or occupied anchor line at ' + key);
        anchors.add(key); lines.add(node.line);
      }
    }
  }
  for (const edge of layout.edges) {
    if (edge.source.canvas === edge.target.canvas && edge.source.diagram === edge.target.diagram) issue('An edge must connect two diagrams');
    for (const end of [edge.source, edge.target]) {
      const key = [end.canvas, end.diagram, end.node].join('/');
      if (!anchors.has(key)) issue('Missing anchor ' + key);
      attached.add(key);
    }
  }
  for (const key of anchors) if (!attached.has(key)) issue('Unused connecting node ' + key);
});

export type CanvasLayout = z.infer<typeof canvasLayoutSchema>;
export const canvasLayoutInstructions = `Return JSON {canvases:[{id,title,diagrams:[{id,title,position:{column,row},size:{columns,lines},nodes:[{id,line,label}]}]}],edges:[{source:{canvas,diagram,node},target:{canvas,diagram,node},label}]}.
Use nonnegative zero-based grid positions and positive widths in characters and heights in diagram lines. Place the title on line 1 and each connecting node on its own 1-based line inside the footprint. Reserve blank lines for future content. Include only titles and nodes used by edges. Place diagrams without overlap. Edges are directed and may cross canvases. IDs start with a letter and contain letters, digits, hyphens or underscores. Return no diagram bodies.`;
