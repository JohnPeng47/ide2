import { z } from 'zod';
import { sha256 } from '../sha256';

export const AGENT_CONTEXT_MAX_BYTES = 2 * 1024 * 1024;
const id = z.string().min(1).max(200);
const text = z.object({ type: z.literal('text'), text: z.string().max(1_000_000) }).strict();
const toolCall = z.object({ type: z.literal('toolCall'), id, name: id, arguments: z.record(z.string(), z.json()) }).strict();
const timestamp = z.number().int().nonnegative().default(0);
export const agentContextMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), content: z.array(text).min(1).max(1000), timestamp }).strict(),
  z.object({ role: z.literal('assistant'), content: z.array(z.union([text, toolCall])).min(1).max(1000), timestamp }).strict(),
  z.object({ role: z.literal('toolResult'), toolCallId: id, toolName: id,
    content: z.array(text).min(1).max(1000), isError: z.boolean().default(false), timestamp }).strict()
]);
export type AgentContextMessage = z.infer<typeof agentContextMessageSchema>;
const entrySchema = z.object({ id, parentId: id.nullable(), message: agentContextMessageSchema }).strict();
export const agentTrajectorySchema = z.object({
  agentType: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), sourceSessionId: id,
  format: z.literal('messages-v1'), fromEntryId: id, throughEntryId: id,
  entries: z.array(entrySchema).min(1).max(2000)
}).strict();
export type AgentTrajectoryInput = z.input<typeof agentTrajectorySchema>;
const snapshotDataSchema = z.object({
  version: z.literal(1),
  source: agentTrajectorySchema.pick({ agentType: true, sourceSessionId: true, format: true }),
  range: agentTrajectorySchema.pick({ fromEntryId: true, throughEntryId: true }),
  messages: z.array(agentContextMessageSchema).min(1).max(2000)
}).strict();
export const agentContextSnapshotSchema = snapshotDataSchema.extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) });
export type AgentContextSnapshot = z.infer<typeof agentContextSnapshotSchema>;

/** Canonical JSON also stabilizes tool arguments whose object key order differs. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function bounded(input: unknown) {
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > AGENT_CONTEXT_MAX_BYTES)
    throw Error('AGENT_CONTEXT_TOO_LARGE: context exceeds 2 MiB');
}
function validateMessages(messages: AgentContextMessage[]) {
  const pending = new Map<string, string>(), seen = new Set<string>();
  for (const message of messages) {
    if (message.role === 'toolResult') {
      if (pending.get(message.toolCallId) !== message.toolName)
        throw Error('INVALID_AGENT_CONTEXT: orphan, duplicate or mismatched tool result');
      pending.delete(message.toolCallId);
    } else {
      if (pending.size) throw Error('INVALID_AGENT_CONTEXT: missing tool results before next message');
      if (message.role === 'assistant') for (const block of message.content) if (block.type === 'toolCall') {
        if (seen.has(block.id)) throw Error('INVALID_AGENT_CONTEXT: duplicate tool call ID');
        seen.add(block.id); pending.set(block.id, block.name);
      }
    }
  }
  if (pending.size) throw Error('INVALID_AGENT_CONTEXT: slice ends before tool results');
}

/** Captured trajectory value. All parsing/conversion lives here; no SDK or I/O dependency. */
export class AgentContext {
  readonly #snapshot: AgentContextSnapshot;
  private constructor(snapshot: AgentContextSnapshot) { this.#snapshot = structuredClone(snapshot); }
  get contentHash() { return this.#snapshot.contentHash; }

  static fromTrajectory(raw: unknown): AgentContext {
    bounded(raw);
    const input = agentTrajectorySchema.parse(raw);
    const entries = new Map(input.entries.map(entry => [entry.id, entry]));
    if (entries.size !== input.entries.length) throw Error('INVALID_AGENT_CONTEXT: duplicate entry ID');
    const selected: AgentContextMessage[] = [], visited = new Set<string>();
    let cursor: string | null = input.throughEntryId;
    while (cursor !== null) {
      if (visited.has(cursor)) throw Error('INVALID_AGENT_CONTEXT: cyclic trajectory');
      visited.add(cursor);
      const entry = entries.get(cursor);
      if (!entry) throw Error('INVALID_AGENT_CONTEXT: missing entry on selected branch');
      selected.push(entry.message);
      if (cursor === input.fromEntryId) break;
      cursor = entry.parentId;
    }
    if (cursor !== input.fromEntryId) throw Error('INVALID_AGENT_CONTEXT: range is not on one branch');
    const messages = selected.reverse();
    validateMessages(messages);
    const data = snapshotDataSchema.parse({ version: 1,
      source: { agentType: input.agentType, sourceSessionId: input.sourceSessionId, format: input.format },
      range: { fromEntryId: input.fromEntryId, throughEntryId: input.throughEntryId }, messages });
    return new AgentContext({ ...data, contentHash: sha256(canonical(data)) });
  }

  static fromSnapshot(raw: unknown): AgentContext {
    bounded(raw);
    const snapshot = agentContextSnapshotSchema.parse(raw);
    const { contentHash, ...data } = snapshot;
    if (contentHash !== sha256(canonical(data))) throw Error('INVALID_AGENT_CONTEXT: content hash mismatch');
    validateMessages(snapshot.messages);
    return new AgentContext(snapshot);
  }

  toSnapshot(): AgentContextSnapshot { return structuredClone(this.#snapshot); }

  toPiMessages() {
    return this.toSnapshot().messages.map(message => {
      if (message.role !== 'assistant') return message;
      // Synthetic provenance marks imported history; it never selects the run's model.
      return { ...message, api: 'openai-responses' as const, provider: 'agent-context', model: this.#snapshot.source.agentType,
        stopReason: message.content.some(block => block.type === 'toolCall') ? 'toolUse' as const : 'stop' as const,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    });
  }
}
