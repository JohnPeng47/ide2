import { z } from 'zod';
import { repositoryContextSchema } from './agentContextRepository';
import { captureSourceRangeSchema } from './agentContextSource';
import { agentContextSnapshotSchema, contextSectionSchema } from './agentContext';

export const savedAgentContextIdSchema = z.string().regex(/^saved-agent-context-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
export const agentContextGroupSchema = z.string().trim().min(1).max(120);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const agentContextLineageSchema = z.object({
  parentAgentContextId: savedAgentContextIdSchema, parentContentHash: contentHashSchema
}).strict();
export const agentContextCommentSchema = z.object({
  commentId: z.string().uuid(), text: z.string().trim().min(1).max(2000),
  createdAt: z.string().datetime(), contentHash: contentHashSchema
}).strict();
export const forkAgentContextSchema = z.object({
  requestId: z.string().uuid().toLowerCase(), agentContextId: savedAgentContextIdSchema,
  expectedContentHash: contentHashSchema, name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(), group: agentContextGroupSchema.nullable().optional()
}).strict();
export const addAgentContextCommentSchema = z.object({
  requestId: z.string().uuid().toLowerCase(), agentContextId: savedAgentContextIdSchema,
  expectedContentHash: contentHashSchema, text: z.string().trim().min(1).max(2000)
}).strict();
const captureConstituentSchema = z.union([z.object({ type: z.literal('text'), text: z.string().min(1).max(1_000_000) }).strict(), captureSourceRangeSchema, repositoryContextSchema]);
export const captureContextSectionSchema = contextSectionSchema.extend({ content: z.array(captureConstituentSchema).min(1).max(1000) });
export const createAgentContextSchema = z.object({
  requestId: z.string().uuid().toLowerCase(), name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  group: agentContextGroupSchema.optional(),
  context: z.union([z.string().trim().min(1).max(1_000_000), agentContextSnapshotSchema, z.array(z.union([captureConstituentSchema, captureContextSectionSchema])).min(1).max(1000)])
}).strict();
export const readAgentContextSchema = z.object({ agentContextId: savedAgentContextIdSchema }).strict();
export const updateAgentContextSchema = z.object({ agentContextId: savedAgentContextIdSchema, group: agentContextGroupSchema.nullable() }).strict();
export const listAgentContextsSchema = z.object({ query: z.string().max(200).default(''), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict();
export const savedAgentContextSchema = z.object({
  schemaVersion: z.literal(1), agentContextId: savedAgentContextIdSchema,
  name: z.string(), description: z.string(), createdAt: z.string().datetime(), requestHash: z.string(),
  group: agentContextGroupSchema.optional(),
  lineage: agentContextLineageSchema.optional(),
  comments: z.array(agentContextCommentSchema).optional(),
  snapshot: agentContextSnapshotSchema
}).strict();
export type SavedAgentContext = z.infer<typeof savedAgentContextSchema>;
export function summarizeAgentContext(record: SavedAgentContext) {
  return { agentContextId: record.agentContextId, name: record.name, description: record.description, createdAt: record.createdAt,
    ...(record.group !== undefined ? { group: record.group } : {}),
    ...(record.lineage ? { lineage: record.lineage } : {}),
    ...(record.comments ? { comments: record.comments } : {}),
    contentHash: record.snapshot.contentHash, messageCount: record.snapshot.messages.length, source: record.snapshot.source };
}
export const agentContextToolDefinitions = [
  { name: 'fork-agent-context' as const, schema: forkAgentContextSchema, description: 'Fork a saved AgentContext into a new saved ID, copying its pinned snapshot and recording parent ID and expectedContentHash as lineage. Requires name and UUID requestId; inherits description and group unless overridden (group:null clears it). Comments remain on the original. Retry identical arguments/requestId safely, even after editing the fork. Edit the fork on disk, recompute its snapshot hash, and add a one-sentence change explanation with add-agent-context-comment before use. Requires Workspace access; no canvas needed.' },
  { name: 'add-agent-context-comment' as const, schema: addAgentContextCommentSchema, description: 'Append a metadata comment to a saved AgentContext without changing model-visible content or its hash. Supply UUID requestId, agentContextId, current expectedContentHash, and text. The comment records this content hash and timestamp. Repeating identical arguments/requestId adds no duplicate. Requires Workspace access; no canvas needed.' },
  { name: 'read-agent-context-lineage' as const, schema: readAgentContextSchema, description: 'Trace saved AgentContext ancestors from root to the selected context, returning metadata and whether each pinned parent hash still matches its current parent. Reads no model-visible text and launches no model. Missing or cyclic ancestry fails explicitly.' },
  { name: 'update-agent-context' as const, schema: updateAgentContextSchema, description: 'Set saved AgentContext group metadata, or clear it with group: null. Does not change the immutable context snapshot or contentHash. Requires Workspace access; no live canvas is needed. Repeating the same assignment is safe.' },
  { name: 'create-agent-context' as const, schema: createAgentContextSchema, description: 'Save reusable context to disk and return its global agentContextId and contentHash. Supply name, optional description and group metadata, context (plain text, a validated AgentContextSnapshot, or an array of text/sourceFile/repository constituents and ContextSections). A ContextSection is {type:"section", name, content:[text/sourceFile/repository constituents]}: one named level inside this context, distinct from the outer group. Sections preserve order, are included in the content hash, and are rendered with labeled boundaries to the model. A sourceFile specifies a registered sourceId, relative path, optional 1-based inclusive startLine/endLine, and optional Git revision. Files are pinned at creation and resolved lazily; unchanged Git files need no copied source blob. A repository constituent is {type:"repository", task, repositoryPath, commit, exclusions}: an absolute local Git repository, full commit SHA, and repository-relative exclusion globs. It stores no source bytes. Its visible, hashed instructions require selective discovery; eval execution provides an isolated pinned checkout directory, normal shell and file-reading tools, and a persisted tool transcript. Other runtimes must explicitly support repository browsing. Supply a unique UUID requestId. Context is explicit: this does not capture the current chat automatically. IDs work across canvases and chats in this application store and survive restarts. Retry the same arguments/requestId after an uncertain outcome. Requires Workspace access.' },
  { name: 'list-agent-contexts' as const, schema: listAgentContextsSchema, description: 'Browse saved AgentContexts by name/description with query, offset and limit. Returns summaries and nextOffset, without loading conversation text into the chat. IDs can be passed to gen-alternatives or prompt-driven diagram generation.' },
  { name: 'read-agent-context' as const, schema: readAgentContextSchema, description: 'Read one immutable saved AgentContext by global agentContextId, including its compact snapshot and contentHash. Source references are expanded separately in resolvedSnapshot when present; the saved snapshot and its hash remain unchanged. This does not change the current conversation or launch a model.' }
];
