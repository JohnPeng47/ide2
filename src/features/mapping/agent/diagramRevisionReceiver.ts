import type { DiagramRevisionApplication } from '../../../../domain/mapping/agent/diagramEdit';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { validateConnectionAnchor } from '../../../../domain/core/diagrams/diagramConnection';

interface Applied { version: number; unresolvedEdgeIds: string[] }
interface Receipt { signature: string; result: Applied; pending?: Promise<Applied> }

/** Keep the mutation receipt before flushing: retry a failed write without editing twice. */
export class DiagramRevisionReceiver {
  private receipts = new Map<string, Receipt>();
  async apply(documentId: string, input: DiagramRevisionApplication, controller: MappingDocumentController, persist: () => Promise<void>) {
    const key = JSON.stringify([documentId, input.requestId]), signature = JSON.stringify(input);
    let receipt = this.receipts.get(key);
    if (receipt && receipt.signature !== signature) throw Error('REQUEST_ID_CONFLICT: revision application differs');
    if (!receipt) {
      if (this.receipts.size >= 2000) throw Error('Revision receipt capacity reached; reload the workspace');
      const result = controller.applyUpdate(input.expectedVersion, [{ method: 'diagram-revision-apply', nodeId: input.nodeId,
        expectedRevisionId: input.baseRevisionId, revision: input.revision }]);
      const document = controller.getSnapshot().document;
      const unresolvedEdgeIds = document.edges.filter(edge => {
        try { validateConnectionAnchor(document.scene, edge.source); validateConnectionAnchor(document.scene, edge.target); return false; }
        catch { return true; }
      }).map(edge => edge.id);
      receipt = { signature, result: { version: result.version, unresolvedEdgeIds } };
      this.receipts.set(key, receipt);
    }
    if (!receipt.pending) {
      const current = receipt;
      current.pending = Promise.resolve().then(persist).then(() => current.result).catch(error => {
        throw Error(`PERSISTENCE_PENDING: revision applied; retry the same request to flush: ${String(error)}`);
      }).finally(() => { current.pending = undefined; });
    }
    return receipt.pending!;
  }
}
