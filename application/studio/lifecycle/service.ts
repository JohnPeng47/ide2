import type { StudioContext } from '../context';
import { timestamp } from '../shared';

export async function recoverInterruptedRuns(context: StudioContext): Promise<void> {
  const workspace = await context.core.workspace();
  for (const run of Object.values(workspace.agentRuns)) {
    if (["queued", "reading-context", "generating", "validating"].includes(run.status)) {
      await context.store.saveRun({
        ...run,
        status: "interrupted",
        statusMessage: "server restarted before the run completed",
        error: "interrupted by server restart",
        updatedAt: timestamp(),
        completedAt: timestamp()
      });
    }
  }
  for (const batch of Object.values(workspace.generationBatches)) {
    if (["queued", "running", "validating"].includes(batch.status)) {
      await context.store.saveBatch({
        ...batch,
        status: "failed",
        error: "interrupted by server restart",
        updatedAt: timestamp()
      });
    }
  }
}

export function dispose(context: StudioContext): void {
  context.agents.dispose();
}
