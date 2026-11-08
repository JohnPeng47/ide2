import type { AgentContextSources } from '../../core/ports/agentContextSources';
import type { AgentContextRepository } from '../../core/ports/agentContextRepository';
import { AgentContext, agentContextSourceRanges } from '../../../domain/core/agents/agentContext';
import type { CaptureSourceRange } from '../../../domain/core/agents/agentContextSource';
import { createAgentContextSchema, forkAgentContextSchema, addAgentContextCommentSchema, listAgentContextsSchema, readAgentContextSchema, updateAgentContextSchema, summarizeAgentContext } from '../../../domain/core/agents/savedAgentContext';
import { sha256 } from '../../../domain/core/sha256';

export class AgentContextLibrary {
  constructor(private readonly store: AgentContextRepository, private readonly sources?: AgentContextSources) {}
  async fork(raw: unknown) {
    const input = forkAgentContextSchema.parse(raw);
    const requestHash = sha256(JSON.stringify(['fork', input]));
    const agentContextId = `saved-agent-context-${input.requestId}`;
    const previous = await this.store.read(agentContextId);
    if (previous) {
      if (previous.requestHash !== requestHash) throw Error('REQUEST_ID_CONFLICT: this UUID identifies a different saved context');
      return summarizeAgentContext(previous);
    }
    const parent = await this.store.read(input.agentContextId);
    if (!parent) throw Error('AGENT_CONTEXT_NOT_FOUND: parent context is unavailable');
    if (parent.snapshot.contentHash !== input.expectedContentHash) throw Error('AGENT_CONTEXT_CHANGED: reread the parent before forking');
    const group = input.group === undefined ? parent.group : input.group ?? undefined;
    return summarizeAgentContext(await this.store.create({ schemaVersion: 1, agentContextId,
      name: input.name, description: input.description ?? parent.description, ...(group !== undefined ? { group } : {}),
      createdAt: new Date().toISOString(), requestHash, snapshot: parent.snapshot,
      lineage: { parentAgentContextId: parent.agentContextId, parentContentHash: parent.snapshot.contentHash } }));
  }
  async addComment(raw: unknown) {
    return summarizeAgentContext(await this.store.addComment(addAgentContextCommentSchema.parse(raw)));
  }
  async lineage(raw: unknown) {
    const { agentContextId } = readAgentContextSchema.parse(raw);
    const ancestors = [], seen = new Set<string>();
    let id: string | undefined = agentContextId;
    while (id) {
      if (seen.has(id)) throw Error('INVALID_AGENT_CONTEXT_LINEAGE: cyclic ancestry');
      seen.add(id);
      const record = await this.store.read(id);
      if (!record) throw Error('AGENT_CONTEXT_NOT_FOUND: ancestor is unavailable');
      ancestors.push(summarizeAgentContext(record)); id = record.lineage?.parentAgentContextId;
    }
    return { items: ancestors.reverse().map((item, index, items) => ({ ...item,
      ...(item.lineage ? { parentMatches: index > 0 && item.lineage.parentContentHash === items[index - 1].contentHash } : {}) })) };
  }
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
      const capture = async (block: CaptureSourceRange | { type: 'text'; text: string }) => {
        if (block.type === 'text') return block;
        else {
          if (!this.sources) throw Error('AGENT_CONTEXT_SOURCE_UNAVAILABLE');
          return this.sources.capture(block);
        }
      };
      for (const block of input.context) {
        if (block.type === 'section') {
          const children = [];
          for (const child of block.content) children.push(await capture(child));
          content.push({ ...block, content: children });
        } else content.push(await capture(block));
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
    const resolvedSnapshot = resolveSources && agentContextSourceRanges(snapshot.messages).length
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
