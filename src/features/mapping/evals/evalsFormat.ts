import type { GeneratedCanvas } from '../../../../domain/core/diagrams/generatedCanvas';
import type { EvalCellStatus, EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflows } from '../../../../domain/mapping/evals/evalWorkflows';

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export const UNKNOWN_PROMPT = 'Unknown prompt';

/** Runs are numbered oldest-first so a number never changes as new runs arrive. */
export function runNumbers(runs: EvalRunSummary[]) {
  return new Map([...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((run, i) => [run.id, i + 1]));
}
export const runTitle = (run: EvalRunSummary, number?: number) => `Run #${number ?? '?'} · ${evalWorkflows[run.workflow].label}`;
export const runProgress = (run: EvalRunSummary) => `${run.cells.filter(cell => cell.status === 'finished').length}/${run.cells.length}`;
export const runActive = (run: EvalRunSummary) => run.status === 'queued' || run.status === 'generating';

export const statusLabel: Record<EvalCellStatus | 'finished' | 'failed', string> = {
  queued: 'Queued', generating: 'Generating', finished: 'Finished', failed: 'Failed', skipped: 'Skipped'
};

export function promptLabel(prompt?: { name: string; version: number }) {
  return prompt ? `${prompt.name} v${prompt.version}` : UNKNOWN_PROMPT;
}
/** One-line provenance shown on preview and comparison panes. */
export function provenance(generated?: GeneratedCanvas) {
  if (!generated) return undefined;
  return [promptLabel(generated.prompt), generated.pass ? `pass ${generated.pass}` : '', generated.stage === 'legacy' ? 'legacy' : generated.stage]
    .filter(Boolean).join(' · ');
}
/** Provenance worth showing under a title; omitted when the canvas name already says it. */
export function provenanceDetail(name: string, generated?: GeneratedCanvas) {
  return generated && !name.startsWith(promptLabel(generated.prompt)) ? provenance(generated) : undefined;
}
export function relativeTime(iso: string) {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
export const tokens = (usage?: Record<string, number>) => usage?.total_tokens ?? (usage ? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) : undefined);
