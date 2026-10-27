import type { AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import type { AgentContextSourceRange, CaptureSourceRange } from '../../../domain/core/agents/agentContextSource';

export interface AgentContextSources {
  capture(input: CaptureSourceRange): Promise<AgentContextSourceRange>;
  read(reference: AgentContextSourceRange): Promise<string>;
  /** Publish attached source blobs before persisting a compact context. */
  persist(snapshot: AgentContextSnapshot): Promise<AgentContextSnapshot>;
  /** Include shared blobs in a portable snapshot; resolve Git sources to pinned snapshots. */
  portable(snapshot: AgentContextSnapshot): Promise<AgentContextSnapshot>;
}
