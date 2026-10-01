import { randomUUID } from 'node:crypto';
import { CanvasHistory } from '../../../domain/core/diagrams/canvasHistory';
import type { DiagramService, DiagramRevisionResult } from '../../../domain/core/diagrams/diagramService';
import type { LiveDocumentSnapshot } from '../../../domain/mapping/agent/contracts';
import type { DiagramEditRun, DiagramRevisionApplication, EditDiagramInput } from '../../../domain/mapping/agent/diagramEdit';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';

export interface DiagramEditCanvasPort {
  snapshot(sessionId: string): Promise<LiveDocumentSnapshot>;
  apply(sessionId: string, input: DiagramRevisionApplication): Promise<{ version: number; unresolvedEdgeIds: string[] }>;
}
interface Run {
  input: EditDiagramInput;
  signature: string;
  state: DiagramEditRun;
  abort: AbortController;
  revision?: DiagramRevisionResult;
  pending?: Promise<void>;
}

/** A request owns both generation and installation; retries never rerun the model. */
export class DiagramEditService {
  private runs = new Map<string, Run>();
  private requests = new Map<string, string>();
  constructor(private readonly diagrams: DiagramService, private readonly canvas: DiagramEditCanvasPort) {}

  start(input: EditDiagramInput): DiagramEditRun {
    const key = JSON.stringify([input.sessionId, input.requestId]), signature = JSON.stringify(input);
    const existing = this.requests.get(key);
    if (existing) {
      const run = this.runs.get(existing)!;
      if (run.signature !== signature) throw Error('REQUEST_ID_CONFLICT: edit request differs');
      if (run.state.status === 'awaiting-acknowledgement' && !run.pending) this.launch(run, () => this.apply(run));
      return structuredClone(run.state);
    }
    if (this.runs.size >= 500) throw Error('Diagram edit run capacity reached; restart the backend');
    const run: Run = { input: structuredClone(input), signature, abort: new AbortController(), state: {
      runId: `diagram-edit-${randomUUID()}`, status: 'generating', nodeId: input.nodeId, baseRevisionId: input.baseRevisionId
    } };
    this.runs.set(run.state.runId, run); this.requests.set(key, run.state.runId);
    this.launch(run, () => this.generate(run));
    return structuredClone(run.state);
  }
  get(id: string) {
    const run = this.runs.get(id); if (!run) throw Error('Diagram edit run not found');
    return structuredClone(run.state);
  }
  cancel(id: string) {
    const run = this.runs.get(id); if (!run) throw Error('Diagram edit run not found');
    // Once application is dispatched its outcome can be unknown. Never call it cancelled.
    if (run.state.status === 'generating') {
      run.abort.abort(); run.state.status = 'cancelled'; run.state.message = 'Cancelled before application';
    }
    return structuredClone(run.state);
  }
  private launch(run: Run, work: () => Promise<void>) {
    run.pending = work().catch(error => {
      if (run.abort.signal.aborted && run.state.status !== 'applying') { run.state.status = 'cancelled'; return; }
      const message = error instanceof Error ? error.message : String(error);
      run.state.status = run.state.status === 'applying' && /CANVAS_TIMEOUT|CANVAS_UNAVAILABLE|PERSISTENCE_PENDING/.test(message)
        ? 'awaiting-acknowledgement' : message.includes('VERSION_CONFLICT') ? 'conflict' : 'failed';
      run.state.error = message;
    }).finally(() => { run.pending = undefined; });
  }
  private async generate(run: Run) {
    const { input, abort } = run;
    const snapshot = await this.canvas.snapshot(input.sessionId);
    abort.signal.throwIfAborted();
    if (snapshot.version !== input.expectedVersion) throw Error('VERSION_CONFLICT: read the canvas again');
    const box = input.nodeId.startsWith('grid:') && findBox(snapshot.document.scene.root, input.nodeId.slice(5));
    if (!box || box.kind !== 'diagram') throw Error('Expected diagram GridBox');
    const base = snapshot.document.scene.contents[box.contentId];
    if (base.revisionId !== input.baseRevisionId) throw Error('VERSION_CONFLICT: diagram base is no longer current');
    if (!snapshot.history) throw Error('Canvas history is required for diagram generation');
    // Validated portable history imports the exact browser-issued revision identities.
    new CanvasHistory(snapshot.document, snapshot.canvas, snapshot.history, 'current');
    const lines = base.content.ascii.split('\n');
    run.revision = await this.diagrams.generate({ input: { id: base.id, structureKind: base.content.structure.kind,
      source: base.sourceContext.binding, evidence: base.sourceContext.evidence },
      instruction: input.prompt, baseRevisionId: base.revisionId,
      context: { diagram: base, selection: { startLine: 1, endLine: lines.length, startColumn: 1,
        endColumn: Math.max(1, ...lines.map(line => line.length)) }, connections: snapshot.document.edges }
    }, { signal: abort.signal, onProgress: message => { if (run.state.status === 'generating') run.state.message = message; } });
    abort.signal.throwIfAborted();
    run.state.generated = { diagramId: run.revision.diagram.diagramId, revisionId: run.revision.revision.id,
      ascii: run.revision.diagram.content.ascii };
    await this.apply(run);
  }
  private async apply(run: Run) {
    run.state.status = 'applying'; delete run.state.error;
    const revision = run.revision!.revision, input = run.input;
    // The controller checks both versions at the mutation boundary, after generation.
    const result = await this.canvas.apply(input.sessionId, { requestId: run.state.runId,
      expectedVersion: input.expectedVersion, nodeId: input.nodeId, baseRevisionId: input.baseRevisionId, revision });
    run.state.result = { diagramId: revision.diagramId, previousRevisionId: input.baseRevisionId,
      revisionId: revision.id, documentVersion: result.version, unresolvedEdgeIds: result.unresolvedEdgeIds };
    run.state.status = 'completed'; run.state.message = 'Diagram revision installed and workspace persisted';
  }
  dispose() { for (const run of this.runs.values()) this.cancel(run.state.runId); }
}
