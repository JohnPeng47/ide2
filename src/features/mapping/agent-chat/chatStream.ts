import { reduceChatEvent, type ChatEvent, type ChatSession, type ChatItem, type ChatUpdate } from '../../../../domain/mapping/agent-chat/agentChat';

/** Receive continuously, commit text at most 20Hz, and publish no React updates while hidden. */
export class ChatStream {
  private session?: ChatSession;
  private pending: ChatUpdate[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private visible = false;
  private loading = false;
  private snapshotItems: ChatItem[] = [];
  constructor(private publish: (session: ChatSession) => void) {}
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.flush();
  }
  receive(event: ChatEvent) {
    if (event.type === 'snapshot') {
      this.clear(); this.loading = !!event.partial; this.session = event.session; this.snapshotItems = [];
      if (this.visible && !this.loading) this.publish(event.session);
      return;
    }
    if (event.type === 'snapshot-part') {
      if (!this.loading || !this.session) return;
      this.snapshotItems.push(...event.items);
      if (event.final) { this.session = { ...this.session, items: this.snapshotItems }; this.snapshotItems = []; this.loading = false; this.flush(); }
      return;
    }
    const events = event.type === 'batch' ? event.events : [event];
    this.pending.push(...events);
    // Lifecycle/interaction events may not wait behind a text debounce.
    if (events.some(update => update.type === 'state'
      ? 'status' in update.patch || 'pending' in update.patch || 'error' in update.patch
      : update.type === 'item' && (['user', 'assistant', 'interaction'].includes(update.item.kind) || update.item.status === 'failed'))) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.visible ? 50 : 250);
  }
  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.session && this.pending.length) this.session = reduceChatEvent(this.session, { type: 'batch', events: this.pending });
    this.pending = [];
    if (this.visible && !this.loading && this.session) this.publish(this.session);
  }
  private clear() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.pending = []; }
  dispose() { this.clear(); this.snapshotItems = []; }
}
