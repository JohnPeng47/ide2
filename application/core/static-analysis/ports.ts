import type { AnalysisArtifact, AnalysisView } from '../../../domain/core/static-analysis/schema';

/** A selection limits fact emission; imports may still be read for symbol resolution. */
export interface StaticAnalysisRequest {
  repositoryRoot: string;
  repositoryId: string;
  tsconfigPath: string;
  includePaths: readonly string[];
  views: readonly AnalysisView[];
  frameworks: readonly ('react' | 'zustand' | 'tldraw' | 'controller')[];
  metrics: { partitions: readonly ('directory' | 'layer' | 'single-group')[]; shuffleSeed: number; shuffleSamples: number };
}

/** Wall time, RSS and timestamps are deliberately outside deterministic persisted facts. */
export interface StaticAnalysisResult {
  artifact: AnalysisArtifact;
  measurements: { elapsedMs: number; peakRssBytes: number };
}
export interface StaticAnalyzer {
  analyze(request: StaticAnalysisRequest): Promise<StaticAnalysisResult>;
}
