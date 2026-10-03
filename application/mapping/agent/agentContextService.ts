import { randomUUID } from 'node:crypto';
import { AgentContext, type AgentContextSnapshot } from '../../../domain/core/agents/agentContext';

export interface AgentContextScope { workspaceInstanceId: string; documentId: string }
export interface AgentContextReceipt {
  agentContextId: string; contentHash: string; agentType: string; sourceSessionId: string; messageCount: number;
}
export class AgentContextError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Immutable uploads survive reader reconnects, bounded to this backend lifetime. */
export class AgentContextService {
  private records = new Map<string, { scope: string; context: AgentContext; receipt: AgentContextReceipt }>();
  private requests = new Map<string, string>();
  private bytes = 0;
  constructor(private readonly limits = { count: 100, bytes: 32 * 1024 * 1024 }) {}

  upload(scope: AgentContextScope, requestId: string, trajectory: unknown): AgentContextReceipt {
    const context = AgentContext.fromTrajectory(trajectory), scopeKey = this.scopeKey(scope);
    const key = JSON.stringify([scopeKey, requestId]);
    const previous = this.requests.get(key);
    if (previous) {
      const record = this.records.get(previous)!;
      if (record.context.contentHash !== context.contentHash)
        throw new AgentContextError('REQUEST_ID_CONFLICT', 'Upload request ID already identifies different context');
      return { ...record.receipt };
    }
    const snapshot = context.toSnapshot(), size = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    if (this.records.size >= this.limits.count || this.bytes + size > this.limits.bytes)
      throw new AgentContextError('AGENT_CONTEXT_CAPACITY', 'Agent context storage is full for this backend lifetime');
    const receipt = { agentContextId: `agent-context-${randomUUID()}`, contentHash: context.contentHash,
      agentType: snapshot.source.agentType, sourceSessionId: snapshot.source.sourceSessionId, messageCount: snapshot.messages.length };
    this.records.set(receipt.agentContextId, { scope: scopeKey, context, receipt });
    this.requests.set(key, receipt.agentContextId); this.bytes += size;
    return { ...receipt };
  }

  get(scope: AgentContextScope, agentContextId: string): AgentContextSnapshot {
    const record = this.records.get(agentContextId);
    if (!record || record.scope !== this.scopeKey(scope))
      throw new AgentContextError('AGENT_CONTEXT_NOT_FOUND', 'Context is unavailable for this workspace and document');
    return record.context.toSnapshot();
  }
  private scopeKey(scope: AgentContextScope) { return JSON.stringify([scope.workspaceInstanceId, scope.documentId]); }
}
