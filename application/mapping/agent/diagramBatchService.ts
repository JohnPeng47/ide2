import { randomUUID } from 'node:crypto';
import type { DiagramGenerator } from '../../../domain/core/diagrams/diagramGeneration';
import type { DiagramAgentContextStore } from '../../../domain/core/diagrams/diagramAgentContext';
import { DiagramEditService, type DiagramEditCanvasPort } from './diagramEditService';
import { directBatchSchemas, generationBatchSchemas, type DiagramBatchApplication, type DiagramBatchRun, type DiagramTool } from '../../../domain/mapping/agent/diagramBatch';
import { findBox } from '../../../domain/mapping/workspace/canvasDisplayNode';

interface Batch { signature: string; state: DiagramBatchRun; pending?: Promise<void>; child?: DiagramEditService; childRunId?: string; application?: DiagramBatchApplication; sessionId: string }
export class DiagramBatchService {
  private runs = new Map<string, Batch>();
  private requests = new Map<string, string>();
  constructor(private diagrams: DiagramGenerator, private canvas: DiagramEditCanvasPort & {
    batch(sessionId: string, input: DiagramBatchApplication): Promise<{ version: number; unresolvedEdgeIds: string[] }>
  }, private contexts?: DiagramAgentContextStore, private contextFor?: (sessionId: string, contextId: string) => import('../../../domain/core/agents/agentContext').AgentContextSnapshot) {}
  has(id: string) { return this.runs.has(id); }
  get(id: string) { const batch = this.runs.get(id); if (!batch) throw Error('Batch not found'); return structuredClone(batch.state); }
  async wait(id: string) { await this.runs.get(id)?.pending; return this.get(id); }
  cancel(id: string) {
    const batch = this.runs.get(id); if (!batch) throw Error('Batch not found');
    if (batch.state.status === 'generating') { batch.state.status = 'cancelled'; if (batch.childRunId) batch.child?.cancel(batch.childRunId); }
    return this.get(id);
  }
  start(raw: unknown, operation: DiagramTool, direct: boolean) {
    const input = (direct ? directBatchSchemas : generationBatchSchemas)[operation].parse(raw);
    const key = JSON.stringify([input.sessionId, input.requestId]), signature = JSON.stringify({ input, operation, direct });
    const old = this.requests.get(key);
    if (old) {
      const batch = this.runs.get(old)!;
      if (batch.signature !== signature) throw Error('REQUEST_ID_CONFLICT: batch arguments differ');
      if (batch.state.status === 'awaiting-acknowledgement' && !batch.pending) this.launch(batch, () => this.apply(batch));
      return this.get(old);
    }
    if (this.runs.size >= 500) throw Error('Diagram batch capacity reached; restart backend');
    const runId = `diagram-batch-${randomUUID()}`;
    const batch: Batch = { signature, sessionId: input.sessionId, state: { runId, operation, status: 'generating', results: [] } };
    this.runs.set(runId, batch); this.requests.set(key, runId);
    this.launch(batch, async () => {
      const revisions = input.operations.flatMap(item => [item.baseRevisionId, ...('references' in item ? item.references ?? [] : []).map(ref => ref.revisionId)]);
      const snapshot = await this.canvas.snapshot(input.sessionId, revisions.filter(id => id !== 'canvas'));
      if (snapshot.version !== input.expectedVersion) throw Error('VERSION_CONFLICT: reread the canvas');
      const application: DiagramBatchApplication = { requestId: runId, expectedVersion: input.expectedVersion, edits: [], creations: [] };
      // All inputs address the same snapshot. Multiple edits of one shared diagram would be ambiguous.
      const targets = new Set<string>();
      for (let index = 0; index < input.operations.length; index++) {
        batch.state.operationIndex = index;
        const item = input.operations[index], box = findBox(snapshot.document.scene.root, item.nodeId.slice(5));
        if (operation === 'edit-diagram' && box?.kind === 'diagram') {
          const id = snapshot.document.scene.contents[box.contentId].diagramId;
          if (targets.has(id)) throw Error('BATCH_TARGET_CONFLICT: combine edits to the same diagram in one operation');
          targets.add(id);
        }
      }
      let autoOffset = 0;
      for (let index = 0; index < input.operations.length; index++) {
        if (batch.state.status === 'cancelled') return;
        batch.state.operationIndex = index;
        const item = input.operations[index];
        const child = new DiagramEditService(this.diagrams, {
          snapshot: async (_id, ids) => {
            const extra = (ids ?? []).filter(id => id !== 'canvas' && !snapshot.revisions?.some(revision => revision.id === id));
            const retained = extra.length ? await this.canvas.snapshot(input.sessionId, extra) : undefined;
            if (retained && retained.version !== snapshot.version) throw Error('VERSION_CONFLICT: canvas changed');
            return { ...snapshot, revisions: [...(snapshot.revisions ?? []), ...(retained?.revisions ?? [])] };
          },
          apply: async (_id, edit) => { application.edits.push(edit); return { version: snapshot.version, unresolvedEdgeIds: [] }; },
          create: async (_id, creation) => {
            for (const diagram of creation.diagrams) {
              if (!item.origin) { diagram.position.column += autoOffset; autoOffset += Math.max(...diagram.content.ascii.split('\n').map(line => line.length)) + 6; }
              application.creations.push(diagram);
            }
            return { version: snapshot.version };
          }
        }, this.contexts);
        batch.child = child;
        const { edit, diagram, ...fields } = item as typeof item & { edit?: import('../../../domain/core/diagrams/generatedDiagramEdit').GeneratedDiagramEdit; diagram?: import('../../../domain/core/diagrams/generatedDiagramEdit').GeneratedDiagramEdit };
        const childRun = child.start({ ...fields, prompt: 'prompt' in fields ? fields.prompt : 'Apply supplied diagram',
          sessionId: input.sessionId, expectedVersion: snapshot.version, requestId: `${runId}:${index}` }, 'agentContextId' in fields && fields.agentContextId ? this.contextFor?.(input.sessionId, fields.agentContextId) : undefined, operation, direct ? edit ?? diagram : undefined);
        batch.childRunId = childRun.runId;
        const result = await child.wait(childRun.runId);
        if (this.get(runId).status === 'cancelled') return;
        if (result.status !== 'completed') throw Error(result.error ?? `Operation ${index} ${result.status}`);
        batch.state.results.push({ operationIndex: index, result: result.result, variants: result.variants, created: result.created });
      }
      batch.child = undefined; batch.childRunId = undefined; delete batch.state.operationIndex;
      batch.application = application;
      await this.apply(batch);
    });
    return this.get(runId);
  }
  private launch(batch: Batch, work: () => Promise<void>) {
    batch.pending = work().catch(error => {
      if (batch.state.status === 'cancelled') return;
      const message = String(error);
      batch.state.status = batch.state.status === 'applying' && /PERSISTENCE_PENDING|CANVAS_TIMEOUT|CANVAS_UNAVAILABLE/.test(message)
        ? 'awaiting-acknowledgement' : message.includes('VERSION_CONFLICT') ? 'conflict' : 'failed';
      batch.state.error = `${batch.state.operationIndex === undefined ? '' : `operations[${batch.state.operationIndex}]: `}${message}`;
    }).finally(() => { batch.pending = undefined; });
  }
  private async apply(batch: Batch) {
    batch.state.status = 'applying'; delete batch.state.error;
    const receipt = await this.canvas.batch(batch.sessionId, batch.application!);
    for (const result of batch.state.results) {
      if (result.result) { result.result.documentVersion = receipt.version; result.result.unresolvedEdgeIds = receipt.unresolvedEdgeIds; }
      if (result.created) result.created.documentVersion = receipt.version;
    }
    batch.state.documentVersion = receipt.version; batch.state.status = 'completed';
  }
  dispose() { for (const id of this.runs.keys()) this.cancel(id); }
}
