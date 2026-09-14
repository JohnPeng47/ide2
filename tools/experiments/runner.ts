import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  assertSevenBitAscii,
  normalizeAscii,
  type CodeEntitiesSetRecord,
  type DiagramSetRecord,
  type SystemPromptTemplateRecord
} from "../../domain/core/records/domain";
import { renderArtifactSystemPrompt } from "../../domain/core/prompts/prompt";
import { createGenerationPromptConfig } from "../../domain/studio/generation/prompt";
import { aggregateScores, diagramMetrics, judgeSummary, validateRanking } from "./metrics";
import { EXPERIMENT_MODEL_ID, type ExperimentRuntime } from "./runtime";
import type {
  AxisDefinition,
  AxisId,
  ExperimentManifest,
  GenerationRecord,
  IterationNumber,
  LabeledDiagram,
  StoredAnalysis,
  StoredCrossJudgment,
  StoredPromptConfig,
  StoredWithinJudgment
} from "../../domain/studio/experiments/types";

export const AXES: AxisDefinition[] = [
  {
    id: "semantic_zoom",
    label: "Semantic zoom",
    lowEndpoint: "conceptual",
    highEndpoint: "implementation-level",
    controls: "Whether nodes represent broad responsibilities or concrete functions, types, fields, file formats, call signatures, and atomic operations.",
    diagramSetId: "set-10cae3ba3a784489",
    baselinePrompt: "Semantic zoom control = {{value}} on a normalized 0-1 scale. At 0, show a few broad conceptual responsibilities. At 1, show implementation-level functions, types, fields, file formats, call signatures, and smaller atomic operations. Interpolate proportionally for intermediate values. Keep the architecture, relationships, layout character, and visible source anchoring as stable as possible while changing only semantic granularity."
  },
  {
    id: "topology",
    label: "Topology",
    lowEndpoint: "single-spine",
    highEndpoint: "branched mesh",
    controls: "Routing complexity: branches, joins, feedback paths, alternative routes, parallel paths, and cross-boundary connections.",
    diagramSetId: "set-79e4a25eaa5b4ce5",
    baselinePrompt: "Topology control = {{value}} on a normalized 0-1 scale. At 0, use one dominant reading spine with minimal branching. At 1, expose a branched mesh with parallel paths, joins, feedback paths, alternative routes, and lifecycle outcomes where supported by the supplied source. Interpolate proportionally for intermediate values. Keep semantic granularity, boundary hierarchy, annotation detail, density, and overall architecture as stable as possible while changing only routing structure."
  }
];

export const ITERATIONS = [
  { number: 1 as const, values: [0, 0.5, 1], replicates: 3 },
  { number: 2 as const, values: [0, 0.25, 0.5, 0.75, 1], replicates: 3 }
];

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  }));
}

function valueName(value: number): string {
  return `value-${value.toFixed(2)}`;
}

function renderAxisPrompt(template: string, value: number): string {
  if (!template.includes("{{value}}")) throw new Error("axis prompt must contain the literal {{value}} placeholder");
  return template.replaceAll("{{value}}", value.toFixed(2));
}

function iterationDirectory(outputRoot: string, axis: AxisId, iteration: IterationNumber): string {
  return join(outputRoot, "axes", axis, `iteration-${iteration}`);
}

function generationPath(outputRoot: string, axis: AxisId, iteration: IterationNumber, value: number, replicate: number): string {
  return join(iterationDirectory(outputRoot, axis, iteration), "generations", valueName(value), `replicate-${replicate}.json`);
}

function labeled(diagrams: GenerationRecord[], outputRoot: string, seed: number): LabeledDiagram[] {
  const labels = ["A", "B", "C"] as const;
  return diagrams.map((record, index) => ({
    label: labels[(index + seed) % 3],
    generationPath: relative(outputRoot, generationPath(outputRoot, record.axis, record.iteration, record.value, record.replicate)),
    axisValue: record.value,
    replicate: record.replicate,
    artifact: record.artifact
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export interface ExperimentRunnerOptions {
  sourceRoot: string;
  outputRoot: string;
  concurrency: number;
  runtime: ExperimentRuntime;
  log?: (message: string) => void;
}

export class ExperimentRunner {
  private readonly sourceRoot: string;
  private readonly outputRoot: string;
  private readonly concurrency: number;
  private readonly runtime: ExperimentRuntime;
  private readonly log: (message: string) => void;
  private manifest?: ExperimentManifest;
  private profile?: SystemPromptTemplateRecord;

  constructor(options: ExperimentRunnerOptions) {
    this.sourceRoot = resolve(options.sourceRoot);
    this.outputRoot = resolve(options.outputRoot);
    this.concurrency = Math.max(1, options.concurrency);
    this.runtime = options.runtime;
    this.log = options.log ?? (() => undefined);
  }

  private async initialize(): Promise<void> {
    const manifestPath = join(this.outputRoot, "experiment.json");
    const templates = await readJson<{ templates: SystemPromptTemplateRecord[] }>(join(this.sourceRoot, ".diagrams", "system-prompt-templates.json"));
    const profile = templates.templates.find((item) => item.id === "default");
    if (!profile) throw new Error("default diagram generation prompt profile not found");
    this.profile = profile;
    const existing = await readJsonIfExists<ExperimentManifest>(manifestPath);
    if (existing) {
      if (existing.modelId !== EXPERIMENT_MODEL_ID) throw new Error(`existing experiment uses ${existing.modelId}, not ${EXPERIMENT_MODEL_ID}`);
      if (resolve(existing.sourceRoot) !== this.sourceRoot) throw new Error("existing experiment sourceRoot differs");
      this.manifest = existing;
      return;
    }
    const now = new Date().toISOString();
    this.manifest = {
      schemaVersion: 1,
      id: "semantic-topology-axis-control-v1",
      status: "running",
      modelId: EXPERIMENT_MODEL_ID,
      sourceRoot: this.sourceRoot,
      defaultPromptProfile: {
        id: profile.id,
        version: profile.version,
        rendered: renderArtifactSystemPrompt({
          outputKind: "diagram",
          viewKind: "diagram",
          template: profile
        })
      },
      iterations: ITERATIONS,
      axes: AXES,
      createdAt: now,
      updatedAt: now
    };
    await writeJson(manifestPath, this.manifest);
  }

  private async source(axis: AxisDefinition): Promise<{ diagramSet: DiagramSetRecord; codeEntities: CodeEntitiesSetRecord }> {
    const root = join(this.sourceRoot, ".diagrams", "diagram-sets", axis.diagramSetId);
    const diagramSet = await readJson<DiagramSetRecord>(join(root, "diagram-set.json"));
    const codeEntities = await readJson<CodeEntitiesSetRecord>(join(root, "code-entities.json"));
    if (diagramSet.readiness !== "ready" || codeEntities.status !== "finalized") throw new Error(`${axis.diagramSetId} is not generation-ready`);
    return { diagramSet, codeEntities };
  }

  private async promptFor(axis: AxisDefinition, iteration: IterationNumber): Promise<string> {
    if (iteration === 1) return axis.baselinePrompt;
    const analysis = await readJson<StoredAnalysis>(join(iterationDirectory(this.outputRoot, axis.id, 1), "analysis.json"));
    return analysis.analysis.revisedPromptBlock;
  }

  private async generate(axis: AxisDefinition, iteration: IterationNumber, prompt: string): Promise<GenerationRecord[]> {
    const spec = ITERATIONS[iteration - 1];
    const source = await this.source(axis);
    const tasks = spec.values.flatMap((value) => Array.from({ length: spec.replicates }, (_, index) => ({ value, replicate: index + 1 })));
    const records = new Map<string, GenerationRecord>();
    await mapLimit(tasks, this.concurrency, async ({ value, replicate }) => {
      const path = generationPath(this.outputRoot, axis.id, iteration, value, replicate);
      const existing = await readJsonIfExists<GenerationRecord>(path);
      if (existing) {
        records.set(`${value}:${replicate}`, existing);
        this.log(`resume generation ${axis.id} i${iteration} v${value.toFixed(2)} r${replicate}`);
        return;
      }
      const conditionDirectory = dirname(path);
      const promptConfigPath = join(conditionDirectory, "prompt-config.json");
      const instruction = renderAxisPrompt(prompt, value);
      const built = createGenerationPromptConfig({
        id: `experiment-${axis.id.replace("_", "-")}-i${iteration}-v${value.toFixed(2).replace(".", "-")}`,
        diagramSet: source.diagramSet,
        codeEntities: source.codeEntities,
        diagrams: [],
        components: [],
        outputKind: "diagram",
        modelId: EXPERIMENT_MODEL_ID,
        profile: this.profile!,
        instruction,
        selectedCodeEntityIds: source.codeEntities.entities.map((entity) => entity.id),
        createdAt: this.manifest!.createdAt
      });
      if (!await readJsonIfExists<StoredPromptConfig>(promptConfigPath)) {
        await writeJson(promptConfigPath, {
          schemaVersion: 1,
          axis: axis.id,
          iteration,
          value,
          axisPrompt: prompt,
          generationPromptConfig: built.config
        } satisfies StoredPromptConfig);
      }
      this.log(`start generation ${axis.id} i${iteration} v${value.toFixed(2)} r${replicate}`);
      const draft = await this.runtime.generate({
        axis,
        value,
        replicate,
        generation: {
          sourceRoot: source.diagramSet.sourceCheckoutRoot,
          diagramSetName: source.diagramSet.name,
          promptConfig: built.config,
          allowedCodeEntityAliases: built.allowedCodeEntityAliases,
          codeEntities: built.allowedCodeEntities,
          allowedDiagramIds: [],
          allowedDiagramComponentIds: [],
          slot: replicate,
          total: spec.replicates
        }
      });
      const ascii = normalizeAscii(draft.ascii);
      assertSevenBitAscii(ascii);
      const unknown = draft.codeEntityIds.filter((id) => !built.allowedCodeEntityIds.includes(id));
      if (unknown.length) throw new Error(`generation returned unknown CodeEntity ids: ${unknown.join(", ")}`);
      const record: GenerationRecord = {
        schemaVersion: 1,
        axis: axis.id,
        iteration,
        value,
        replicate,
        modelId: EXPERIMENT_MODEL_ID,
        promptConfigId: built.config.id,
        generatedAt: new Date().toISOString(),
        artifact: { ...draft, ascii, codeEntityIds: [...new Set(draft.codeEntityIds)] },
        metrics: diagramMetrics(ascii)
      };
      await writeJson(path, record);
      records.set(`${value}:${replicate}`, record);
      this.log(`complete generation ${axis.id} i${iteration} v${value.toFixed(2)} r${replicate}`);
    });
    return tasks.map(({ value, replicate }) => records.get(`${value}:${replicate}`)!);
  }

  private async judge(axis: AxisDefinition, iteration: IterationNumber, generations: GenerationRecord[]): Promise<{
    cross: StoredCrossJudgment[];
    within: StoredWithinJudgment[];
  }> {
    const spec = ITERATIONS[iteration - 1];
    const by = (value: number, replicate: number) => generations.find((item) => item.value === value && item.replicate === replicate)!;
    const windows = iteration === 1 ? [[0, 0.5, 1]] : [[0, 0.5, 1], [0.25, 0.5, 0.75]];
    const crossTasks = windows.flatMap((values, windowIndex) => Array.from({ length: spec.replicates }, (_, index) => ({ values, window: windowIndex + 1, replicate: index + 1 })));
    const cross = new Map<string, StoredCrossJudgment>();
    const judgmentRoot = join(iterationDirectory(this.outputRoot, axis.id, iteration), "judgments");
    await mapLimit(crossTasks, this.concurrency, async (task, index) => {
      const key = `cross-r${task.replicate}-window${task.window}`;
      const path = join(judgmentRoot, `${key}.json`);
      const existing = await readJsonIfExists<StoredCrossJudgment>(path);
      if (existing) { cross.set(key, existing); this.log(`resume judgment ${axis.id} i${iteration} ${key}`); return; }
      const diagrams = labeled(task.values.map((value) => by(value, task.replicate)), this.outputRoot, index + iteration);
      this.log(`start judgment ${axis.id} i${iteration} ${key}`);
      const judgment = await this.runtime.judgeCross(axis, diagrams);
      validateRanking(judgment.orderLowToHigh);
      const stored: StoredCrossJudgment = { schemaVersion: 1, kind: "cross-value", axis: axis.id, iteration, modelId: EXPERIMENT_MODEL_ID, diagrams, judgment, judgedAt: new Date().toISOString() };
      await writeJson(path, stored);
      cross.set(key, stored);
      this.log(`complete judgment ${axis.id} i${iteration} ${key}`);
    });
    const within = new Map<string, StoredWithinJudgment>();
    await mapLimit(spec.values, this.concurrency, async (value, index) => {
      const key = `within-${valueName(value)}`;
      const path = join(judgmentRoot, `${key}.json`);
      const existing = await readJsonIfExists<StoredWithinJudgment>(path);
      if (existing) { within.set(key, existing); this.log(`resume judgment ${axis.id} i${iteration} ${key}`); return; }
      const diagrams = labeled([1, 2, 3].map((replicate) => by(value, replicate)), this.outputRoot, index + iteration + 1);
      this.log(`start judgment ${axis.id} i${iteration} ${key}`);
      const judgment = await this.runtime.judgeWithin(axis, diagrams);
      const stored: StoredWithinJudgment = { schemaVersion: 1, kind: "within-value", axis: axis.id, iteration, modelId: EXPERIMENT_MODEL_ID, diagrams, judgment, judgedAt: new Date().toISOString() };
      await writeJson(path, stored);
      within.set(key, stored);
      this.log(`complete judgment ${axis.id} i${iteration} ${key}`);
    });
    return {
      cross: crossTasks.map((task) => cross.get(`cross-r${task.replicate}-window${task.window}`)!),
      within: spec.values.map((value) => within.get(`within-${valueName(value)}`)!)
    };
  }

  private async analyze(axis: AxisDefinition, iteration: IterationNumber, prompt: string, generations: GenerationRecord[], judgments: {
    cross: StoredCrossJudgment[];
    within: StoredWithinJudgment[];
  }): Promise<StoredAnalysis> {
    const path = join(iterationDirectory(this.outputRoot, axis.id, iteration), "analysis.json");
    const existing = await readJsonIfExists<StoredAnalysis>(path);
    if (existing) { this.log(`resume analysis ${axis.id} i${iteration}`); return existing; }
    const aggregate = aggregateScores({ axis: axis.id, iteration, prompt, generations, ...judgments });
    await writeJson(join(iterationDirectory(this.outputRoot, axis.id, iteration), "aggregate.json"), aggregate);
    const previousAggregate = iteration === 2
      ? (await readJson<StoredAnalysis>(join(iterationDirectory(this.outputRoot, axis.id, 1), "analysis.json"))).aggregate
      : undefined;
    this.log(`start analysis ${axis.id} i${iteration}`);
    const analysis = await this.runtime.analyze({
      axis,
      iteration,
      currentPrompt: prompt,
      aggregateJson: JSON.stringify(previousAggregate ? { iteration1: previousAggregate, iteration2: aggregate } : aggregate, null, 2),
      judgeNotes: judgeSummary([...judgments.cross, ...judgments.within])
    });
    if (!analysis.revisedPromptBlock.includes("{{value}}")) throw new Error("analyst recommendation omitted the literal {{value}} placeholder");
    const promptWordLimit = iteration === 1 ? 180 : 240;
    if (analysis.revisedPromptBlock.trim().split(/\s+/).length > promptWordLimit) {
      throw new Error(`analyst recommendation exceeded ${promptWordLimit} words`);
    }
    const stored: StoredAnalysis = { schemaVersion: 1, axis: axis.id, iteration, modelId: EXPERIMENT_MODEL_ID, aggregate, analysis, analyzedAt: new Date().toISOString() };
    await writeJson(path, stored);
    this.log(`complete analysis ${axis.id} i${iteration}`);
    return stored;
  }

  private async writeReport(): Promise<void> {
    const sections: string[] = ["# Semantic Zoom and Topology Control Experiment", "", `Model for every LLM role: \`${EXPERIMENT_MODEL_ID}\``, ""];
    const analyses = new Map<string, StoredAnalysis>();
    for (const axis of AXES) {
      for (const spec of ITERATIONS) {
        const analysis = await readJsonIfExists<StoredAnalysis>(join(iterationDirectory(this.outputRoot, axis.id, spec.number), "analysis.json"));
        if (analysis) analyses.set(`${axis.id}:${spec.number}`, analysis);
      }
    }
    sections.push("## Result summary", "", "| Axis | Iteration 1 | Iteration 2 | Delta | Best tested prompt |", "|---|---:|---:|---:|---|");
    for (const axis of AXES) {
      const first = analyses.get(`${axis.id}:1`);
      const second = analyses.get(`${axis.id}:2`);
      if (!first || !second) continue;
      const delta = Math.round((second.aggregate.distinguishabilityScore - first.aggregate.distinguishabilityScore) * 1000) / 1000;
      sections.push(`| ${axis.label} | ${first.aggregate.distinguishabilityScore} | ${second.aggregate.distinguishabilityScore} | ${delta >= 0 ? "+" : ""}${delta} | Iteration ${delta >= 0 ? "2" : "1"} |`);
    }
    sections.push("", "Iteration 2 recommendations are untested follow-up candidates, not measured third iterations.", "");
    for (const axis of AXES) {
      sections.push(`## ${axis.label}`, "");
      for (const spec of ITERATIONS) {
        const analysis = analyses.get(`${axis.id}:${spec.number}`);
        if (!analysis) continue;
        const score = analysis.aggregate;
        sections.push(
          `### Iteration ${spec.number}`,
          "",
          `- Pairwise ordering accuracy: ${score.pairwiseOrderingAccuracy}`,
          `- Exact ordering accuracy: ${score.exactOrderingAccuracy}`,
          `- Gap signal: ${score.meanGapSignal}`,
          `- Within-value spread: ${score.meanWithinValueSpread}`,
          `- Distinguishability score: ${score.distinguishabilityScore}`,
          `- Off-axis change: ${score.meanOffAxisChange}`,
          "",
          `Tested control block:\n\n${score.prompt}`,
          "",
          `${spec.number === 1 ? "Sol revision tested in iteration 2" : "Sol final follow-up candidate (untested)"}:\n\n${analysis.analysis.revisedPromptBlock}`,
          ""
        );
      }
    }
    await writeFile(join(this.outputRoot, "REPORT.md"), `${sections.join("\n")}\n`, "utf8");
  }

  async run(through: IterationNumber = 2): Promise<void> {
    await this.initialize();
    try {
      for (const spec of ITERATIONS.filter((item) => item.number <= through)) {
        for (const axis of AXES) {
          const prompt = await this.promptFor(axis, spec.number);
          const generations = await this.generate(axis, spec.number, prompt);
          const judgments = await this.judge(axis, spec.number, generations);
          await this.analyze(axis, spec.number, prompt, generations, judgments);
        }
      }
      await this.writeReport();
      if (through === 2) {
        this.manifest = { ...this.manifest!, status: "complete", updatedAt: new Date().toISOString() };
        await writeJson(join(this.outputRoot, "experiment.json"), this.manifest);
      }
    } finally {
      this.runtime.dispose();
    }
  }
}
