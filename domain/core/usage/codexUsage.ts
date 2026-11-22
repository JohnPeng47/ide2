export interface TokenCounts {
  input: number; cached: number; cacheWrite: number; output: number; reasoning: number;
}
export interface UsageEvent extends TokenCounts {
  id: string; at: number; sessionId: string; model: string; effort: string; tier: string; source: string;
}
export interface BudgetSample {
  at: number; account: string; plan: string; limitId: string; usedPercent: number; resetsAt: number; windowMinutes: number;
}
export interface UsageRecords {
  startedAt: number; events: UsageEvent[]; samples: BudgetSample[];
  collectorAt: number | null; pollAttemptAt: number | null; pollError: string | null; collectorError: string | null;
}
export interface CostEstimate {
  model: string; effort: string; tokens: number; input: number; cached: number; output: number; reasoning: number;
  sessions: number; tiers: string[]; tokensPerPercent: number | null; range: [number, number] | null;
  evidence: 'collecting' | 'mixed' | 'early' | 'validated'; windows: number;
}
export interface CostStatistics {
  generatedAt: number; startedAt: number; collectorAt: number | null; pollAttemptAt: number | null;
  pollError: string | null; collectorError: string | null; latest: BudgetSample | null;
  estimates: CostEstimate[]; history: BudgetSample[]; totalTokens: number; sessionCount: number;
  calibration: { windows: number; percentagePoints: number; excludedWindows: number; validationError: number | null };
  recentAgents: { sessionId: string; model: string; effort: string; tokens: number; lastAt: number; source: string }[];
}
const groupKey = (e: Pick<UsageEvent, 'model' | 'effort'>) => JSON.stringify([e.model, e.effort]);
const total = (e: TokenCounts) => e.input + e.output; // Cached input is already included; reasoning is part of output.
interface Window { x: Map<string, number>; y: number }

/** Account deltas are quantized. Combine five-minute samples into non-overlapping 30–60 minute windows. */
function windows(samples: BudgetSample[], events: UsageEvent[]) {
  const result: Window[] = []; let excluded = 0, start = samples[0], previous = start, index = 0;
  for (const end of samples.slice(1)) {
    if (end.account !== previous.account || end.plan !== previous.plan || end.limitId !== previous.limitId
      || end.resetsAt !== previous.resetsAt || end.usedPercent < previous.usedPercent || end.at - previous.at > 15 * 60_000) {
      excluded++; start = end; previous = end; continue;
    }
    previous = end;
    const duration = end.at - start.at, delta = end.usedPercent - start.usedPercent;
    if (duration < 30 * 60_000 || (delta < 1 && duration < 60 * 60_000)) continue;
    while (index < events.length && events[index].at <= start.at) index++;
    const x = new Map<string, number>();
    while (index < events.length && events[index].at <= end.at) {
      const event = events[index++], key = groupKey(event); x.set(key, (x.get(key) ?? 0) + total(event) / 1e6);
    }
    const latest = samples.at(-1)!;
    if (x.size && end.account === latest.account && end.plan === latest.plan) result.push({ x, y: delta });
    else if (delta) excluded++;
    start = end;
  }
  return { result, excluded };
}

/** Reject columns that cannot be distinguished; don't invent individual rates for inseparable models. */
function identifiable(x: number[][], columns: number) {
  const vectors: number[][] = [];
  for (let j = 0; j < columns; j++) {
    const v = x.map(row => row[j]); const length = Math.hypot(...v);
    if (!length) return false;
    for (let i = 0; i < v.length; i++) v[i] /= length;
    for (const q of vectors) { const dot = v.reduce((s, n, i) => s + n * q[i], 0); for (let i = 0; i < v.length; i++) v[i] -= dot * q[i]; }
    const remaining = Math.hypot(...v); if (remaining < 0.05) return false;
    vectors.push(v.map(n => n / remaining));
  }
  return true;
}
function fit(x: number[][], y: number[], columns: number): number[] | null {
  if (x.length < columns + 2 || !identifiable(x, columns)) return null;
  const beta = Array<number>(columns).fill(0), residual = [...y];
  for (let iteration = 0; iteration < 1000; iteration++) {
    let change = 0;
    for (let j = 0; j < columns; j++) {
      let dot = 0, norm = 0;
      for (let i = 0; i < x.length; i++) { dot += x[i][j] * residual[i]; norm += x[i][j] ** 2; }
      const next = Math.max(0, beta[j] + dot / norm), diff = next - beta[j];
      beta[j] = next; change = Math.max(change, Math.abs(diff));
      for (let i = 0; i < x.length; i++) residual[i] -= x[i][j] * diff;
    }
    if (change < 1e-9) break;
  }
  return beta;
}
export function costStatistics(records: UsageRecords, now = Date.now()): CostStatistics {
  const events = [...records.events].sort((a, b) => a.at - b.at), samples = [...records.samples].sort((a, b) => a.at - b.at);
  const groups = new Map<string, CostEstimate>(), agents = new Map<string, CostStatistics['recentAgents'][number]>();
  for (const e of events) {
    const key = groupKey(e), row = groups.get(key) ?? { model: e.model, effort: e.effort, tokens: 0, input: 0, cached: 0, output: 0, reasoning: 0,
      sessions: 0, tiers: [], tokensPerPercent: null, range: null, evidence: 'collecting', windows: 0 };
    row.tokens += total(e); row.input += e.input; row.cached += e.cached; row.output += e.output; row.reasoning += e.reasoning;
    if (!row.tiers.includes(e.tier)) row.tiers.push(e.tier); groups.set(key, row);
    const agentKey = JSON.stringify([e.sessionId, key]), agent = agents.get(agentKey) ?? { sessionId: e.sessionId, model: e.model, effort: e.effort, tokens: 0, lastAt: 0, source: e.source };
    agent.tokens += total(e); agent.lastAt = Math.max(agent.lastAt, e.at); agents.set(agentKey, agent);
  }
  for (const row of groups.values()) row.sessions = [...agents.values()].filter(a => a.model === row.model && a.effort === row.effort).length;
  const { result: blocks, excluded } = windows(samples, events);
  const keys = [...new Set(blocks.flatMap(w => [...w.x.keys()]))];
  const x = blocks.map(w => keys.map(k => w.x.get(k) ?? 0)), y = blocks.map(w => w.y);
  const points = y.reduce((a, b) => a + b, 0), beta = points >= 2 && keys.length ? fit(x, y, keys.length) : null;
  let validationError: number | null = null;
  if (beta && blocks.length >= Math.max(10, keys.length + 5)) {
    const split = Math.floor(blocks.length * 0.75), trained = fit(x.slice(0, split), y.slice(0, split), keys.length);
    if (trained) validationError = x.slice(split).reduce((sum, row, i) => sum + Math.abs(row.reduce((s, n, j) => s + n * trained[j], 0) - y[split + i]), 0) / (blocks.length - split);
  }
  // Leave-one-window-out sensitivity, not a claim of a statistical confidence interval.
  const variants = beta && blocks.length >= keys.length + 4 ? blocks.map((_, omit) => fit(x.filter((_, i) => i !== omit), y.filter((_, i) => i !== omit), keys.length)).filter((b): b is number[] => !!b) : [];
  keys.forEach((key, j) => {
    const row = groups.get(key)!; row.windows = blocks.filter(w => w.x.has(key)).length;
    if (beta && beta[j] > 1e-9) {
      row.tokensPerPercent = 1e6 / beta[j];
      const values = variants.map(b => b[j] > 1e-9 ? 1e6 / b[j] : Infinity);
      if (values.length && values.every(Number.isFinite)) row.range = [Math.min(row.tokensPerPercent, ...values), Math.max(row.tokensPerPercent, ...values)];
      row.evidence = validationError !== null && validationError <= 0.5 && points >= 5 && row.windows >= 8 ? 'validated' : 'early';
    } else if (points >= 2 && blocks.length >= keys.length + 2) row.evidence = 'mixed';
  });
  return { generatedAt: now, startedAt: records.startedAt, collectorAt: records.collectorAt, pollAttemptAt: records.pollAttemptAt,
    pollError: records.pollError, collectorError: records.collectorError, latest: samples.at(-1) ?? null,
    estimates: [...groups.values()].sort((a, b) => b.tokens - a.tokens), history: samples.slice(-288),
    totalTokens: events.reduce((n, e) => n + total(e), 0), sessionCount: new Set(events.map(e => e.sessionId)).size,
    calibration: { windows: blocks.length, percentagePoints: points, excludedWindows: excluded, validationError },
    recentAgents: [...agents.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 50) };
}
