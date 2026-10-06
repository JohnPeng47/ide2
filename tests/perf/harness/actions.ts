import type { Page } from '@playwright/test';
import './collector';

export type Point = [number, number];
export const line = (from: Point, to: Point, steps: number): Point[] => {
  if (!Number.isInteger(steps) || steps < 1) throw Error('steps must be a positive integer');
  return Array.from({ length: steps + 1 }, (_, i) => [
    from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps,
  ]);
};

export async function cadence(count: number, dispatch: (i: number) => Promise<unknown>, intervalMs = 16) {
  const lags: number[] = [], start = performance.now();
  for (let i = 0; i < count; i++) {
    const due = start + i * intervalMs, wait = due - performance.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lags.push(Math.max(0, performance.now() - due));
    await dispatch(i);
  }
  return lags;
}
export const paced = (page: Page, points: Point[], intervalMs = 16) =>
  cadence(points.length, i => page.mouse.move(...points[i]), intervalMs);

export async function act(page: Page, predicate: string, input: () => Promise<unknown>, eventType = 'click') {
  await page.evaluate(({ predicate, eventType }) => window.__perf.arm(predicate, eventType), { predicate, eventType });
  try {
    await input();
    await page.waitForFunction(() => window.__perf.outcome || window.__perf.error, null, { timeout: 30_000 });
    return await page.evaluate(() => {
      const c = window.__perf;
      if (c.error) throw Error(c.error);
      const first = c.inputs[0];
      if (!first || c.inputs.length !== 1 || !c.outcome) throw Error('Expected exactly one triggering input');
      c.flushTasks();
      const visibleMs = c.outcome.dom - first.created, settledMs = c.outcome.settled - first.created;
      if (visibleMs < 0 || settledMs < visibleMs) throw Error('Invalid collector clock/order');
      const end = c.outcome.settled;
      return { visibleMs, settledMs, inputs: c.inputs,
        longTasks: c.longTasks.filter(task => task.start < end && task.start + task.duration > first.created) };
    });
  } finally { if (!page.isClosed()) await page.evaluate(() => window.__perf.disarm()); }
}

export async function gesture(page: Page, input: () => Promise<number[]>) {
  await page.evaluate(() => window.__perf.recordFrames(true));
  let dispatchLag: number[];
  try {
    dispatchLag = await input();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally { if (!page.isClosed()) await page.evaluate(() => window.__perf.recordFrames(false)); }
  const { frames, longTasks } = await page.evaluate(() => {
    window.__perf.flushTasks();
    return { frames: window.__perf.frames, longTasks: window.__perf.longTasks };
  });
  const intervals = frames.slice(1).map((time, i) => time - frames[i]).sort((a, b) => a - b);
  if (!intervals.length || !dispatchLag.length) throw Error('Gesture produced no frame/input samples');
  const pick = (q: number) => intervals[Math.min(intervals.length - 1, Math.floor(q * intervals.length))];
  return { frames: intervals.length, p50: pick(.5), p95: pick(.95), max: intervals.at(-1)!,
    overBudgetMs: intervals.reduce((sum, dt) => sum + Math.max(0, dt - 16.7), 0),
    dispatchLagMax: Math.max(...dispatchLag), dispatchLag, timestamps: frames, longTasks };
}

// Wait for stable observable geometry, including camera inertia, outside the score.
export async function stableCanvas(page: Page, selector: string) {
  await page.evaluate(() => { delete (window as unknown as { __perfStable?: unknown }).__perfStable; });
  await page.waitForFunction(selector => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (!element) return false;
    const key = JSON.stringify([element.getBoundingClientRect().toJSON(), element.style.transform]);
    const state = window as unknown as { __perfStable?: { key: string; count: number } };
    state.__perfStable = state.__perfStable?.key === key
      ? { key, count: state.__perfStable.count + 1 } : { key, count: 1 };
    return state.__perfStable.count >= 8;
  }, selector, { polling: 'raf' });
}
