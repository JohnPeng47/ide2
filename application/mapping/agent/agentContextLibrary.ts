import type { AgentContextRepository } from '../../core/ports/agentContextRepository';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { createAgentContextSchema, listAgentContextsSchema, readAgentContextSchema, summarizeAgentContext } from '../../../domain/core/agents/savedAgentContext';
import { sha256 } from '../../../domain/core/sha256';

export class AgentContextLibrary {
  constructor(private readonly store: AgentContextRepository) {}
  async create(raw: unknown) {
    const input = createAgentContextSchema.parse(raw);
    const snapshot = (typeof input.context === 'string' ? AgentContext.fromTrajectory({
      agentType: 'saved-context', sourceSessionId: input.requestId, format: 'messages-v1', fromEntryId: 'context', throughEntryId: 'context',
      entries: [{ id: 'context', parentId: null, message: { role: 'user', content: [{ type: 'text', text: input.context }], timestamp: 0 } }]
    }) : AgentContext.fromSnapshot(input.context)).toSnapshot();
    const record = await this.store.create({ schemaVersion: 1, agentContextId: `saved-agent-context-${input.requestId}`,
      name: input.name, description: input.description, createdAt: new Date().toISOString(), snapshot,
      requestHash: sha256(JSON.stringify([input.name, input.description, snapshot.contentHash])) });
    return summarizeAgentContext(record);
  }
  async read(id: string) {
    readAgentContextSchema.parse({ agentContextId: id });
    const record = await this.store.read(id);
    if (!record) throw Error('AGENT_CONTEXT_NOT_FOUND: saved context is unavailable');
    const snapshot = AgentContext.fromSnapshot(record.snapshot).toSnapshot();
    return { ...summarizeAgentContext(record), snapshot };
  }
  async list(raw: unknown = {}) {
    const { query, offset, limit } = listAgentContextsSchema.parse(raw);
    const items = (await this.store.summaries()).filter(item => `${item.name}\n${item.description}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.agentContextId.localeCompare(b.agentContextId));
    return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
  }
}
