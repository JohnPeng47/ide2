import type { SavedAgentContext, summarizeAgentContext } from '../../../domain/core/agents/savedAgentContext';

export interface AgentContextRepository {
  create(record: SavedAgentContext): Promise<SavedAgentContext>;
  read(id: string): Promise<SavedAgentContext | null>;
  summaries(): Promise<ReturnType<typeof summarizeAgentContext>[]>;
}
