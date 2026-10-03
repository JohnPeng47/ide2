import type { DiagramEditRun, EditDiagramInput } from '../../../../domain/mapping/agent/diagramEdit';
import { apiFetch, errorFrom } from '../../../shared/http/http';

export interface DiagramEditClient {
  capture(canvasId: string, documentId: string, nodeId: string): Promise<Pick<EditDiagramInput, 'sessionId' | 'expectedVersion' | 'baseRevisionId'>>;
  start(input: EditDiagramInput): Promise<DiagramEditRun>;
  status(runId: string): Promise<DiagramEditRun>;
  cancel(runId: string): Promise<DiagramEditRun>;
}
async function call<T>(name: string, input: unknown): Promise<T> {
  const response = await apiFetch(`/api/mapping/agent/tools/${name}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(65000) });
  if (!response.ok) throw await errorFrom(response);
  return response.json();
}
export function createDiagramEditClient(): DiagramEditClient {
  const attachments = new Map<string, Promise<string>>();
  return {
    async capture(canvasId, documentId, nodeId) {
      const key = JSON.stringify([canvasId, documentId]);
      let attachment = attachments.get(key);
      if (!attachment) {
        attachment = call<{ value: { sessionId: string } }>('exec', { requestId: crypto.randomUUID(),
          code: `return canvas.attach(${JSON.stringify({ canvasId, documentId })});` })
          .then(result => result.value.sessionId).catch(error => { attachments.delete(key); throw error; });
        attachments.set(key, attachment);
      }
      const sessionId = await attachment;
      try {
        const read = await call<{ version: number; node: { diagram?: { revisionId: string } } }>('diagram-search',
          { operation: 'read', sessionId, nodeId });
        if (!read.node.diagram) throw Error('The selected diagram is no longer available.');
        return { sessionId, expectedVersion: read.version, baseRevisionId: read.node.diagram.revisionId };
      } catch (error) { attachments.delete(key); throw error; }
    },
    start: input => call('edit-diagram', input),
    status: runId => call('edit-diagram-status', { runId }),
    cancel: runId => call('cancel-diagram-edit', { runId })
  };
}
