import { UsageStore } from '../../infrastructure/core/usage/usageStore';
import { UsageCollector } from '../../infrastructure/core/usage/usageCollector';
import { pollBudget } from '../../infrastructure/core/usage/codexBudget';
import { costStatistics } from '../../domain/core/usage/codexUsage';
const command = process.argv[2], store = new UsageStore();
if (command === 'poll') {
  try { const sample = await pollBudget(store); console.log(JSON.stringify({ at: sample.at, usedPercent: sample.usedPercent, resetsAt: sample.resetsAt })); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { store.close(); }
} else if (command === 'watch') {
  const collector = new UsageCollector(store);
  const scan = () => { try { collector.scan(); } catch (error) { store.set('collectorError', error instanceof Error ? error.message : String(error)); } };
  scan(); const timer = setInterval(scan, 5000);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { clearInterval(timer); store.close(); process.exit(0); });
} else if (command === 'status') {
  console.log(JSON.stringify(costStatistics(store.readRecords(Date.now() - 28 * 86400_000)), null, 2)); store.close();
} else { console.error('Usage: collector.ts poll|watch|status'); store.close(); process.exitCode = 1; }
