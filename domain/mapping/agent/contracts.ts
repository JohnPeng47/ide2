import { diagramJumpSchema } from '../../core/diagrams/diagramJump';
import { z } from 'zod';
import { diagramConnectionSchema } from '../../core/diagrams/diagramConnection';
export const idSchema = z.string().min(1).max(200);
const point = z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative() }).strict();
const mapping = z.object({ id: idSchema, entityId: idSchema, sourceRangeIndex: z.number().int().nonnegative(), sourceRangeId: z.string().optional(), line: z.number().int().positive(), startColumn: z.number().int().positive(), endColumn: z.number().int().positive() }).strict();
const sourceRange = z.object({ id: idSchema, path: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive(), originalLines: z.array(z.string()), symbol: z.string().optional(), compactionId: z.string().optional() }).strict();
const evidence = z.record(z.string(), z.object({ id: idSchema, sourceId: idSchema.optional(), handle: z.string(), label: z.string(), category: z.enum(['state','interface-data-struct','operation']), summary: z.string(), sourceRanges: z.array(sourceRange) }).strict());
const sourceBinding = z.object({sourceId: idSchema, repositoryIdentity: z.string().min(1), domainProfileId: z.enum(['source-code','document']),
  corpus: z.discriminatedUnion('kind', [z.object({kind:z.literal('git-worktree'),root:z.string().min(1),revision:z.string().optional()}).strict(),
    z.object({kind:z.literal('filesystem-documents'),root:z.string().min(1)}).strict()])}).strict();
export const contentFields = { ascii: z.string().min(1).max(20000), structureKind: z.enum(['diagram', 'tree']).optional(), mappings: z.array(mapping).max(2000).optional(), evidence: evidence.optional(), source: sourceBinding.optional() };
export const drawSchema = z.object({ sessionId: idSchema, requestId: idSchema, expectedVersion: z.number().int().nonnegative(), nodeId: idSchema.optional(), parentId: idSchema.optional(), position: point.optional(), ...contentFields }).strict();
export const saveSchema = z.object({ sessionId: idSchema, requestId: idSchema, expectedVersion: z.number().int().nonnegative(), nodeId: idSchema.optional(), name: z.string().trim().min(1).max(120), representationId: idSchema.optional(), expectedRevisionId: idSchema.optional() }).strict();
export const searchSchema = z.object({ operation: z.enum(['search','read']), mode: z.enum(['text','node','code-reference']).optional(), query: z.string().max(1000).optional(), representationId: idSchema.optional(), revisionId: idSchema.optional(), sessionId: idSchema.optional(), nodeId: idSchema.optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict();
export const execSchema = z.object({ code: z.string().min(1).max(30000), sessionId: idSchema.optional(), requestId: idSchema, expectedVersion: z.number().int().nonnegative().optional() }).strict();
export const apiSearchSchema = z.object({ query: z.string().max(1000).default('') }).strict();
export const agentToolSchemas = { 'diagram-search': searchSchema, 'canvas-api-search': apiSearchSchema, exec: execSchema, draw_diagram: drawSchema, save_diagram: saveSchema };
export type AgentToolName = keyof typeof agentToolSchemas;

export const canvasMethods = {
  'nodes.setJumps': { schema: z.object({ nodeId: idSchema, jumps: z.array(diagramJumpSchema).max(2000) }).strict(), description: 'Replace diagram-local jumps without changing ASCII. Source ranges are original 1-based inclusive columns on the current content revision/hash; contentNodeId is optional. Target representationId is a saved catalog canvas ID, not a live canvasId. Empty list removes all jumps. Undoable; explicit save required.', example: 'return nodes.setJumps({nodeId:"grid:overview",jumps:[]});' },
  'edges.list': { schema: z.object({}).strict(), description: 'Read saved diagram connections. Endpoint displayNodeId identifies a GridBox instance; contentNodeId and revisionId come from nodes.get contentNodes and content.', example: 'return edges.list();' },
  'edges.create': { schema: diagramConnectionSchema.omit({ id: true }), description: 'Connect a content node to another content node or GridBox. Does not change diagram content.', example: 'return edges.create({source, target, appearance:{color:"#7dd3fc",lineStyle:"solid",label:""}});' },
  'edges.update': { schema: diagramConnectionSchema, description: 'Replace a connection by ID, including endpoints or appearance. Unchanged stale endpoints may be retained.', example: 'return edges.update({...edge, appearance:{...edge.appearance,label:"Uses"}});' },
  'edges.remove': { schema: z.object({ edgeId: idSchema }).strict(), description: 'Remove one connection without deleting either diagram.', example: 'return edges.remove({edgeId:"…"});' },
  'canvas.list': { schema: z.object({}).strict(), description: 'List registered live Mapping pages and their documents.', example: 'return canvas.list();' },
  'canvas.attach': { schema: z.object({ canvasId: idSchema, documentId: idSchema }).strict(), description: 'Bind a new session to a live document. Use returned sessionId on subsequent calls.', example: 'return canvas.attach({canvasId:"…",documentId:"…"});' },
  'canvas.createDocument': { schema: z.object({ canvasId: idSchema, name: z.string().trim().min(1).max(120) }).strict(), description: 'Create an unsaved document and attach a session. Does not create a confirmed representation.', example: 'return canvas.createDocument({canvasId:"…",name:"Proposed design"});' },
  'nodes.list': { schema: z.object({}).strict(), description: 'Read the DisplayNode registry including GridBoxes and FloatingBoxes.', example: 'return nodes.list();' },
  'nodes.get': { schema: z.object({ nodeId: idSchema }).strict(), description: 'Read a complete DisplayNode and its diagram content.', example: 'return nodes.get({nodeId:"grid:overview"});' },
  'nodes.draw': { schema: z.object({ ...contentFields, parentId: idSchema.optional(), position: point.optional() }).strict(), description: 'Create a diagram; natural content size feeds push-right grid layout. Position is parent-relative cells.', example: 'return nodes.draw({ascii:"[Service]",position:{column:0,row:0}});' },
  'nodes.replace': { schema: z.object({ nodeId: idSchema, ...contentFields }).strict(), description: 'Replace diagram content and rerun layout.', example: 'return nodes.replace({nodeId:"grid:overview",ascii:"[Updated]"});' },
  'nodes.move': { schema: z.object({ nodeId: idSchema, position: z.union([point, z.object({ x: z.number().finite(), y: z.number().finite() }).strict()]) }).strict(), description: 'Move GridBoxes in absolute canvas cells; FloatingBoxes in pixels in their declared coordinate space.', example: 'return nodes.move({nodeId:"grid:overview",position:{column:20,row:4}});' },
  'nodes.collapse': { schema: z.object({ nodeId: idSchema, contentNodeId: idSchema.optional(), collapsed: z.boolean() }).strict(), description: 'Collapse/expand a DisplayNode, or a content subtree using contentNodeId from node.collapsible.subtrees.', example: 'return nodes.collapse({nodeId:"grid:overview",collapsed:true});' },
  'nodes.remove': { schema: z.object({ nodeId: idSchema }).strict(), description: 'Remove an object. The root and last visible diagram are protected.', example: 'return nodes.remove({nodeId:"floating:…"});' }
} as const;
export function canvasApiSpec(query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.entries(canvasMethods).filter(([name, entry]) => terms.every(term => `${name} ${entry.description}`.toLowerCase().includes(term)))
    .map(([name, entry]) => ({ name, description: entry.description, inputSchema: z.toJSONSchema(entry.schema), example: entry.example }));
}
export interface CanvasDescriptor { canvasId: string; projectId?: string; documents: { documentId: string; name: string; representationId?: string }[] }
export interface CanvasCommand { id: string; method: 'snapshot' | 'apply' | 'create-document' | 'saved'; documentId?: string; payload?: unknown }
export interface LiveDocumentSnapshot {
  endpointBounds?: import('../workspace/endpointGeometry').EndpointBounds;
  cell?: { width: number; height: number };
  document: import('../workspace/mappingGrid').MappingGridDocument;
  canvas: import('../workspace/mappingWorkspace').MappingCanvasState;
  version: number; name: string; representationId?: string; revisionId?: string;
}
