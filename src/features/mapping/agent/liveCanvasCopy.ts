import { liveCopyCommandSchema, type LiveCopyReply } from '../../../../domain/mapping/agent/liveCanvasStatus';
import type { CanvasDraft } from '../workspace/canvasWorkspace';

/** Receipts survive Escape and reconnects, so retries cannot resurrect an old copy. */
export class LiveCanvasCopyReceiver {
  private receipts = new Map<string, { signature: string; result: LiveCopyReply['result'] }>();
  apply(raw: unknown, draft: CanvasDraft | undefined, canvasEpoch: string | undefined, canMutate = true): LiveCopyReply {
    const command = liveCopyCommandSchema.parse(raw), signature = JSON.stringify(command);
    const reply = (result: LiveCopyReply['result']): LiveCopyReply => ({ type: 'diagram.copy.reply', commandId: command.commandId, result });
    if (!draft || draft.hidden || canvasEpoch !== command.canvasEpoch) return reply({ ok: false, code: 'CANVAS_REPLACED', error: 'Canvas is no longer available' });
    const prior = this.receipts.get(command.commandId);
    if (prior) return reply(prior.signature === signature ? prior.result : { ok: false, code: 'REQUEST_ID_REUSED', error: 'Copy command ID reused' });
    if (this.receipts.size >= 2000) return reply({ ok: false, code: 'COPY_HISTORY_FULL', error: 'Reload the browser before sending more copies' });
    let result: LiveCopyReply['result'];
    try {
      if (!canMutate || draft.busy) throw Error('WORKSPACE_BUSY');
      draft.session.cursorCopy.stage(command.ascii);
      result = { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { ok: false, code: message === 'WORKSPACE_BUSY' ? message : 'INVALID_DIAGRAM', error: message.slice(0, 4000) };
    }
    this.receipts.set(command.commandId, { signature, result });
    return reply(result);
  }
}
