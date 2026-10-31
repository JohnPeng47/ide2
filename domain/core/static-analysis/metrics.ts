import type { AnalysisArtifact, AnalysisMetricReport } from './schema';

export interface MetricOptions { comparisonPartitionId?: string; shuffleSeed: number; shuffleSamples: number }

/** Phase 1 contract seam. Numerical oracles precede the Phase 2 implementation. */
export function evaluatePartition(_artifact: AnalysisArtifact, _partitionId: string, _layerId: string,
  _options: MetricOptions): AnalysisMetricReport {
  throw new Error('STATIC_ANALYSIS_METRICS_NOT_IMPLEMENTED: implement against independent numerical oracles in Phase 2');
}
