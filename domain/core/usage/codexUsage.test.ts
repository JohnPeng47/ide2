import { expect, it } from 'vitest';
import { costStatistics, type UsageRecords, type UsageEvent, type BudgetSample } from './codexUsage';
const start = Date.UTC(2026, 10, 14);
const event = (at: number, tokens: number, model = 'model-a'): UsageEvent => ({ id: String(at) + model, at, model, effort: 'high', tier: 'standard', sessionId: model,
  source: 'test', input: tokens - 100, cached: 0, cacheWrite: 0, output: 100, reasoning: 20 });
const sample = (at: number, usedPercent: number): BudgetSample => ({ at, usedPercent, account: 'account', plan: 'pro', limitId: 'codex', resetsAt: start + 7 * 86400_000, windowMinutes: 10080 });
function records(blocks: [number, number][]): UsageRecords {
  const events: UsageEvent[] = [], samples = [sample(start, 0)]; let percent = 0;
  blocks.forEach(([a, b], block) => {
    const at = start + block * 45 * 60_000;
    if (a) events.push(event(at + 10 * 60_000, a * 500_000));
    if (b) events.push(event(at + 15 * 60_000, b * 1_000_000, 'model-b'));
    for (let i = 1; i <= 9; i++) samples.push(sample(at + i * 5 * 60_000, percent + (i === 9 ? a + b : 0)));
    percent += a + b;
  });
  return { startedAt: start, events, samples, collectorAt: start, pollAttemptAt: start, pollError: null, collectorError: null };
}
it('learns tokens per one weekly percentage point by model and thinking level', () => {
  const data = records(Array.from({ length: 16 }, (_, i) => i % 2 ? [0, 2] : [2, 0]));
  const stats = costStatistics(data);
  expect(stats.estimates.find(e => e.model === 'model-a')?.tokensPerPercent).toBeCloseTo(500_000);
  expect(stats.estimates.find(e => e.model === 'model-b')?.tokensPerPercent).toBeCloseTo(1_000_000);
  expect(stats.calibration.validationError).toBeCloseTo(0);
  expect(stats.estimates.every(e => e.evidence === 'validated')).toBe(true);
});
it('does not invent rates when all models always run in the same proportion', () => {
  const stats = costStatistics(records(Array.from({ length: 10 }, () => [1, 1])));
  expect(stats.estimates.every(e => e.tokensPerPercent === null && e.evidence === 'mixed')).toBe(true);
});
it('waits for allowance movement rather than treating zero percent as infinite tokens', () => {
  const data = records([[1, 0], [1, 0]]); data.samples.forEach(s => s.usedPercent = 0);
  expect(costStatistics(data).estimates[0].tokensPerPercent).toBeNull();
});
it('preserves cached/reasoning breakdown without double counting and separates thinking levels', () => {
  const data = records([]); data.events = [{ ...event(start + 1, 1000), cached: 800 }, { ...event(start + 2, 2000), effort: 'low' }];
  const stats = costStatistics(data);
  expect(stats.totalTokens).toBe(3000); expect(stats.estimates).toHaveLength(2);
  expect(stats.estimates.find(e => e.effort === 'high')?.cached).toBe(800);
});
it('excludes reset and missing-poll boundaries and never fits negative consumption', () => {
  const data = records([[1, 0], [1, 0], [1, 0]]);
  data.samples[5] = { ...data.samples[5], resetsAt: start + 8 * 86400_000, usedPercent: 0 };
  data.samples = data.samples.filter((_, i) => i < 12 || i > 18);
  const stats = costStatistics(data); expect(stats.calibration.excludedWindows).toBeGreaterThan(0);
  expect(stats.estimates[0].tokensPerPercent).toBeNull();
});
it('does not blend historical rates from another account into the current account estimate', () => {
  const data = records(Array.from({ length: 10 }, () => [1, 0]));
  data.samples.at(-1)!.account = 'different-account';
  const stats = costStatistics(data);
  expect(stats.calibration.windows).toBe(0); expect(stats.estimates[0].tokensPerPercent).toBeNull();
});
