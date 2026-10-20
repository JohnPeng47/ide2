import { randomBytes } from 'node:crypto';
import type { ChatCanvasTarget } from '../../../domain/mapping/agent-chat/agentChat';
/** Host-owned channel. Each request captures the active turn before its first await. */
export class ChatCanvasBindings {
  private channels = new Map<string, { target?: ChatCanvasTarget; active?: boolean; readOnly: boolean; attachment?: Promise<string> }>();
  create() {
    if (this.channels.size >= 500) throw Error('Chat binding capacity reached');
    const token = randomBytes(32).toString('hex'); this.channels.set(token, { readOnly: true }); return token;
  }
  bind(token: string, target: ChatCanvasTarget | undefined, readOnly: boolean) {
    if (!this.channels.has(token)) throw Error('CHAT_BINDING_UNAVAILABLE');
    const previous = this.channels.get(token);
    this.channels.set(token, { target: target && structuredClone(target), active: true, readOnly,
      ...(JSON.stringify(previous?.target) === JSON.stringify(target) ? { attachment: previous?.attachment } : {}) });
  }
  capture(token: string) {
    const binding = this.channels.get(token);
    if (!binding?.active || !binding.target) throw Error('CHAT_BINDING_UNAVAILABLE: no active canvas turn; send a new message from the canvas');
    return binding;
  }
  clear(token: string) { const binding = this.channels.get(token); if (binding) this.channels.set(token, { ...binding, active: false }); }
}
