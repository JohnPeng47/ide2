import { resolve } from "node:path";
import { FakeExperimentRuntime, SolExperimentRuntime } from "./runtime";
import { ExperimentRunner } from "./runner";

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function printPlan(): void {
  console.log(`Two-axis, two-iteration plan (all gpt-5.6-sol)

Iteration 1 per axis: 9 generation + 6 judgment + 1 analysis = 16
Iteration 2 per axis: 15 generation + 11 judgment + 1 analysis = 27
Per axis: 43
Total: 86 model runs (48 generation, 34 judgment, 4 analysis)`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "plan";
  if (command === "plan") { printPlan(); return; }
  if (command !== "run") throw new Error(`unknown command: ${command}`);
  const sourceRoot = resolve(option("--source", process.cwd())!);
  const outputRoot = resolve(option("--output", ".datasets/diagram-axis-control-semantic-topology-v1")!);
  const runtimeName = option("--runtime", "sol");
  const through = Number(option("--through", "2"));
  const concurrency = Number(option("--concurrency", runtimeName === "fake" ? "4" : "3"));
  if (through !== 1 && through !== 2) throw new Error("--through must be 1 or 2");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("--concurrency must be an integer from 1 to 8");
  const runtime = runtimeName === "fake" ? new FakeExperimentRuntime() : runtimeName === "sol" ? new SolExperimentRuntime() : undefined;
  if (!runtime) throw new Error("--runtime must be sol or fake");
  console.log(`experiment output: ${outputRoot}`);
  const runner = new ExperimentRunner({ sourceRoot, outputRoot, concurrency, runtime, log: (message) => console.log(`[${new Date().toISOString()}] ${message}`) });
  await runner.run(through as 1 | 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
