import path from 'node:path';
import { AgentContext, type AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import type { DiagramAgentContextStore } from '../../../domain/core/diagrams/diagramAgentContext';
import { ImmutableRecords } from './immutableRecords';

/** Each context is one immutable, content-addressed file outside canvas checkpoints. */
export class FileDiagramAgentContextStore implements DiagramAgentContextStore {
  private readonly records: ImmutableRecords;
  constructor(root: string) { this.records = new ImmutableRecords(path.join(root, 'diagram-agent-contexts')); }
  put(snapshot: AgentContextSnapshot) { return this.records.put(AgentContext.fromSnapshot(snapshot).toSnapshot()); }
  async get(recordId: string) { return AgentContext.fromSnapshot(await this.records.get(recordId)).toSnapshot(); }
}
