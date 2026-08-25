import { describe, expect, it } from "vitest";
import { aggregateScores, diagramMetrics, validateRanking } from "./metrics";
import type { GenerationRecord, StoredCrossJudgment, StoredWithinJudgment } from "./types";

describe("diagram experiment metrics", () => {
  it("extracts interpretable structural counts", () => {
    const metrics = diagramMetrics("input --> parse_config() --> TrainingConfig\n             +--> retry");
    expect(metrics.rows).toBe(2);
    expect(metrics.arrows).toBe(3);
    expect(metrics.implementationTokens).toBeGreaterThanOrEqual(2);
    expect(metrics.branchTerms).toBe(1);
  });

  it("rejects non-permutation judge rankings", () => {
    expect(() => validateRanking(["A", "A", "C"])).toThrow("invalid ranking");
  });

  it("subtracts same-value spread from perceived cross-value signal", () => {
    const generations = [0, 0.5, 1].map((value, index) => ({
      schemaVersion: 1,
      axis: "semantic_zoom",
      iteration: 1,
      value,
      replicate: 1,
      modelId: "gpt-5.6-sol",
      promptConfigId: "prompt",
      generatedAt: "2026-08-22T00:00:00.000Z",
      artifact: { name: String(value), ascii: "+-+", codeEntityIds: [] },
      metrics: diagramMetrics("+-+")
    })) satisfies GenerationRecord[];
    const diagrams = generations.map((record, index) => ({
      label: (["B", "C", "A"] as const)[index],
      generationPath: `${index}.json`,
      axisValue: record.value,
      replicate: 1,
      artifact: record.artifact
    }));
    const cross = [{
      schemaVersion: 1,
      kind: "cross-value",
      axis: "semantic_zoom",
      iteration: 1,
      modelId: "gpt-5.6-sol",
      diagrams,
      judgment: { orderLowToHigh: ["B", "C", "A"], confidence: 1, gapLowMid: 3, gapMidHigh: 3, offAxisChange: 0, invalidLabels: [], rationale: "ordered" },
      judgedAt: "2026-08-22T00:00:00.000Z"
    }] satisfies StoredCrossJudgment[];
    const within = [{
      schemaVersion: 1,
      kind: "within-value",
      axis: "semantic_zoom",
      iteration: 1,
      modelId: "gpt-5.6-sol",
      diagrams,
      judgment: { perceivedSpread: 1, offAxisSpread: 0, invalidLabels: [], rationale: "small" },
      judgedAt: "2026-08-22T00:00:00.000Z"
    }] satisfies StoredWithinJudgment[];
    const aggregate = aggregateScores({ axis: "semantic_zoom", iteration: 1, prompt: "test", generations, cross, within });
    expect(aggregate.pairwiseOrderingAccuracy).toBe(1);
    expect(aggregate.meanGapSignal).toBe(0.75);
    expect(aggregate.meanWithinValueSpread).toBe(0.25);
    expect(aggregate.distinguishabilityScore).toBe(0.5);
  });
});
