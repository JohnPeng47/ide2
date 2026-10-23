export const canvasReplyLimit = 64 * 1024 * 1024;
export const mutationCommands = new Set(['canvas-view', 'apply', 'apply-diagram-revision', 'apply-diagram-context', 'create-diagrams', 'create-document', 'copy-document', 'saved']);
/** Count the entire encoded envelope, including command ID and escaped/multibyte text. */
export function canvasReply(command: { id: string; method: string }, result: { value?: unknown; error?: string }, limit = canvasReplyLimit) {
  const body = JSON.stringify({ commandId: command.id, ...result });
  const bytes = new TextEncoder().encode(body).byteLength;
  const error = `CANVAS_REPLY_TOO_LARGE: method=${command.method} actualBytes=${bytes} limitBytes=${limit}${mutationCommands.has(command.method) ? '; mutation outcome may be unknown; retry the identical requestId' : '; use a smaller read'} `;
  return { body: bytes > limit ? JSON.stringify({ commandId: command.id, error }) : body, bytes, oversized: bytes > limit };
}
