import { z } from 'zod';
import { alternativeOutputSchema } from './alternatives';
import { gridOutputId } from '../rollup/rollUp';

const diagramId = z.string().min(1).max(200);
/** Model IDs are local to the output. Persistence assigns real document/revision IDs. */
export const linkedCanvasesOutputSchema = z.object({
  explanation: z.string().min(1),
  rootCanvas: gridOutputId,
  // Plain union exports anyOf; discriminatedUnion exports oneOf, which Codex strict output rejects.
  // The distinct kind literals still make the two variants mutually exclusive.
  canvases: z.array(z.union([
    z.object({ kind: z.literal('new'), id: gridOutputId, name: z.string().trim().min(1).max(120),
      diagrams: alternativeOutputSchema.shape.diagrams, edges: alternativeOutputSchema.shape.edges }).strict(),
    z.object({ kind: z.literal('existing'), id: gridOutputId, sourceCanvas: gridOutputId,
      edits: z.array(z.object({ diagram: diagramId, ascii: z.string().min(1) }).strict()).max(100) }).strict()
  ])).min(2).max(20),
  jumps: z.array(z.object({
    source: z.object({ canvas: gridOutputId, diagram: diagramId, line: z.number().int().positive(),
      startColumn: z.number().int().positive(), endColumn: z.number().int().positive() }).strict(),
    target: z.object({ canvas: gridOutputId, diagram: diagramId.nullable(), line: z.number().int().positive().nullable() }).strict()
  }).strict()).min(1).max(1000)
}).strict();
export type LinkedCanvasesOutput = z.infer<typeof linkedCanvasesOutputSchema>;

export const linkedCanvasesInstructions = `Return JSON matching output-schema.json: {explanation, rootCanvas, canvases, jumps}.
Produce 2–20 canvases. Each canvas has a short unique id. A new canvas is {kind:"new",id,name,diagrams:[{id,ascii,position:{column,row}}],edges:[{source:{diagram,line},target:{diagram,line},label}]}. An existing canvas is {kind:"existing",id,sourceCanvas,edits:[{diagram,ascii}]}; sourceCanvas is the c1/c2/etc key from canvases.json. Include every supplied canvas exactly once. Existing canvases retain their diagrams, positions, edges and evidence; edits replace only the named diagram's full ASCII. Use edits:[] for unchanged canvases. New diagram positions use nonnegative character-grid coordinates with room for their text.
Each jump is {source:{canvas,diagram,line,startColumn,endColumn},target:{canvas,diagram,line}}. Canvas references use output-local canvas IDs. New diagram references use their output-local IDs; existing diagram references use exact grid: IDs from canvases.json. Source spans are on one line, 1-based and inclusive, measured after edits. Target diagram may be null to open the whole canvas; target line may be null to focus the diagram. A target line requires a diagram and must identify a meaningful concept line. Jumps must connect different canvases. Do not invent persisted document/revision IDs.
The jumps array is the complete inter-canvas navigation for this output: preserve useful existing links explicitly, accounting for edited text and renamed canvas IDs. Do not overlap jump source spans. Every canvas must be reachable from rootCanvas by directed jumps. Put the intended starting canvas in rootCanvas; the viewer opens it first. Explain the topology. Use actual LF newlines in ASCII. Return no prose outside JSON. If validation-error.json exists, read it and previous-output.json and correct the output.`;
