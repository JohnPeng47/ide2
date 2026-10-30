import { ApplicationError } from '../../core/errors';
import { sha256 } from '../../../domain/core/sha256';
import { generateComparisonSchema, generatedComparisonsSchema, summarizeComparisonRun, type ComparisonRun, type ComparisonInputDiagram, type GenerateComparison } from '../../../domain/mapping/compare/comparisonGeneration';
import { diagramTargets, type CompareSessionService } from './compareSessionService';

export interface ComparisonRunStore {
  list(): Promise<ComparisonRun[]>; read(id: string): Promise<ComparisonRun | null>; save(run: ComparisonRun): Promise<void>; delete(id: string): Promise<void>;
}
export interface ComparisonRuntime {
  generate(input: { diagrams: ComparisonInputDiagram[]; model: string; effort: string; signal: AbortSignal }): Promise<{ output: unknown; usage?: Record<string, number> }>;
}
export class ComparisonGenerationService {
  private ready: Promise<void>;
  private starts = new Map<string, Promise<ComparisonRun>>();
  private running = new Map<string, AbortController>();
  constructor(private comparisons: CompareSessionService, private store: ComparisonRunStore, private runtime: ComparisonRuntime) {
    this.ready = store.list().then(async runs => {
      for (const run of runs) if (run.status === 'queued' || run.status === 'generating') {
        // A crash after publishing the session must not lose the successful result.
        const saved = await comparisons.read(run.id).catch(() => undefined);
        await store.save({ ...run, status: saved ? 'finished' : 'failed', completedAt: new Date().toISOString(),
          ...(saved ? { sessionId: saved.id } : { error: 'Server restarted during comparison. Start a new run to retry.' }) });
      }
    });
    void this.ready.catch(() => {});
  }
  async list(documentId?: string) {
    await this.ready;
    return (await this.store.list()).filter(run => !documentId || run.request.sources.some(s => s.documentId === documentId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(summarizeComparisonRun);
  }
  async read(id: string) {
    await this.ready;
    const run = await this.store.read(id);
    if (!run) throw new ApplicationError('invalid-input', 'Comparison run not found.');
    return run;
  }
  async start(raw: unknown) {
    await this.ready;
    const input = generateComparisonSchema.parse(raw), hash = sha256(JSON.stringify(input));
    let pending = this.starts.get(input.requestId);
    if (!pending) {
      pending = (async () => {
        const existing = await this.store.read(input.requestId);
        return existing ?? this.prepare(input, hash);
      })();
      this.starts.set(input.requestId, pending);
    }
    try {
      const run = await pending;
      if (run.requestHash !== hash) throw new ApplicationError('conflict', 'Request ID already used for another comparison run.');
      return summarizeComparisonRun(run);
    } finally { if (this.starts.get(input.requestId) === pending) this.starts.delete(input.requestId); }
  }
  private async prepare(input: GenerateComparison, requestHash: string) {
    const captured = await this.comparisons.capture(input.sources);
    if (captured.canvases.some(copy => copy.view.generation && copy.view.generation.status !== 'finished'))
      throw new ApplicationError('invalid-input', 'Wait for selected alternatives to finish generation.');
    const diagrams = captured.canvases.flatMap(copy => diagramTargets(copy.history).map(target => ({
      id: '', name: `${copy.view.name} — ${target.name}`, canvasCopyId: copy.id, diagramId: target.diagramId, revisionId: target.revisionId,
      ascii: copy.history.diagramRevisions[target.revisionId].diagram.content.ascii
    }))).map((diagram, i) => ({ ...diagram, id: `D${i + 1}` }));
    if (captured.canvases.some(copy => !diagrams.some(diagram => diagram.canvasCopyId === copy.id)))
      throw new ApplicationError('invalid-input', 'Every selected view needs a diagram.');
    if (diagrams.length > 80 || diagrams.reduce((sum, d) => sum + d.ascii.length, 0) > 2_000_000)
      throw new ApplicationError('invalid-input', 'Select fewer or smaller diagrams.');
    const run: ComparisonRun = { id: input.requestId, request: input, requestHash, ...captured, diagrams,
      status: 'queued', createdAt: new Date().toISOString() };
    await this.store.save(run);
    const abort = new AbortController(); this.running.set(run.id, abort);
    void this.execute(structuredClone(run), abort.signal).finally(() => this.running.delete(run.id)).catch(() => {});
    return run;
  }
  private async execute(run: ComparisonRun, signal: AbortSignal) {
    try {
      run.status = 'generating'; await this.store.save(run);
      const result = await this.runtime.generate({ diagrams: run.diagrams, model: run.request.model, effort: run.request.effort, signal });
      signal.throwIfAborted();
      const output = generatedComparisonsSchema.parse(result.output), used = new Set<string>();
      const side = (target: typeof output.comparisons[number]['A']) => {
        const diagram = run.diagrams.find(diagram => diagram.id === target.diagram);
        if (!diagram) throw Error(`Unknown comparison diagram: ${target.diagram}`);
        const copy = run.canvases.find(copy => copy.id === diagram.canvasCopyId)!;
        used.add(copy.id);
        if (target.ranges.some(range => range.endLine > diagram.ascii.split('\n').length)) throw Error(`Slice exceeds ${diagram.id}`);
        return { ...copy.source, diagram: { diagramId: diagram.diagramId, revisionId: diagram.revisionId, ranges: target.ranges } };
      };
      const pairs = output.comparisons.map(comparison => {
        const A = side(comparison.A), B = side(comparison.B);
        if (A.documentId === B.documentId && A.viewId === B.viewId) throw Error('Comparison must use two distinct alternatives.');
        return { title: comparison.title, explanation: comparison.explanation, A, B };
      });
      if (used.size !== run.canvases.length) throw Error('The comparison omitted a selected alternative.');
      const session = await this.comparisons.createPinned({ requestId: run.id, title: run.request.title, pairs }, run);
      run.status = 'finished'; run.sessionId = session.id; run.usage = result.usage;
    } catch (error) { run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error); }
    run.completedAt = new Date().toISOString(); await this.store.save(run);
  }
  /** Removes a comparison run and the session it published, if any. */
  async delete(id: string) {
    await this.ready;
    this.running.get(id)?.abort();
    await this.store.delete(id);
    await this.comparisons.delete(id).catch(() => {});
  }
  dispose() { for (const abort of this.running.values()) abort.abort(); }
}
