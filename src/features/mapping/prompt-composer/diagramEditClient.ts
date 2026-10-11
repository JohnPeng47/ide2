import type { CreateDiagramInput, DiagramEditRun, EditDiagramInput } from '../../../../domain/mapping/agent/diagramEdit';
import type { PromptOperation } from '../../../../domain/mapping/agent/promptTemplates';
import { apiFetch, errorFrom } from '../../../shared/http/http';

export interface DiagramEditClient {
  capture(canvasId: string, documentId: string, nodeId: string): Promise<Pick<EditDiagramInput, 'sessionId' | 'expectedVersion' | 'baseRevisionId'>>;
  /** edit-diagram revises the captured diagram; create-diagram places new diagrams beside it. */
  start(input: EditDiagramInput | CreateDiagramInput, operation: PromptOperation): Promise<DiagramEditRun>;
  status(runId: string): Promise<DiagramEditRun>;
  cancel(runId: string): Promise<DiagramEditRun>;
}
async function call<T>(name: string, input: unknown): Promise<T> {
  const route = name === 'attach' ? '/attachments' : name === 'edit-diagram' ? '/diagram-edits'
    : name === 'cancel-diagram-edit' ? `/diagram-edits/${encodeURIComponent((input as { runId: string }).runId)}/cancel`
    : `/tools/${name}`;
  const response = await apiFetch(`/api/mapping/agent${route}`, { method: 'POST',
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
        attachment = call<{ value: { sessionId: string } }>('attach', { canvasId, documentId })
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
    start: (input, operation) => call(operation, input),
    status: runId => call('edit-diagram-status', { runId }),
    cancel: runId => call('cancel-diagram-edit', { runId })
  };
}
