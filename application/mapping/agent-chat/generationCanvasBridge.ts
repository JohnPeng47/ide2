import type { CanvasSessionPort } from '../agent/ports';
import type { CanvasCommand, CanvasDescriptor } from '../../../domain/mapping/agent/contracts';
import { MappingDocumentController, type DiagramOperation } from '../../../domain/mapping/workspace/mappingDocumentController';
import { documentFromHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import type { MappingCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { currentCanvasRead } from '../../../domain/mapping/agent/currentCanvasRead';
import { canvasMutationResult } from '../../../domain/mapping/agent/mutationReceipt';
import { generatedDiagramOperations } from '../../../domain/mapping/workspace/generatedDiagramOperations';
import type { DiagramBatchApplication } from '../../../domain/mapping/agent/diagramBatch';
import { validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import type { DiagramRevisionApplication } from '../../../domain/mapping/agent/diagramEdit';

/** Each child sees a separate live canvas binding. No browser selection is changed. */
export class GenerationCanvasBridge implements CanvasSessionPort {
  private contexts = new Map<string, { documentId: string; name: string; controller: MappingDocumentController;
    persist: (history: CanvasHistoryRecord) => Promise<void>; receipts: Map<string, { signature: string; value: unknown }>; queue: Promise<unknown> }>();
  constructor(private live: CanvasSessionPort) {}
  add(id: string, name: string, history: CanvasHistoryRecord, persist: (history: CanvasHistoryRecord) => Promise<void>) {
    const documentId = id;
    const controller = new MappingDocumentController(documentFromHistory(history), history.snapshots[history.headId].view as MappingCanvasState,
      0, undefined, undefined, { ...history, contextId: crypto.randomUUID() });
    this.contexts.set(id, { documentId, name, controller, persist, receipts: new Map(), queue: Promise.resolve() });
    return { workspaceInstanceId: id, documentId };
  }
  history(id: string) { return this.contexts.get(id)?.controller.exportHistory(true); }
  remove(id: string) { this.contexts.delete(id); }
  register(descriptor: CanvasDescriptor) { this.live.register(descriptor); }
  list(): CanvasDescriptor[] { return [...this.live.list(), ...[...this.contexts].map(([canvasId, entry]) => ({ canvasId, projectId: 'generation', documents: [{ documentId: entry.documentId, name: entry.name }] }))]; }
  poll(id: string) { return this.live.poll(id); }
  reply(...args: Parameters<CanvasSessionPort['reply']>) { this.live.reply(...args); }
  unregister(id: string) { this.live.unregister(id); }
  dispose() { this.contexts.clear(); this.live.dispose(); }
  async dispatch(canvasId: string, command: Omit<CanvasCommand, 'id'>): Promise<unknown> {
    const entry = this.contexts.get(canvasId);
    if (!entry) {
      if (canvasId.startsWith('generation-')) throw Error('Generation canvas is no longer active');
      return this.live.dispatch(canvasId, command);
    }
    if (command.documentId !== entry.documentId) throw Error('Generation canvas binding mismatch');
    const run = entry.queue.then(async () => {
      const c = entry.controller, state = c.getSnapshot();
      const identity = { documentId: entry.documentId, name: entry.name, version: state.version };
      if (command.method === 'identity') return identity;
      if (command.method === 'context') return { ...identity, nodes: c.nodes(), edges: state.document.edges };
      if (command.method === 'document-state') return { document: state.document, name: entry.name };
      if (command.method === 'read') return { ...identity, ...currentCanvasRead(state, command.payload as { level: 'small' | 'full'; nodeIds?: string[] }) };
      if (command.method === 'snapshot') {
        const options = command.payload as { revisionIds?: string[]; currentRevisions?: boolean } | undefined;
        const ids = [...(options?.revisionIds ?? []), ...(options?.currentRevisions ? Object.values(state.document.scene.contents).map(diagram => diagram.revisionId) : [])];
        return { ...structuredClone(state), ...identity, ...(ids.length ? { revisions: c.exportRevisions(ids, true) } : {}) };
      }
      const p = command.payload as Record<string, any>;
      if (!p?.requestId) throw Error('Generation mutation needs a requestId');
      const signature = JSON.stringify(command), key = `${command.method}:${p.requestId}`;
      let receipt = entry.receipts.get(key);
      if (receipt && receipt.signature !== signature) throw Error('REQUEST_ID_CONFLICT');
      if (!receipt) {
        let value: unknown;
        if (command.method === 'apply') {
          const result = c.applyUpdate(p.expectedVersion, p.operations);
          value = p.resultFormat === 'receipt' ? canvasMutationResult(entry.documentId, p.operations, result) : result;
        } else if (command.method === 'apply-diagram-batch' || command.method === 'apply-diagram-revision') {
          const batch = command.method === 'apply-diagram-batch' ? p as DiagramBatchApplication : { expectedVersion: p.expectedVersion, edits: [p as DiagramRevisionApplication], creations: [] };
          const edits: DiagramOperation[] = batch.edits.map(edit => edit.variants
            ? { method: 'variant-store', nodeId: edit.nodeId, expectedRevisionId: edit.baseRevisionId, variants: edit.variants }
            : { method: 'diagram-revision-apply', nodeId: edit.nodeId, expectedRevisionId: edit.baseRevisionId, revision: edit.revision });
          const result = c.applyUpdate(batch.expectedVersion, [...edits, ...generatedDiagramOperations(batch.creations)]);
          const document = c.getSnapshot().document;
          const unresolvedEdgeIds = document.edges.filter(edge => {
            try { validateConnectionAnchor(document.scene, edge.source); validateConnectionAnchor(document.scene, edge.target); return false; }
            catch { return true; }
          }).map(edge => edge.id);
          value = { version: result.version, unresolvedEdgeIds };
        } else if (command.method === 'create-diagrams') value = { version: c.applyUpdate(p.expectedVersion, generatedDiagramOperations(p.diagrams)).version };
        else if (command.method === 'apply-diagram-context') value = c.applyUpdate(p.expectedVersion, [p.operation === 'prepare'
          ? { method: 'diagram-context-set', nodeId: p.nodeId, expectedRevisionId: p.expectedRevisionId, context: p.context }
          : { method: 'diagram-context-delete', nodeId: p.nodeId, expectedRevisionId: p.expectedRevisionId }]);
        else if (command.method === 'canvas-view') {
          if (p.operation === 'list') return { version: state.version, saved: {} };
          if (p.operation !== 'save') throw Error('Edit the bound generation canvas directly; fork management belongs to the parent');
          value = { version: state.version, saved: true };
        } else if (command.method === 'checkpoint') {
          if (p.expectedVersion !== state.version) throw Error('VERSION_CONFLICT');
          value = { ...identity, checkpointId: state.canvasRevisionId };
        } else throw Error(`${command.method} is unavailable on an isolated generation canvas`);
        receipt = { signature, value }; entry.receipts.set(key, receipt);
      }
      await entry.persist(c.exportHistory(true));
      return receipt.value;
    });
    entry.queue = run.catch(() => {});
    return run;
  }
}
