import { diagramPlacements } from '../../core/diagrams/diagramPlacement';
import type { PlacementBinding, PlacementLineage } from './placementLineage';
import { z } from 'zod';
import { CanvasHistory, documentFromHistory, type CanvasHistoryRecord } from '../../core/diagrams/canvasHistory';
import { importDiagramRevision } from '../../core/diagrams/diagramRevisionStore';
import { prepareCanvasTransfer } from '../../core/diagrams/canvasTransfer';
import { connectionBox } from '../../core/diagrams/diagramConnection';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { MappingDocumentController } from '../workspace/mappingDocumentController';
import { initialCanvasState } from '../workspace/mappingWorkspace';
import type { EvalOutputResult } from './evalOutputResult';
import type { DiagramJumpTarget } from '../../core/diagrams/diagramJump';
import type { SaveProjectDiagramInput } from '../../core/diagrams/projectDiagramCanvas';

const id = z.string().min(1).max(300);
export const outputPromotionSchema = z.object({
  requestId: z.string().uuid(), cellKey: id, canvasId: id.optional(), diagramId: id.optional(),
  destination: z.enum(['new-project', 'new-canvas', 'existing-canvas']),
  name: z.string().trim().min(1).max(120), canvasProjectId: id.optional(), repositoryId: id.optional(),
  targetCanvasId: id.optional(), expectedRevisionId: id.optional()
}).strict().superRefine((v, ctx) => {
  if (v.diagramId && !v.canvasId) ctx.addIssue({ code: 'custom', message: 'Choose the source canvas.' });
  if (v.destination === 'existing-canvas' && (!v.canvasId || !v.targetCanvasId || !v.expectedRevisionId))
    ctx.addIssue({ code: 'custom', message: 'Choose one source canvas and a current destination canvas.' });
});
export type OutputPromotion = z.infer<typeof outputPromotionSchema>;
export interface PromotionReceipt { placementLineage?: PlacementLineage; requestId: string; canvasProjectId?: string; canvases: { id: string; name: string }[] }
export interface PromotionPublication {
  requestId: string; signature: string;
  placementSource?: PlacementLineage['source'];
  canvasProject?: { id: string; name: string };
  documents: (SaveProjectDiagramInput & { id: string; canvasProjectId?: string; placementBindings?: PlacementBinding[] })[];
}

export function outputDiagramIds(result: EvalOutputResult, canvasId: string) {
  const canvas = result.canvases.find(c => c.id === canvasId);
  if (!canvas) throw Error('Output canvas not found');
  const ids: string[] = [];
  const visit = (box: typeof canvas.proposed.document.scene.root) => {
    if (box.kind === 'diagram') ids.push(`grid:${box.id}`); else box.children.forEach(visit);
  };
  visit(canvas.proposed.document.scene.root); return ids;
}

/** Copy the selected subject and its reachable canvas dependencies; never mutate the eval evidence. */
export function prepareOutputPromotion(result: EvalOutputResult, input: OutputPromotion,
  target?: { history: CanvasHistoryRecord; name: string; repositoryId?: string; canvasProjectId?: string }) {
  Object.values(result.diagramRevisions).forEach(importDiagramRevision);
  const picked = input.canvasId ? result.canvases.filter(c => c.id === input.canvasId) : result.canvases;
  if (!picked.length) throw Error('Output canvas not found');
  if (input.diagramId && !outputDiagramIds(result, input.canvasId!).includes(input.diagramId)) throw Error('Output diagram not found');
  const included = new Set(picked.map(c => c.id));
  const find = (id: string) => result.canvases.find(c => c.id === id || c.representationId === id);
  // Dependencies are copied intact so outgoing links never point at unpublished output IDs.
  for (const id of included) {
    const canvas = find(id)!;
    const doc = canvas.proposed.document;
    const jumps = [...Object.values(doc.scene.contents).flatMap(d => d.jumps ?? []), ...(doc.jumps ?? [])];
    for (const jump of jumps) { const dependency = find(jump.target.representationId); if (dependency) included.add(dependency.id); }
  }
  const sources = result.canvases.filter(c => included.has(c.id));
  const primary = picked[0];
  const ids = new Map(sources.map(c => [c.id, input.destination === 'existing-canvas' && c.id === primary.id
    ? input.targetCanvasId! : `representation-${crypto.randomUUID()}`]));
  let copied: ReturnType<typeof prepareCanvasTransfer> | undefined;
  if (input.diagramId || input.destination === 'existing-canvas') {
    const history = new CanvasHistory(primary.proposed.document, initialCanvasState()).export();
    copied = prepareCanvasTransfer(history, { mode: 'copy', sourceId: primary.id, sourceAliases: [primary.id, primary.representationId ?? primary.id],
      destinationId: ids.get(primary.id)!, selectedIds: input.diagramId ? [input.diagramId] : outputDiagramIds(result, primary.id),
      destinationView: target ? target.history.snapshots[target.history.headId].view : initialCanvasState() }, target?.history);
  }
  const selected = input.diagramId ? [input.diagramId] : outputDiagramIds(result, primary.id);
  const remap = (jump: DiagramJumpTarget): DiagramJumpTarget => {
    const source = find(jump.representationId); if (!source || !ids.has(source.id)) return jump;
    let mapped = { ...jump, representationId: ids.get(source.id)! };
    if (copied && source.id === primary.id && jump.displayNodeId) {
      const index = selected.indexOf(jump.displayNodeId);
      if (index < 0) throw Error('A linked canvas points to a diagram outside this selection. Promote the whole canvas to preserve that connection.');
      mapped = { ...mapped, displayNodeId: copied.selectedIds[index] };
      if (jump.contentNodeId) {
        const before = connectionBox(primary.proposed.document.scene, jump.displayNodeId)!;
        const after = connectionBox(copied.destination.document.scene, mapped.displayNodeId!)!;
        if (before.kind === 'diagram' && after.kind === 'diagram') {
          const node = diagramContentNodes(primary.proposed.document.scene.contents[before.contentId].content).find(n => n.id === jump.contentNodeId);
          const next = diagramContentNodes(copied.destination.document.scene.contents[after.contentId].content).find(n => node && n.line === node.line && n.startColumn === node.startColumn && n.endColumn === node.endColumn);
          if (next) mapped.contentNodeId = next.id;
        }
      }
    }
    return mapped;
  };
  const documents = sources.map(source => {
    const isPrimary = source.id === primary.id;
    const state = isPrimary && copied ? copied.destination : { document: source.proposed.document, view: initialCanvasState(), history: undefined };
    const controller = new MappingDocumentController(structuredClone(state.document), state.view as ReturnType<typeof initialCanvasState>, 0, undefined, undefined, state.history);
    const operations: Parameters<typeof controller.applyUpdate>[1] = [];
    const visit = (box: typeof state.document.scene.root) => {
      if (box.kind === 'container') box.children.forEach(visit);
      else { const diagram = state.document.scene.contents[box.contentId];
        if (diagram.jumps?.length) operations.push({ method: 'setJumps', nodeId: `grid:${box.id}`, jumps: diagram.jumps.map(j => ({ ...j, target: remap(j.target) })) }); }
    }; visit(state.document.scene.root);
    if (operations.length) controller.applyUpdate(0, operations);
    const doc = { ...controller.getSnapshot().document, jumps: (controller.getSnapshot().document.jumps ?? []).map(j => ({ ...j, target: remap(j.target) })) };
    const history = new CanvasHistory(documentFromHistory(controller.exportHistory()), state.view, controller.exportHistory());
    if (copied && isPrimary) history.retireTransactions(new Set([copied.transaction.id]));
    history.append(doc, state.view);
    const generatedPositions = diagramPlacements(source.proposed.document.scene, source.id);
    const promotedPositions = diagramPlacements(doc.scene, ids.get(source.id)!);
    const placementBindings: PlacementBinding[] = generatedPositions.flatMap(generated => {
      const selectedIndex = isPrimary && copied ? selected.indexOf(generated.diagramId) : -1;
      if (isPrimary && copied && selectedIndex < 0) return [];
      const destinationId = isPrimary && copied ? copied.selectedIds[selectedIndex] : generated.diagramId;
      const promoted = promotedPositions.find(p => p.diagramId === destinationId);
      if (!promoted) throw Error('Promoted diagram placement is missing');
      return [{ generated, promoted }];
    });
    return { placementBindings, id: ids.get(source.id)!, name: isPrimary ? target?.name ?? (input.destination === 'new-project' ? source.name : input.name) : source.name,
      type: 'standard' as const, scene: doc.scene, edges: doc.edges, history: history.export(),
      ...(isPrimary && target ? { representationId: input.targetCanvasId, expectedRevisionId: input.expectedRevisionId, repositoryId: target.repositoryId,
        canvasProjectId: target.canvasProjectId } : { repositoryId: source.repositoryId ?? input.repositoryId, canvasProjectId: input.canvasProjectId }) };
  });
  return documents;
}
