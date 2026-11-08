import type { SavedAgentContext, summarizeAgentContext } from '../../../domain/core/agents/savedAgentContext';

export interface AgentContextRepository {
  create(record: SavedAgentContext): Promise<SavedAgentContext>;
  read(id: string): Promise<SavedAgentContext | null>;
  updateGroup(id: string, group: string | null): Promise<SavedAgentContext>;
  addComment(input: { agentContextId: string; requestId: string; expectedContentHash: string; text: string }): Promise<SavedAgentContext>;
  summaries(): Promise<ReturnType<typeof summarizeAgentContext>[]>;
}
