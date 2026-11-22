import { afterEach, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UsageStore } from './usageStore';
import { UsageCollector } from './usageCollector';
import { usageLogLine, type LogCursor } from './usageLogParser';
import { pollBudget, weeklyBudget } from './codexBudget';
const roots: string[] = []; afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
const at = Date.UTC(2026, 10, 14);
const line = (type: string, payload: unknown, time = at) => JSON.stringify({ type, timestamp: new Date(time).toISOString(), payload });
const usage = (input: number, output = 10) => ({ type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: input / 2, output_tokens: output, reasoning_output_tokens: 2 }, last_token_usage: { input_tokens: 100, output_tokens: 10 } } });
it('ingests appended records once across restarts and waits for complete JSON lines', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'usage-collector-')); roots.push(root);
  const file = path.join(root, 'session.jsonl'), db = path.join(root, 'usage.sqlite');
  const store = new UsageStore(db); store.set('startedAt', at);
  writeFileSync(file, [line('session_meta', { id: 'one', timestamp: new Date(at - 1000).toISOString() }), line('turn_context', { model: 'model', effort: 'high' }), line('event_msg', usage(200), at - 1)].join('\n') + '\n');
  const collector = new UsageCollector(store, [root]); collector.scan(at + 10);
  const update = line('event_msg', usage(400, 30), at + 1);
  appendFileSync(file, update.slice(0, 50)); collector.scan(at + 20); expect(store.readRecords(0).events).toHaveLength(0);
  appendFileSync(file, update.slice(50) + '\n' + line('event_msg', usage(400, 30), at + 2) + '\n');
  collector.scan(at + 30); store.close();
  const reopened = new UsageStore(db); new UsageCollector(reopened, [root]).scan(at + 40);
  expect(reopened.readRecords(0).events).toMatchObject([{ input: 200, cached: 100, output: 20, effort: 'high' }]); reopened.close();
});
it('does not charge inherited fork history and re-baselines counter decreases', () => {
  const state: LogCursor = { offset: 0, inode: 1, sessionId: 'fork', startedAt: at, forked: true, model: 'model', effort: 'low' };
  expect(usageLogLine(line('event_msg', usage(1000), at - 1), state, at)).toBeUndefined();
  expect(usageLogLine(line('event_msg', usage(1100, 20), at + 1), state, at)?.input).toBe(100);
  expect(usageLogLine(line('event_msg', usage(1), at + 2), state, at)).toBeUndefined();
  expect(usageLogLine(line('event_msg', usage(101, 20), at + 3), state, at)?.input).toBe(100);
});
it('normalizes Pi cached input and rejects restored assistant prefixes', () => {
  const state: LogCursor = { offset: 0, inode: 1, sessionId: 'pi', startedAt: at, effort: 'high' };
  const d = { type: 'message', id: 'msg', timestamp: new Date(at + 100).toISOString(), message: { role: 'assistant', provider: 'openai-codex', model: 'model', timestamp: at + 1,
    usage: { input: 100, cacheRead: 900, output: 20, reasoning: 10 } } };
  expect(usageLogLine(JSON.stringify(d), state, at)).toMatchObject({ input: 1000, cached: 900, output: 20, reasoning: 10 });
  d.message.timestamp = at - 1; expect(usageLogLine(JSON.stringify(d), state, at)).toBeUndefined();
});
it('finds the seven-day budget in either window and saves poll failures without fake samples', async () => {
  const raw = { accountId: 'private-account', rateLimits: { limitId: 'codex', planType: 'pro', primary: { windowDurationMins: 300, usedPercent: 5, resetsAt: at / 1000 },
    secondary: { windowDurationMins: 10080, usedPercent: 10, resetsAt: at / 1000 + 86400 } } };
  const weekly = weeklyBudget(raw, at); expect(weekly.usedPercent).toBe(10); expect(weekly.account).not.toContain('private-account');
  const store = new UsageStore(':memory:'); await pollBudget(store, async () => raw);
  await expect(pollBudget(store, async () => { throw Error('Offline'); })).rejects.toThrow('Offline');
  expect(store.readRecords(0).samples).toHaveLength(1); expect(store.get('pollError')).toBe('Offline'); store.close();
});
