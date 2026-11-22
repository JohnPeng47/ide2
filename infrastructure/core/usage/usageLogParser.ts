import type { TokenCounts, UsageEvent } from '../../../domain/core/usage/codexUsage';
export interface LogCursor {
  offset: number; inode: number; sessionId?: string; startedAt?: number; model?: string; effort?: string; tier?: string;
  previous?: TokenCounts; forked?: boolean;
}
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
export function codexCounts(v: Record<string, unknown>): TokenCounts {
  return { input: number(v.input_tokens), cached: number(v.cached_input_tokens), cacheWrite: number(v.cache_write_input_tokens),
    output: number(v.output_tokens), reasoning: number(v.reasoning_output_tokens) };
}
export function usageLogLine(raw: string, state: LogCursor, since: number): UsageEvent | undefined {
  // Discard transcript/tool text without parsing it or retaining it in the usage database.
  if (!/"(?:token_count|turn_context|session_meta|session|model_change|thinking_level_change|message)"/.test(raw.slice(0, 700))) return;
  const d = JSON.parse(raw), p = d.payload ?? {}, at = Date.parse(d.timestamp);
  if (d.type === 'session_meta') {
    state.sessionId = p.id; state.startedAt = Date.parse(p.timestamp ?? d.timestamp); state.forked = !!p.forked_from_id; return;
  }
  if (d.type === 'turn_context') {
    state.model = p.model ?? 'unknown'; state.effort = p.effort ?? p.reasoning_effort ?? 'unknown'; state.tier = p.service_tier ?? 'unknown'; return;
  }
  if (d.type === 'session') { state.sessionId = d.id; state.startedAt = at; return; }
  if (d.type === 'model_change') { state.model = d.modelId; return; }
  if (d.type === 'thinking_level_change') { state.effort = d.thinkingLevel; return; }
  if (!state.sessionId || !Number.isFinite(at)) return;
  const base = { at, sessionId: state.sessionId, model: state.model ?? 'unknown', effort: state.effort ?? 'unknown', tier: state.tier ?? 'unknown' };
  if (d.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
    const current = codexCounts(p.info.total_token_usage), previous = state.previous;
    state.previous = current;
    if (at < since || at < (state.startedAt ?? 0)) return;
    const delta = previous ? Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value - previous[key as keyof TokenCounts]])) as unknown as TokenCounts
      : state.forked ? codexCounts(p.info.last_token_usage ?? {}) : current;
    // A counter discontinuity establishes a new baseline; never interpret it as negative spend.
    if (Object.values(delta).some(n => n < 0) || delta.input + delta.output <= 0) return;
    return { ...base, ...delta, id: `codex:${state.sessionId}:${at}:${current.input}:${current.output}`, source: 'codex-log' };
  }
  if (d.type === 'message' && d.message?.role === 'assistant' && d.message.provider === 'openai-codex' && d.message.usage) {
    const m = d.message, u = m.usage;
    // Restored conversation prefixes are not new model calls, even when appended to a new session file.
    if (at < since || number(m.timestamp) < (state.startedAt ?? 0)) return;
    const counts = { input: number(u.input) + number(u.cacheRead) + number(u.cacheWrite), cached: number(u.cacheRead), cacheWrite: number(u.cacheWrite),
      output: number(u.output), reasoning: number(u.reasoning) };
    if (counts.input + counts.output <= 0) return;
    return { ...base, ...counts, model: m.model ?? base.model, id: `pi:${state.sessionId}:${d.id}`, source: 'pi-log' };
  }
}
