import type {
  AggregateScore,
  AxisId,
  DiagramLabel,
  DiagramMetrics,
  GenerationRecord,
  IterationNumber,
  StoredCrossJudgment,
  StoredWithinJudgment
} from "./types";

const count = (value: string, pattern: RegExp): number => [...value.matchAll(pattern)].length;

export function diagramMetrics(ascii: string): DiagramMetrics {
  const lines = ascii.split("\n");
  const columns = Math.max(0, ...lines.map((line) => line.length));
  const area = Math.max(1, lines.length * Math.max(1, columns));
  const nonWhitespace = ascii.replace(/\s/g, "").length;
  return {
    rows: lines.length,
    columns,
    nonWhitespaceRatio: nonWhitespace / area,
    boxJunctions: count(ascii, /\+/g),
    arrows: count(ascii, /(?:--?>|<--?|\^|\bv\b)/g),
    implementationTokens: count(ascii, /(?:\b[a-z]+_[a-z0-9_]+\b|\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b|\w+\(\)|\b\w+\.(?:py|ts|tsx|json|yaml|cpp|h)\b)/g),
    branchTerms: count(ascii, /\b(?:branch|join|retry|fallback|parallel|success|failure|loop|fan[- ]?out)\b/gi)
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function meanMetrics(records: GenerationRecord[]): DiagramMetrics {
  const fields: Array<keyof DiagramMetrics> = [
    "rows", "columns", "nonWhitespaceRatio", "boxJunctions", "arrows", "implementationTokens", "branchTerms"
  ];
  return Object.fromEntries(fields.map((field) => [field, round(mean(records.map((record) => record.metrics[field])))])) as unknown as DiagramMetrics;
}

function correctPairs(judgment: StoredCrossJudgment): { correct: number; exact: boolean } {
  const hidden = new Map(judgment.diagrams.map((diagram) => [diagram.label, diagram.axisValue]));
  const ordered = judgment.judgment.orderLowToHigh;
  let correct = 0;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if ((hidden.get(ordered[left]) ?? Infinity) < (hidden.get(ordered[right]) ?? -Infinity)) correct += 1;
    }
  }
  return { correct, exact: correct === 3 };
}

export function validateRanking(ranking: DiagramLabel[]): asserts ranking is [DiagramLabel, DiagramLabel, DiagramLabel] {
  if (ranking.length !== 3 || new Set(ranking).size !== 3 || ranking.some((label) => !["A", "B", "C"].includes(label))) {
    throw new Error(`judge returned an invalid ranking: ${ranking.join(", ")}`);
  }
}

export function aggregateScores(input: {
  axis: AxisId;
  iteration: IterationNumber;
  prompt: string;
  generations: GenerationRecord[];
  cross: StoredCrossJudgment[];
  within: StoredWithinJudgment[];
}): AggregateScore {
  const ordering = input.cross.map(correctPairs);
  const signal = input.cross.flatMap((item) => [item.judgment.gapLowMid, item.judgment.gapMidHigh]);
  const meanSignal = mean(signal) / 4;
  const noise = mean(input.within.map((item) => item.judgment.perceivedSpread)) / 4;
  const offAxis = [
    ...input.cross.map((item) => item.judgment.offAxisChange),
    ...input.within.map((item) => item.judgment.offAxisSpread)
  ];
  const grouped = new Map<number, GenerationRecord[]>();
  for (const record of input.generations) grouped.set(record.value, [...(grouped.get(record.value) ?? []), record]);
  return {
    axis: input.axis,
    iteration: input.iteration,
    prompt: input.prompt,
    generations: input.generations.length,
    crossComparisons: input.cross.length,
    withinComparisons: input.within.length,
    pairwiseOrderingAccuracy: round(mean(ordering.map((item) => item.correct / 3))),
    exactOrderingAccuracy: round(mean(ordering.map((item) => item.exact ? 1 : 0))),
    meanJudgeConfidence: round(mean(input.cross.map((item) => item.judgment.confidence))),
    meanGapSignal: round(meanSignal),
    meanGapBalance: round(mean(input.cross.map((item) => 1 - Math.abs(item.judgment.gapLowMid - item.judgment.gapMidHigh) / 4))),
    meanWithinValueSpread: round(noise),
    distinguishabilityScore: round(Math.max(0, meanSignal - noise)),
    meanOffAxisChange: round(mean(offAxis) / 4),
    invalidDiagramCount: new Set([
      ...input.cross.flatMap((item) => item.judgment.invalidLabels.map((label) => item.diagrams.find((diagram) => diagram.label === label)?.generationPath)),
      ...input.within.flatMap((item) => item.judgment.invalidLabels.map((label) => item.diagrams.find((diagram) => diagram.label === label)?.generationPath))
    ].filter(Boolean)).size,
    metricMeansByValue: Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a - b).map(([value, records]) => [value.toFixed(2), meanMetrics(records)]))
  };
}

export function judgeSummary(judgments: Array<StoredCrossJudgment | StoredWithinJudgment>): string[] {
  return judgments.map((item) => `${item.kind}: ${item.judgment.rationale}`);
}
