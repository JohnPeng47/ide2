import path from 'node:path';
import { AgentContext, type AgentContextSnapshot } from '../../../domain/core/agents/agentContext';
import type { DiagramAgentContextStore } from '../../../domain/core/diagrams/diagramAgentContext';
import type { AgentContextSources } from '../../../application/core/ports/agentContextSources';
import { FileAgentContextSources } from './fileAgentContextSources';
import { ImmutableRecords } from './immutableRecords';

/** Each context is one immutable, content-addressed file outside canvas checkpoints. */
export class FileDiagramAgentContextStore implements DiagramAgentContextStore {
  private readonly records: ImmutableRecords;
  constructor(root: string, private readonly sources: AgentContextSources = new FileAgentContextSources(root)) { this.records = new ImmutableRecords(path.join(root, 'diagram-agent-contexts')); }
  async put(snapshot: AgentContextSnapshot) { return this.records.put(await this.sources.persist(snapshot)); }
  portable(snapshot: AgentContextSnapshot) { return this.sources.portable(snapshot); }
  async resolve(snapshot: AgentContextSnapshot) { return (await AgentContext.fromSnapshot(snapshot).resolveSources(ref => this.sources.read(ref))).toSnapshot(); }
  async get(recordId: string) { return AgentContext.fromSnapshot(await this.records.get(recordId)).toSnapshot(); }
}
