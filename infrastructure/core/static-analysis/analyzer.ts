import type { StaticAnalyzer } from '../../../application/core/static-analysis/ports';

/** Phase 1 seam only. No extraction or fixture-specific behavior belongs here yet. */
export const staticAnalyzer: StaticAnalyzer = {
  async analyze() {
    throw new Error('STATIC_ANALYZER_NOT_IMPLEMENTED: Phase 1 defines the contract; implement the pipeline in Phase 2');
  },
};
