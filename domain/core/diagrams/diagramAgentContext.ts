import { AgentContext, type AgentContextSnapshot } from '../agents/agentContext';
import { sha256 } from '../sha256';
import type { Diagram } from './diagram';

export interface DiagramAgentContextStore {
  put(snapshot: AgentContextSnapshot): Promise<string>;
  get(recordId: string): Promise<unknown>;
}

interface DiagramAgentContextIdentity {
  diagramId: string;
  compiledFromRevisionId: string;
  sourceFingerprint: string;
}

export type StoredDiagramAgentContext = DiagramAgentContextIdentity & {
  backingRecordId: string; contentHash: string; snapshot?: never;
};
export type InlineDiagramAgentContext = DiagramAgentContextIdentity & {
  snapshot: AgentContextSnapshot; contentHash?: string; backingRecordId?: never;
};
/** The diagram carries a small disk reference. Inline snapshots remain valid for old workspaces and portable exports. */
export type DiagramAgentContext = StoredDiagramAgentContext | InlineDiagramAgentContext;

export function diagramContextSourceFingerprint(diagram: Diagram): string {
  return sha256(JSON.stringify({ binding: diagram.sourceContext.binding ?? null, evidence: diagram.sourceContext.evidence }));
}

/** Capture stable source evidence once; the current diagram is supplied by each later generation request. */
export function compileDiagramAgentContext(diagram: Diagram): InlineDiagramAgentContext {
  const sourceFingerprint = diagramContextSourceFingerprint(diagram);
  const context = AgentContext.fromTrajectory({ agentType: 'diagram-context', sourceSessionId: diagram.diagramId,
    format: 'messages-v1', fromEntryId: 'source', throughEntryId: 'source', entries: [{ id: 'source', parentId: null,
      message: { role: 'user', timestamp: 0, content: [{ type: 'text', text: `Source evidence for diagram ${diagram.diagramId}. This is background captured at revision ${diagram.revisionId}; use the current diagram supplied with each edit request as the authoritative content.\n${JSON.stringify({ binding: diagram.sourceContext.binding ?? null, evidence: diagram.sourceContext.evidence })}` }] } }] });
  return { diagramId: diagram.diagramId, compiledFromRevisionId: diagram.revisionId, sourceFingerprint,
    contentHash: context.contentHash, snapshot: context.toSnapshot() };
}

export async function storeDiagramAgentContext(value: DiagramAgentContext, store: DiagramAgentContextStore): Promise<StoredDiagramAgentContext> {
  validateDiagramAgentContext(value);
  if (!value.snapshot) return value as StoredDiagramAgentContext;
  const backingRecordId = await store.put(value.snapshot);
  if (!/^[a-f0-9]{64}$/.test(backingRecordId)) throw Error('Invalid diagram context backing record');
  return { diagramId: value.diagramId, compiledFromRevisionId: value.compiledFromRevisionId,
    sourceFingerprint: value.sourceFingerprint, contentHash: value.snapshot.contentHash, backingRecordId };
}

export async function loadDiagramAgentContext(value: DiagramAgentContext, store?: DiagramAgentContextStore): Promise<AgentContextSnapshot> {
  validateDiagramAgentContext(value);
  const raw = value.snapshot ?? (store && value.backingRecordId ? await store.get(value.backingRecordId) : undefined);
  if (!raw) throw Error('AGENT_CONTEXT_STORAGE_UNAVAILABLE: diagram context backing record cannot be loaded');
  const snapshot = AgentContext.fromSnapshot(raw).toSnapshot();
  if ((value.contentHash && snapshot.contentHash !== value.contentHash) || snapshot.source.agentType !== 'diagram-context'
    || snapshot.source.sourceSessionId !== value.diagramId) throw Error('DIAGRAM_CONTEXT_MISMATCH: backing record does not match diagram');
  return snapshot;
}

export function validateDiagramAgentContext(value: DiagramAgentContext): void {
  if (!value || typeof value.diagramId !== 'string' || !value.diagramId.startsWith('diagram-')
    || typeof value.compiledFromRevisionId !== 'string' || !value.compiledFromRevisionId.startsWith('diagram-revision-')
    || typeof value.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint)
    || value.contentHash !== undefined && !/^[a-f0-9]{64}$/.test(value.contentHash)) throw Error('Invalid diagram agent context');
  if ('snapshot' in value && value.snapshot !== undefined) {
    if (value.backingRecordId !== undefined) throw Error('Diagram context has two backing sources');
    const snapshot = AgentContext.fromSnapshot(value.snapshot).toSnapshot();
    if ((value.contentHash && snapshot.contentHash !== value.contentHash) || snapshot.source.agentType !== 'diagram-context'
      || snapshot.source.sourceSessionId !== value.diagramId) throw Error('Diagram agent context belongs to another diagram');
  } else if (!value.contentHash || typeof value.backingRecordId !== 'string' || !/^[a-f0-9]{64}$/.test(value.backingRecordId))
    throw Error('Invalid diagram context backing record');
}
