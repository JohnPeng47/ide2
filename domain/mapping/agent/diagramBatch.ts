import { z } from 'zod';
import { generatedDiagramEditSchema } from '../../core/diagrams/generatedDiagramEdit';
import { editDiagramSchema, createDiagramSchema, extendDiagramSchema, type DiagramRevisionApplication, type DiagramCreation, type DiagramEditRun } from './diagramEdit';

export const generationSchemas = { 'edit-diagram': editDiagramSchema, 'create-diagram': createDiagramSchema, 'extend-diagram': extendDiagramSchema };
export type DiagramTool = keyof typeof generationSchemas;
const envelope = { sessionId: z.string().min(1), expectedVersion: z.number().int().nonnegative(), requestId: z.string().min(1).max(200) };
const omitEnvelope = { sessionId: true, expectedVersion: true, requestId: true } as const;
const editItem = editDiagramSchema.omit(omitEnvelope);
const createItem = createDiagramSchema.omit(omitEnvelope);
const extendItem = extendDiagramSchema.omit(omitEnvelope);
export const generationBatchSchemas = {
  'edit-diagram': z.object({ ...envelope, operations: z.array(editItem).min(1).max(20) }).strict(),
  'create-diagram': z.object({ ...envelope, operations: z.array(createItem).min(1).max(20) }).strict(),
  'extend-diagram': z.object({ ...envelope, operations: z.array(extendItem).min(1).max(20) }).strict()
};
const directOmit = { prompt: true, template: true, references: true, llmSessionId: true, agentContext: true, agentContextId: true } as const;
export const directOperationSchemas = {
  'edit-diagram': editItem.omit(directOmit).extend({ edit: generatedDiagramEditSchema }).strict(),
  'create-diagram': createItem.omit({ ...directOmit, count: true, 'edit-mode': true, 'replace-mode': true, variant: true, subtree: true, subtrees: true }).extend({ diagram: generatedDiagramEditSchema }).strict(),
  'extend-diagram': extendItem.omit({ ...directOmit, 'edit-mode': true, 'replace-mode': true, variant: true, subtree: true, subtrees: true }).extend({ diagram: generatedDiagramEditSchema }).strict()
};
export const directBatchSchemas = {
  'edit-diagram': z.object({ ...envelope, operations: z.array(directOperationSchemas['edit-diagram']).min(1).max(20) }).strict(),
  'create-diagram': z.object({ ...envelope, operations: z.array(directOperationSchemas['create-diagram']).min(1).max(20) }).strict(),
  'extend-diagram': z.object({ ...envelope, operations: z.array(directOperationSchemas['extend-diagram']).min(1).max(20) }).strict()
};
export type DiagramBatchInput = z.infer<typeof generationBatchSchemas[DiagramTool]> | z.infer<typeof directBatchSchemas[DiagramTool]>;
export interface DiagramBatchApplication {
  requestId: string; expectedVersion: number;
  edits: DiagramRevisionApplication[]; creations: DiagramCreation[];
}
export interface DiagramBatchRun {
  runId: string; operation: DiagramTool;
  status: DiagramEditRun['status']; error?: string; operationIndex?: number; documentVersion?: number;
  results: { operationIndex: number; result?: DiagramEditRun['result']; created?: DiagramEditRun['created']; variants?: DiagramEditRun['variants'] }[];
}
export function isDiagramTool(name: string): name is DiagramTool { return Object.hasOwn(generationSchemas, name); }

export function directDiagramInstructions(operation: DiagramTool) {
  const task = operation === 'edit-diagram' ? 'Edit the supplied diagram according to the user instruction.'
    : operation === 'create-diagram' ? 'Create new diagrams according to the user instruction.'
    : 'Create new diagrams expanding the selected references, connected to the supplied source nodes.';
  return `# Task\n${task} Supply the resulting content yourself; this tool does not call another model.\n\n# Rules\n- Send operations as a batch on one canvas. Every operation addresses the same captured canvas snapshot; combine multiple edits of one diagram into one operation.\n- The batch validates before application and persists as one transaction and is one undo step. Results use zero-based operationIndex. Only status completed means applied and persisted; failed/conflict/cancelled results have not committed the batch.\n- Supply current baseRevisionId with nodeId, or use a revision-pinned reference in AgentChat. Never widen a selected node scope.\n${operation === 'edit-diagram' ? '- Both edit-mode (in-place | variant) and replace-mode (diagram | subnode-single | multi-contiguous | multi-disjoint) are required, without defaults. Supply subtree/subtrees in MCP or contentNodeIds (subtree roots) in AgentChat.\n' : '- Each operation creates one supplied diagram. extend-diagram requires origin and sources; create-diagram can use nodeId canvas with baseRevisionId canvas when no anchor is available.\n'}- Use a unique requestId. Retry identical arguments after an uncertain outcome. On validation failure, correct the indicated operation and use a new requestId.\n- Workspace access is required.\n\n`;
}
