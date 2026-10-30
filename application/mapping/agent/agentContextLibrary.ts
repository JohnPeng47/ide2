import type { AgentContextSources } from '../../core/ports/agentContextSources';
import type { AgentContextRepository } from '../../core/ports/agentContextRepository';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { createAgentContextSchema, listAgentContextsSchema, readAgentContextSchema, updateAgentContextSchema, summarizeAgentContext } from '../../../domain/core/agents/savedAgentContext';
import { sha256 } from '../../../domain/core/sha256';

export class AgentContextLibrary {
  constructor(private readonly store: AgentContextRepository, private readonly sources?: AgentContextSources) {}
  async create(raw: unknown) {
    const input = createAgentContextSchema.parse(raw);
    // Preserve legacy creation hashes when no group was supplied. Metadata updates never rewrite this receipt.
    const groupHashInput = input.group === undefined ? [] : [input.group];
    const constituentRequestHash = Array.isArray(input.context) ? sha256(JSON.stringify([input.name, input.description, input.context, ...groupHashInput])) : undefined;
    if (constituentRequestHash) {
      const previous = await this.store.read(`saved-agent-context-${input.requestId}`);
      if (previous) {
        if (previous.requestHash !== constituentRequestHash) throw Error('REQUEST_ID_CONFLICT: this UUID identifies a different saved context');
        return summarizeAgentContext(previous);
      }
    }
    let content: import('../../../domain/core/agents/agentContext').AgentContextMessage['content'] | undefined;
    if (typeof input.context === 'string') content = [{ type: 'text', text: input.context }];
    else if (Array.isArray(input.context)) {
      content = [];
      // Bound peak capture memory even for many file constituents.
      for (const block of input.context) {
        if (block.type === 'text') content.push(block);
        else {
          if (!this.sources) throw Error('AGENT_CONTEXT_SOURCE_UNAVAILABLE');
          content.push(await this.sources.capture(block));
        }
      }
    }
    const context = content ? AgentContext.fromTrajectory({
      agentType: 'saved-context', sourceSessionId: input.requestId, format: 'messages-v1', fromEntryId: 'context', throughEntryId: 'context',
      entries: [{ id: 'context', parentId: null, message: { role: 'user', content, timestamp: 0 } }]
    }) : AgentContext.fromSnapshot(input.context);
    const requestHash = constituentRequestHash ?? sha256(JSON.stringify([input.name, input.description, context.contentHash, ...groupHashInput]));
    if (!constituentRequestHash) {
      const previous = await this.store.read(`saved-agent-context-${input.requestId}`);
      if (previous) {
        if (previous.requestHash !== requestHash) throw Error('REQUEST_ID_CONFLICT: this UUID identifies a different saved context');
        return summarizeAgentContext(previous);
      }
    }
    const snapshot = this.sources ? await this.sources.persist(context.toSnapshot()) : context.toSnapshot();
    const record = await this.store.create({ schemaVersion: 1, agentContextId: `saved-agent-context-${input.requestId}`,
      name: input.name, description: input.description, ...(input.group !== undefined ? { group: input.group } : {}), createdAt: new Date().toISOString(), snapshot,
      requestHash });
    return summarizeAgentContext(record);
  }
  async update(raw: unknown) {
    const { agentContextId, group } = updateAgentContextSchema.parse(raw);
    return summarizeAgentContext(await this.store.updateGroup(agentContextId, group));
  }
  async read(id: string, resolveSources = true) {
    readAgentContextSchema.parse({ agentContextId: id });
    const record = await this.store.read(id);
    if (!record) throw Error('AGENT_CONTEXT_NOT_FOUND: saved context is unavailable');
    const snapshot = AgentContext.fromSnapshot(record.snapshot).toSnapshot();
    const resolvedSnapshot = resolveSources && snapshot.messages.some(m => m.content.some(b => b.type === 'sourceRange'))
      ? (await AgentContext.fromSnapshot(snapshot).resolveSources(this.sources ? ref => this.sources!.read(ref) : undefined)).toSnapshot() : undefined;
    return { ...summarizeAgentContext(record), snapshot, ...(resolvedSnapshot ? { resolvedSnapshot } : {}) };
  }
  async list(raw: unknown = {}) {
    const { query, offset, limit } = listAgentContextsSchema.parse(raw);
    const items = (await this.store.summaries()).filter(item => `${item.name}\n${item.description}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.agentContextId.localeCompare(b.agentContextId));
    return { items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null };
  }
}
