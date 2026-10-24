import { z } from 'zod';
import { agentContextSnapshotSchema, type AgentContextSnapshot } from '../../core/agents/agentContext';
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
  /** Panel-owned conversation identity and its last completed context. */
  llmSessionId: id.optional(),
  agentContext: agentContextSnapshotSchema.optional(),
  template: promptTemplateSelectionSchema.optional(),
  /** The instruction cites references[N-1] as [ref N]. */
  references: z.array(promptReferenceSchema).max(20).optional()
};
export const editModeSchema = z.enum(['in-place', 'variant']);
export const replaceModeSchema = z.enum(['diagram', 'subnode-single', 'multi-contiguous', 'multi-disjoint']);
const subtreeSchema = z.object({ contentNodeId: z.string().min(1).max(500), revisionId: id }).strict();
const generationSchema = z.object({
  'source-mappings': z.boolean().optional().describe('Defaults to false. Enable to supply new source mappings.'),
  sessionId: id, nodeId: id, expectedVersion: z.number().int().nonnegative(),
  'edit-mode': editModeSchema.optional(),
  'replace-mode': replaceModeSchema.optional(),
  variant: z.object({ name: z.string().trim().min(1).max(120), count: z.number().int().min(1).max(4).default(1), variantId: id.optional() }).strict().optional(),
  subtree: subtreeSchema.optional(),
  subtrees: z.array(subtreeSchema).min(2).max(100).optional(),
  origin: z.object({ column: z.number().int().nonnegative(), row: z.number().int().nonnegative() }).strict().optional(),
  sources: z.array(contentNodeAnchorSchema).max(500).optional(),
  baseRevisionId: id, agentContextId: id.optional(), prompt: z.string().trim().min(1).max(20000), requestId: id, ...promptFields
}).strict();
export const editDiagramSchema = generationSchema.extend({
  'edit-mode': editModeSchema.describe('Required. in-place applies the edit; variant saves an alternative.'),
  'replace-mode': replaceModeSchema.describe('Required. diagram: no subtree targets; subnode-single: subtree; multi-contiguous: adjacent subtrees; multi-disjoint: separate subtrees. Supply subtrees for either multi mode.')
}).strict();
/** nodeId/baseRevisionId pin the anchor diagram: its revision is the context and new diagrams are placed beside it. */
export const createDiagramSchema = generationSchema.extend({ count: z.number().int().min(1).max(4).optional() }).strict();
export const extendDiagramSchema = generationSchema.extend({ origin: editDiagramSchema.shape.origin.unwrap(), sources: z.array(contentNodeAnchorSchema).min(1).max(500) }).strict();
export const diagramEditRunSchema = z.object({ runId: id }).strict();
export type EditDiagramInput = z.infer<typeof editDiagramSchema>;
export type CreateDiagramInput = z.infer<typeof createDiagramSchema>;
export interface DiagramRevisionApplication {
  variants?: { variant: import('../../core/diagrams/diagramRevisionReview').DiagramRevisionReview; revision: DiagramRevision }[];
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
  variants?: { id: string; name: string; revisionId: string }[];
  /** Actual runtime session for diagnostics/clipboard; each run may have a new ID. */
  agentSessionId?: string;
  /** Updated conversation, published only after the canvas acknowledges success. */
  agentContext?: AgentContextSnapshot;
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
