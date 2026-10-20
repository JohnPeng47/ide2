import { livePasteCommandSchema, type LivePasteReply } from '../../../../domain/mapping/agent/liveCanvasStatus';
import type { CanvasDraft } from '../workspace/canvasWorkspace';

/** Receipts outlive publisher reconnects, but never the owning workspace. */
export class LiveCanvasPasteReceiver {
  private receipts = new Map<string, { signature: string; result: LivePasteReply['result'] }>();
  apply(raw: unknown, draft: CanvasDraft | undefined, canvasEpoch: string | undefined, canMutate = true): LivePasteReply {
    const command = livePasteCommandSchema.parse(raw);
    const signature = JSON.stringify(command);
    const reply = (result: LivePasteReply['result']): LivePasteReply => ({ type: 'diagram.paste.reply', commandId: command.commandId, result });
    const fail = (code: string, error = code) => reply({ ok: false, code, error });
    if (!draft || draft.hidden || canvasEpoch !== command.canvasEpoch) return fail('CANVAS_REPLACED');
    const previous = this.receipts.get(command.commandId);
    if (previous) return previous.signature === signature ? reply(previous.result) : fail('REQUEST_ID_REUSED');
    if (this.receipts.size >= 2000) return fail('PASTE_HISTORY_FULL', 'Reload the browser before sending more pastes');
    let result: LivePasteReply['result'];
    try {
      if (!canMutate || draft.busy) throw Error('WORKSPACE_BUSY');
      const snapshot = draft.session.controller.applyUpdate(command.expectedVersion, [{ method: 'diagram-create',
        id: command.nodeId.slice(5), ascii: command.ascii, position: command.position }]);
      result = { ok: true, nodeId: command.nodeId, version: snapshot.version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.match(/^([A-Z][A-Z_]+)(?::|$)/)?.[1] ?? 'INVALID_DIAGRAM';
      result = { ok: false, code, error: message.slice(0, 4000) };
    }
    this.receipts.set(command.commandId, { signature, result });
    return reply(result);
  }
}
