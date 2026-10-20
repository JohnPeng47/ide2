import { chatChangeStart, type ChatItem, type ChatSession, type CommandAction } from './agentChat';

export interface TranscriptBlock { id: string; kind: 'exploration' | 'item'; start: number; end: number; items: ChatItem[]; commandCount: number; failureCount: number; activeCount: number }
export function isExploration(item: ChatItem) {
  return !!item.command?.actions.length && item.command.source !== 'userShell'
    && item.command.actions.every(action => ['read', 'listFiles', 'search'].includes(action.type));
}
export function hiddenItem(item: ChatItem) {
  return item.kind === 'reasoning' || item.sourceType === 'sleep'
    || (item.kind === 'assistant' && !item.text.trim())
    || (item.command?.source === 'unifiedExecInteraction' && item.status !== 'inProgress' && item.command.exitCode === 0 && !item.text.trim());
}

/** Rebuild only the affected suffix. Older blocks retain referential identity for React memo. */
export class TranscriptProjector {
  private items: ChatItem[] = [];
  private blocks: TranscriptBlock[] = [];
  project(items: ChatItem[]) {
    if (this.items === items) return this.blocks;
    const change = chatChangeStart(this.items, items);
    if (change === this.items.length && items.length > this.items.length) {
      const blocks = this.blocks.slice();
      for (let i = this.items.length; i < items.length; i++) {
        const item = items[i];
        let last = blocks.at(-1);
        if (last?.kind === 'exploration' && item.turnId === last.items[0].turnId && (isExploration(item) || hiddenItem(item))) {
          if (last === this.blocks.at(-1)) { last = { ...last, items: last.items.slice() }; blocks[blocks.length - 1] = last; }
          last.items.push(item); last.end = i;
          last.commandCount += Number(!!item.command && !hiddenItem(item)); last.failureCount += Number(failedItem(item)); last.activeCount += Number(item.status === 'inProgress');
        } else blocks.push({ id: item.id, kind: isExploration(item) ? 'exploration' : 'item', start: i, end: i, items: [item],
          commandCount: Number(!!item.command && !hiddenItem(item)), failureCount: Number(failedItem(item)), activeCount: Number(item.status === 'inProgress') });
      }
      this.items = items; this.blocks = blocks; return blocks;
    }
    let low = 0, high = this.blocks.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.blocks[mid].end < change) low = mid + 1; else high = mid;
    }
    // Text/status-only updates do not regroup or walk every command in a long exploration.
    if (items.length === this.items.length && change < items.length) {
      let structural = false;
      for (let i = change; i < items.length; i++) {
        const before = this.items[i], after = items[i];
        if (before !== after && (before.id !== after.id || before.turnId !== after.turnId
          || isExploration(before) !== isExploration(after) || hiddenItem(before) !== hiddenItem(after))) { structural = true; break; }
      }
      if (!structural) {
        const blocks = this.blocks.slice(), copied = new Set<number>();
        let blockIndex = low;
        for (let i = change; i < items.length; i++) {
          while (blocks[blockIndex] && blocks[blockIndex].end < i) blockIndex++;
          const before = this.items[i], after = items[i];
          if (before === after) continue;
          if (!copied.has(blockIndex)) { blocks[blockIndex] = { ...blocks[blockIndex], items: blocks[blockIndex].items.slice() }; copied.add(blockIndex); }
          const block = blocks[blockIndex];
          block.items[i - block.start] = after;
          block.commandCount += Number(!!after.command && !hiddenItem(after)) - Number(!!before.command && !hiddenItem(before));
          block.failureCount += Number(failedItem(after)) - Number(failedItem(before));
          block.activeCount += Number(after.status === 'inProgress') - Number(before.status === 'inProgress');
        }
        this.items = items; this.blocks = blocks; return blocks;
      }
    }
    // Include the preceding block so newly appended compatible activity can join it.
    const keep = Math.max(0, low - 1);
    const start = this.blocks[keep]?.start ?? 0;
    const blocks = this.blocks.slice(0, keep);
    for (let i = start; i < items.length; i++) {
      const item = items[i], last = blocks.length > keep ? blocks.at(-1) : undefined;
      if (last?.kind === 'exploration' && item.turnId === last.items[0].turnId && (isExploration(item) || hiddenItem(item))) {
        last.items.push(item); last.end = i;
        last.commandCount += Number(!!item.command && !hiddenItem(item)); last.failureCount += Number(failedItem(item)); last.activeCount += Number(item.status === 'inProgress');
      } else blocks.push({ id: item.id, kind: isExploration(item) ? 'exploration' : 'item', start: i, end: i, items: [item], commandCount: Number(!!item.command && !hiddenItem(item)), failureCount: Number(failedItem(item)), activeCount: Number(item.status === 'inProgress') });
    }
    this.items = items; this.blocks = blocks;
    return blocks;
  }
}
export function actionLabel(action: CommandAction) {
  if (action.type === 'read') return `Read ${action.name || action.path || action.command || 'file'}`;
  if (action.type === 'listFiles') return `List ${action.path || 'files'}`;
  if (action.type === 'search') return `Search ${action.query || action.command || ''}${action.path ? ` in ${action.path}` : ''}`;
  return action.command || 'Run command';
}
export function failedItem(item: ChatItem) {
  // Search exit 1 may simply mean no matches; don't call it a failure.
  if (item.command?.exitCode === 1 && item.command.actions.some(action => action.type === 'search')) return false;
  return item.status === 'failed' || (item.command?.exitCode !== undefined && item.command.exitCode !== 0
    && !(item.command.exitCode === 1 && item.command.actions.some(action => action.type === 'search')));
}
export function itemIsActive(item: ChatItem, activeTurn?: string | null) {
  return item.status === 'inProgress' && (!item.turnId || item.turnId === activeTurn);
}
export function lastSummary(text: string) {
  return text.split('\n').reverse().map(line => line.trim()).find(line => line && !line.startsWith('<!--'))?.replace(/^#+\s*|\*\*/g, '') ?? '';
}
/** Status is derived from the latest meaningful event in the active turn, never from old reasoning. */
export function workingStatus(session: ChatSession): string | null {
  if (session.status !== 'running') return null;
  if (session.pending.length) return 'Waiting for you';
  if (session.activity) return session.activity;
  let summary = '';
  let latestVisible: ChatItem | undefined;
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i];
    if (item.kind === 'user' || (item.turnId && session.turnId && item.turnId !== session.turnId)) break;
    if (item.kind === 'reasoning' && !summary) summary = lastSummary(item.text);
    if (!latestVisible && !hiddenItem(item)) latestVisible = item;
    if (latestVisible && summary) break;
  }
  if (latestVisible?.kind === 'assistant') {
    if (latestVisible.status === 'inProgress' || !latestVisible.phase || latestVisible.phase === 'final_answer') return null;
  }
  return summary || 'Working…';
}
export function outputPreview(text: string) { return text.trimEnd().split('\n').slice(-3).map(line => line.slice(0, 240)).join('\n'); }
