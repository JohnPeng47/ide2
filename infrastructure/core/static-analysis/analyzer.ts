import type { StaticAnalyzer } from '../../../application/core/static-analysis/ports';
import { AnalysisContext, sha } from './context';
import { Declarations } from './declarations';
import { deriveAnalysis } from '../../../domain/core/static-analysis/derive';
import { extractLexical } from './lexical';
import { Resources } from './resources';
import { extractCalls } from './calls';
import { extractFrameworks } from './frameworks';
import { extractDataflow } from './dataflow';
import { connectCallbackCandidates } from './callbacks';

export const staticAnalyzer: StaticAnalyzer = {
  async analyze(request) {
    const started = performance.now();
    const phasesMs: Record<string, number> = {}; let previous = started;
    const phase = (name: string) => { const now = performance.now(); phasesMs[name] = now - previous; previous = now; if (process.env.STATIC_ANALYSIS_PROFILE) console.error(JSON.stringify({ phase: name, elapsedMs: phasesMs[name], rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed })); };
    const context = new AnalysisContext(request), declarations = new Declarations(context);
    phase('parse');
    declarations.index(); declarations.imports(); declarations.composition();
    phase('containment');
    const references = request.views.some(view => view !== 'containment') ? extractLexical(context, declarations) : [];
    phase('lexical');
    if (request.views.some(view => ['calls', 'ownership', 'dependencies'].includes(view))) {
      const resources = new Resources(context, declarations); resources.initialize();
      phase('resources');
      const sites = extractCalls(context, declarations); phase('calls');
      extractFrameworks(context, declarations, resources, sites); phase('frameworks');
      if (request.views.some(view => ['ownership', 'dependencies'].includes(view))) {
        declarations.prepareDataflow(); phase('flow-symbols');
        context.releaseCompiler();
        extractDataflow(context, declarations, resources, references, sites);
        connectCallbackCandidates(context, declarations, sites);
      }
      phase('dataflow');
    }
    const artifact = context.finish();
    phase('snapshot');
    context.release(); references.length = 0;
    declarations.declarationOwners.clear(); declarations.receivers.clear(); declarations.scopeBindings.clear();
    deriveAnalysis(artifact, request.metrics, sha);
    phase('derive');
    return { artifact, measurements: { elapsedMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024, phasesMs } };
  },
};
