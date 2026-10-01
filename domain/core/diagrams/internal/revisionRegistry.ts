import { deepFreeze } from '../../immutability';
import { validateDiagram, type Diagram } from '../diagram';
import type { DiagramRevision } from '../diagramRevisionEditor';
import { diagramContentNodes } from '../diagramContentNodes';

/** Runtime identity registry. Restored records enter only through validated storage/history adapters. */
class RevisionRegistry {
  private readonly records = new Map<string, DiagramRevision>();
  private readonly signatures = new Map<string, string>();
  private readonly pendingValidation = new Set<string>();
  register(record: DiagramRevision): DiagramRevision { return this.install(record, false); }
  /** Restored history keeps older revisions addressable without parsing them until accessed. */
  restore(record: DiagramRevision): DiagramRevision { return this.install(record, true); }
  private install(record: DiagramRevision, deferred: boolean): DiagramRevision {
    if (record.id !== record.diagram.revisionId || record.diagramId !== record.diagram.diagramId) throw Error('Invalid diagram revision identity');
    const signature = JSON.stringify(record);
    const prior = this.records.get(record.id);
    if (prior) {
      if (this.signatures.get(record.id) !== signature) throw Error('Diagram revision is immutable');
      if (!deferred) this.get(record.id);
      return prior;
    }
    if (!deferred) validateDiagram(record.diagram);
    const stored = deepFreeze(structuredClone(record));
    this.records.set(record.id, stored); this.signatures.set(record.id, signature);
    if (deferred) this.pendingValidation.add(record.id);
    return stored;
  }
  get(id: string): DiagramRevision {
    const record = this.records.get(id);
    if (!record) throw Error(`Unknown diagram revision: ${id}`);
    if (this.pendingValidation.has(id)) {
      validateDiagram(record.diagram);
      const refs = diagramContentNodes(record.diagram.content).map(node => record.nodeRefs?.[node.id]);
      if (!record.nodeRefs || refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length) throw Error('Invalid logical node identities');
      this.pendingValidation.delete(id);
    }
    return record;
  }
  assert(diagram: Diagram): DiagramRevision {
    const record = this.get(diagram.revisionId);
    if (record.diagram !== diagram && JSON.stringify(record.diagram) !== JSON.stringify(diagram))
      throw Error('Diagram content must be changed through DiagramService');
    return record;
  }
  list(diagramId: string) { return [...this.records.values()].filter(record => record.diagramId === diagramId); }
}
export const diagramRevisions = new RevisionRegistry();
