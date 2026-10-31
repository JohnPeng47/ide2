import type { StaticAnalyzer } from '../../../application/core/static-analysis/ports';
import { AnalysisContext, sha } from './context';
import { Declarations } from './declarations';
import { deriveAnalysis } from '../../../domain/core/static-analysis/derive';
import { extractLexical } from './lexical';

export const staticAnalyzer: StaticAnalyzer = {
  async analyze(request) {
    const started = performance.now();
    const context = new AnalysisContext(request), declarations = new Declarations(context);
    declarations.index(); declarations.imports(); declarations.composition();
    if (request.views.some(view => view !== 'containment')) extractLexical(context, declarations);
    const artifact = context.finish();
    deriveAnalysis(artifact, request.metrics, sha);
    return { artifact, measurements: { elapsedMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024 } };
  },
};
