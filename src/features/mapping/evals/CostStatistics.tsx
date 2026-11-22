import { useEffect, useState } from 'react';
import type { CostStatistics as Statistics } from '../../../../domain/core/usage/codexUsage';
import { readCostStatistics } from './evalsApi';
const count = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
const time = (n: number | null) => n === null ? 'Not yet recorded' : new Date(n).toLocaleString();
const evidence = { collecting: 'Collecting data', mixed: 'Need independent model activity', early: 'Early estimate', validated: 'Validated on later samples' };
export function CostStatistics() {
  const [stats, setStats] = useState<Statistics>(), [error, setError] = useState('');
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const result = await readCostStatistics(); if (!stopped) { setStats(result); setError(''); } }
      catch (error) { if (!stopped) setError(error instanceof Error ? error.message : 'Could not read cost statistics.'); }
      finally { if (!stopped) timer = setTimeout(refresh, 5000); }
    };
    void refresh(); return () => { stopped = true; clearTimeout(timer); };
  }, []);
  if (!stats) return <section className="cost-statistics"><h2>Cost statistics</h2><p role={error ? 'alert' : 'status'}>{error || 'Loading usage statistics…'}</p></section>;
  const latest = stats.latest, staleCollector = !stats.collectorAt || stats.generatedAt - stats.collectorAt > 60_000;
  const staleBudget = !latest || stats.generatedAt - latest.at > 11 * 60_000;
  const history = stats.history, firstAt = history[0]?.at ?? 0, span = Math.max(1, (history.at(-1)?.at ?? 0) - firstAt);
  // Separate reset periods so the chart never implies a continuous drop through a reset.
  const segments: typeof history[] = [];
  for (const sample of history) {
    const last = segments.at(-1)?.at(-1);
    if (!last || last.resetsAt !== sample.resetsAt || last.account !== sample.account || sample.usedPercent < last.usedPercent || sample.at - last.at > 15 * 60_000) segments.push([]);
    segments.at(-1)!.push(sample);
  }
  return <section className="cost-statistics" aria-label="Cost statistics">
    <header><h2>Cost statistics</h2><p>Estimated tokens per <strong>1 percentage point of weekly Codex usage</strong>, grouped by model and thinking level.</p></header>
    {error && <p role="alert" className="evals-error">{error}</p>}
    <div className="cost-summary">
      <div><span>Weekly allowance used</span><strong>{latest ? `${latest.usedPercent}%` : 'Waiting for first poll'}</strong>{latest && <progress max={100} value={latest.usedPercent} aria-label="Weekly allowance used" />}<small>{latest ? `${100 - latest.usedPercent}% remaining · ${latest.plan}` : 'Polled every 5 minutes'}</small></div>
      <div><span>Next reset</span><strong className="cost-date">{time(latest?.resetsAt ?? null)}</strong><small>Last budget poll: {time(latest?.at ?? null)}</small></div>
      <div><span>Tracked tokens · rolling 28 days</span><strong>{count(stats.totalTokens)}</strong><small>{stats.sessionCount} agent sessions · tracking since {time(stats.startedAt)}</small></div>
    </div>
    {(staleCollector || staleBudget || stats.pollError || stats.collectorError) && <div className="cost-health" role="status">
      {staleCollector && <p>Token collector is not reporting. Estimates may be incomplete.</p>}
      {staleBudget && <p>Weekly allowance data is missing or stale.</p>}
      {stats.pollError && <p>Budget poll: {stats.pollError}</p>}{stats.collectorError && <p>Token collection: {stats.collectorError}</p>}
    </div>}
    <h3>Current estimates</h3>
    <p className="evals-muted">Tokens include input (including cached input) plus output. Higher tokens per 1% means more work fits in the allowance. Estimates reflect the observed cache and speed mix; they are not dollar prices.</p>
    <div className="experiment-table-scroll"><table className="experiment-table" aria-label="Tokens per one percent of weekly usage">
      <thead><tr><th>Model</th><th>Thinking level</th><th>Tokens / 1% weekly usage</th><th>Evidence</th><th>Tracked tokens</th><th>Cached input</th><th>Speed tiers</th></tr></thead>
      <tbody>{stats.estimates.map(row => <tr key={`${row.model}:${row.effort}`}><th scope="row">{row.model}</th><td>{row.effort}</td>
        <td><strong>{row.tokensPerPercent === null ? 'Not enough data' : count(row.tokensPerPercent)}</strong>{row.range && <small>{count(row.range[0])}–{count(row.range[1])} sensitivity range</small>}</td>
        <td>{evidence[row.evidence]}<small>{row.windows} calibration windows · {row.sessions} sessions</small></td><td>{count(row.tokens)}<small>{count(row.input)} input · {count(row.output)} output</small></td>
        <td>{row.input ? `${(100 * row.cached / row.input).toFixed(1)}%` : '—'}</td><td>{row.tiers.join(', ')}</td></tr>)}
        {!stats.estimates.length && <tr><td colSpan={7}>Waiting for agent token usage. Collection runs automatically in the background.</td></tr>}
      </tbody></table></div>
    <p className="evals-muted">{stats.calibration.windows} calibration windows · {stats.calibration.percentagePoints.toFixed(1)} observed percentage points · {stats.calibration.excludedWindows} reset, gap, or untracked intervals excluded.
      {stats.calibration.validationError !== null && ` Prediction error on later samples: ${stats.calibration.validationError.toFixed(2)} percentage points per window.`}</p>
    <details><summary>How the estimate is calculated</summary><p>Five-minute allowance samples are combined into non-overlapping 30–60 minute windows to reduce rounding noise. A nonnegative regression estimates each model/thinking-level pair's share. At least two percentage points and enough independent windows are required. The sensitivity range shows how the estimate changes when one window is omitted; it is not a confidence interval.</p>
      <p>Coverage: persistent Codex and Pi sessions on this host, plus this app's ephemeral Codex runs. Other machines and external ephemeral runs are not captured. Usage sharing the account outside this coverage can bias estimates. A request crossing a time boundary is counted when its usage is reported. Unknown thinking levels are kept separate.</p></details>
    <h3>Weekly usage history</h3>
    {history.length > 1 ? <figure className="cost-history"><svg viewBox="0 0 800 180" role="img" aria-label="Weekly allowance used over time" preserveAspectRatio="none">
      {[0, 50, 100].map(value => <g key={value}><line x1="35" x2="795" y1={160 - value * 1.4} y2={160 - value * 1.4} stroke="currentColor" opacity=".15" /><text x="0" y={164 - value * 1.4} fill="currentColor" fontSize="12">{value}%</text></g>)}
      {segments.map((segment, i) => <polyline key={i} points={segment.map(s => `${35 + (s.at - firstAt) / span * 760},${160 - s.usedPercent * 1.4}`).join(' ')} fill="none" stroke="#fab283" strokeWidth="2" />)}
    </svg><figcaption>{time(firstAt)} — {time(history.at(-1)!.at)} · up to 24 hours</figcaption></figure> : <p className="evals-muted">The chart will appear after the next five-minute sample.</p>}
    <h3>Recent agent activity</h3>
    <div className="experiment-table-scroll"><table className="experiment-table" aria-label="Recent agent token usage"><thead><tr><th>Session</th><th>Model / thinking</th><th>Tokens</th><th>Last usage</th><th>Source</th></tr></thead>
      <tbody>{stats.recentAgents.map(a => <tr key={`${a.sessionId}:${a.model}:${a.effort}`}><td><code title={a.sessionId}>{a.sessionId.slice(0, 12)}…</code></td><td>{a.model} / {a.effort}</td><td>{count(a.tokens)}</td><td>{time(a.lastAt)}</td><td>{a.source}</td></tr>)}
        {!stats.recentAgents.length && <tr><td colSpan={5}>No usage recorded yet.</td></tr>}</tbody></table></div>
    <p className="evals-muted">Page refreshes every 5 seconds. Collector heartbeat: {time(stats.collectorAt)}. Budget polling does not run a model.</p>
  </section>;
}
