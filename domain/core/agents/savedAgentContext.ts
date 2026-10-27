import { z } from 'zod';
import { agentContextSnapshotSchema } from './agentContext';

export const savedAgentContextIdSchema = z.string().regex(/^saved-agent-context-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const createAgentContextSchema = z.object({
  requestId: z.string().uuid().toLowerCase(), name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  context: z.union([z.string().trim().min(1).max(1_000_000), agentContextSnapshotSchema])
}).strict();
export const readAgentContextSchema = z.object({ agentContextId: savedAgentContextIdSchema }).strict();
export const listAgentContextsSchema = z.object({ query: z.string().max(200).default(''), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict();
export const savedAgentContextSchema = z.object({
  schemaVersion: z.literal(1), agentContextId: savedAgentContextIdSchema,
  name: z.string(), description: z.string(), createdAt: z.string().datetime(), requestHash: z.string(),
  snapshot: agentContextSnapshotSchema
}).strict();
export type SavedAgentContext = z.infer<typeof savedAgentContextSchema>;
export function summarizeAgentContext(record: SavedAgentContext) {
  return { agentContextId: record.agentContextId, name: record.name, description: record.description, createdAt: record.createdAt,
    contentHash: record.snapshot.contentHash, messageCount: record.snapshot.messages.length, source: record.snapshot.source };
}
export const agentContextToolDefinitions = [
  { name: 'create-agent-context' as const, schema: createAgentContextSchema, description: 'Save immutable reusable context to disk and return its global agentContextId and contentHash. Supply name, optional description, context (plain background text or a validated AgentContextSnapshot), and a unique UUID requestId. Context is explicit: this does not capture the current chat automatically. IDs work across canvases and chats in this application store and survive restarts. Retry the same arguments/requestId after an uncertain outcome. Requires Workspace access.' },
  { name: 'list-agent-contexts' as const, schema: listAgentContextsSchema, description: 'Browse saved AgentContexts by name/description with query, offset and limit. Returns summaries and nextOffset, without loading conversation text into the chat. IDs can be passed to gen-alternatives or prompt-driven diagram generation.' },
  { name: 'read-agent-context' as const, schema: readAgentContextSchema, description: 'Read one immutable saved AgentContext by global agentContextId, including its snapshot and contentHash. This does not change the current conversation or launch a model.' }
];
