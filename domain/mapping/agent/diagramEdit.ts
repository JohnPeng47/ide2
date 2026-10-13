import { z } from 'zod';
import { contentNodeAnchorSchema, type ContentNodeAnchor } from '../../core/diagrams/diagramConnection';
import type { DiagramInput } from '../../core/diagrams/diagram';
import type { DiagramRevision } from '../../core/diagrams/diagramRevisionEditor';
import { promptTemplateSelectionSchema, type PromptOperation } from './promptTemplates';

const id = z.string().min(1).max(200);
const label = z.string().trim().min(1).max(200);
const line = z.number().int().positive();
/** References are pinned to an immutable revision when inserted; later canvas changes never alter them. */
export const promptReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diagram'), label, diagramId: id, revisionId: id }).strict(),
  z.object({ kind: z.literal('nodes'), label, diagramId: id, revisionId: id, nodeIds: z.array(id).max(500),
    range: z.object({ startLine: line, endLine: line, startColumn: line, endColumn: line }).strict()
      .refine(range => range.startLine <= range.endLine && range.startColumn <= range.endColumn, 'Invalid node range') }).strict()
]);
export type PromptReference = z.infer<typeof promptReferenceSchema>;
const promptFields = {
  template: promptTemplateSelectionSchema.optional(),
  /** The instruction cites references[N-1] as [ref N]. */
  references: z.array(promptReferenceSchema).max(20).optional()
};
export const editDiagramSchema = z.object({
  sessionId: id, nodeId: id, expectedVersion: z.number().int().nonnegative(),
  subtree: z.object({ contentNodeId: z.string().min(1).max(500), revisionId: id }).strict().optional(),
  origin: z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative() }).strict().optional(),
  sources: z.array(contentNodeAnchorSchema).max(500).optional(),
  baseRevisionId: id, agentContextId: id.optional(), prompt: z.string().trim().min(1).max(20000), requestId: id, ...promptFields
}).strict();
/** nodeId/baseRevisionId pin the anchor diagram: its revision is the context and new diagrams are placed beside it. */
export const createDiagramSchema = editDiagramSchema.extend({ count: z.number().int().min(1).max(4).optional() }).strict();
export const extendDiagramSchema = editDiagramSchema.extend({ origin: editDiagramSchema.shape.origin.unwrap(), sources: z.array(contentNodeAnchorSchema).min(1).max(500) }).strict();
export const diagramEditRunSchema = z.object({ runId: id }).strict();
export type EditDiagramInput = z.infer<typeof editDiagramSchema>;
export type CreateDiagramInput = z.infer<typeof createDiagramSchema>;
export interface DiagramRevisionApplication {
  requestId: string;
  expectedVersion: number;
  nodeId: string;
  baseRevisionId: string;
  revision: DiagramRevision;
}
/** A created diagram, placed by the canvas in one undoable update. */
export interface DiagramCreation {
  id: string; parentId?: string; position: { column: number; row: number };
  content: Omit<DiagramInput, 'id' | 'revision'>;
  sources?: ContentNodeAnchor[];
}
export interface DiagramEditRun {
  runId: string;
  operation: PromptOperation;
  status: 'generating' | 'applying' | 'completed' | 'conflict' | 'failed' | 'cancelled' | 'awaiting-acknowledgement';
  nodeId: string;
  baseRevisionId: string;
  message?: string;
  error?: string;
  generated?: { diagramId: string; revisionId: string; ascii: string };
  result?: { diagramId: string; previousRevisionId: string; revisionId: string; documentVersion: number; unresolvedEdgeIds: string[] };
  /** create-diagram only: the new canvas nodes, in generation order. */
  created?: { documentVersion: number; nodeIds: string[] };
}
