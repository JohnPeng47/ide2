import { randomUUID } from 'node:crypto';
import { UsageStore } from './usageStore';
import { codexCounts } from './usageLogParser';
/** Ephemeral codex exec runs have no rollout file. Capture their protocol usage in code. */
export function runtimeUsageRecorder(model: string, effort: string) {
  let sessionId = randomUUID() as string, sequence = 0;
  return (event: { type?: string; thread_id?: string; usage?: Record<string, unknown> }) => {
    if (event.type === 'thread.started' && event.thread_id) sessionId = event.thread_id;
    if (event.type !== 'turn.completed' || !event.usage) return;
    if (process.env.NODE_ENV === 'test' && !process.env.NEW_DIAGRAM_USAGE_DB) return;
    let store: UsageStore | undefined;
    try {
      const counts = codexCounts(event.usage); if (!counts.input && !counts.output) return;
      store = new UsageStore(); store.event({ ...counts, id: `exec:${sessionId}:${sequence++}`, sessionId, model, effort, tier: 'unknown', source: 'codex-exec', at: Date.now() });
    } catch (error) { console.warn('Could not record Codex token usage:', error instanceof Error ? error.message : String(error)); }
    finally { store?.close(); }
  };
}
