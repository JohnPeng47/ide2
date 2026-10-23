import { canvasViewCommandSchema } from '../../../../domain/core/diagrams/canvasView';
import type { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { z } from 'zod';

export const canvasViewRequestSchema = canvasViewCommandSchema.extend({ requestId: z.string().min(1).max(200),
  expectedVersion: z.number().int().nonnegative().optional(), sessionId: z.string().optional() }).strict();
export type CanvasViewRequest = z.infer<typeof canvasViewRequestSchema>;
type Result = ReturnType<MappingDocumentController['canvasView']>;
/** Retain the mutation receipt before flushing so a failed save never applies a view twice. */
export class CanvasViewReceiver {
  private receipts = new Map<string, { signature: string; result: Result; pending?: Promise<Result> }>();
  async apply(documentId: string, raw: unknown, controller: MappingDocumentController, persist: () => Promise<void>) {
    const { requestId, expectedVersion, sessionId: _, ...input } = canvasViewRequestSchema.parse(raw);
    if (input.operation === 'list' || input.operation === 'read') {
      const result = controller.canvasView(controller.getSnapshot().version, input);
      return input.operation === 'read' ? { version: result.version, view: result.saved[input.viewId!] } : result;
    }
    if (expectedVersion === undefined) throw Error('expectedVersion is required for CanvasView changes');
    const key = JSON.stringify([documentId, requestId]), signature = JSON.stringify({ input, expectedVersion });
    let receipt = this.receipts.get(key);
    if (receipt && receipt.signature !== signature) throw Error('REQUEST_ID_CONFLICT: CanvasView arguments differ');
    if (!receipt) {
      if (this.receipts.size >= 2000) throw Error('CanvasView receipt capacity reached; reload the workspace');
      receipt = { signature, result: controller.canvasView(expectedVersion, input) };
      this.receipts.set(key, receipt);
    }
    if (!receipt.pending) {
      const current = receipt;
      current.pending = Promise.resolve().then(persist).then(() => current.result).catch(error => {
        throw Error(`PERSISTENCE_PENDING: CanvasView changed; retry the same request to save: ${String(error)}`);
      }).finally(() => { current.pending = undefined; });
    }
    return receipt.pending;
  }
}
