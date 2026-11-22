import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import type { BudgetSample } from '../../../domain/core/usage/codexUsage';
import { UsageStore } from './usageStore';

/** Read-only protocol request: no thread, turn, model call, or agent tool is created. */
export function readCodexBudget(binary = process.env.NEW_DIAGRAM_CODEX_BIN || 'codex'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let done = false;
    const lines = createInterface({ input: child.stdout });
    const stop = () => {
      lines.close(); child.stdin.end(); child.kill('SIGTERM');
      const kill = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000); kill.unref();
    };
    const finish = (error?: Error, result?: unknown) => { if (done) return; done = true; clearTimeout(timeout); stop(); error ? reject(error) : resolve(result); };
    const timeout = setTimeout(() => finish(Error('Codex budget read timed out after 30 seconds.')), 30_000);
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', error => finish(error)); child.stdin.on('error', error => finish(error));
    child.on('exit', () => { if (!done) finish(Error('Codex budget reader exited before returning usage.')); });
    lines.on('line', line => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      if (reply.id !== 1 && reply.id !== 2) return;
      if (reply.error) { finish(Error(reply.error.message || 'Codex budget read failed.')); return; }
      if (reply.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'account/rateLimits/read' }); }
      else finish(undefined, reply.result);
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'new_diagram_usage', title: 'Usage statistics collector', version: '1.0.0' } } });
  });
}
export function weeklyBudget(raw: unknown, at = Date.now()): BudgetSample {
  const result = raw as { accountId?: string; rateLimits?: any; rateLimitsByLimitId?: Record<string, any> };
  const bucket = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  const week = [bucket?.primary, bucket?.secondary].find(window => window?.windowDurationMins === 10080);
  if (!week || !Number.isFinite(week.usedPercent) || week.usedPercent < 0 || week.usedPercent > 100 || !Number.isFinite(week.resetsAt)) throw Error('No weekly Codex allowance was returned for this account.');
  if (!result.accountId) throw Error('Codex did not return an account identity; refusing to combine unidentified budgets.');
  return { at, account: createHash('sha256').update(result.accountId).digest('hex'), plan: bucket.planType ?? 'unknown',
    limitId: bucket.limitId ?? 'codex', usedPercent: week.usedPercent, resetsAt: week.resetsAt * 1000, windowMinutes: week.windowDurationMins };
}
export async function pollBudget(store: UsageStore, read = readCodexBudget) {
  store.set('pollAttemptAt', Date.now());
  try { const sample = weeklyBudget(await read()); store.sample(sample); store.set('pollError', null); return sample; }
  catch (error) { store.set('pollError', error instanceof Error ? error.message : 'Budget read failed'); throw error; }
}
