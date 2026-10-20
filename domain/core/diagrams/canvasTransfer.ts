import { rebaseDiagramHighlights } from './diagramHighlight';
import { correspondingNodes } from './diagramRevisionEditor';
import { placeTransferredGroup } from './canvasTransferPlacement';
import { z } from 'zod';
import { CanvasHistory, documentFromHistory, type CanvasHistoryRecord, type ResolvedCanvasDocument } from './canvasHistory';
import { rebaseDiagramJumps, type DiagramJumpTarget } from './diagramJump';
import { RevisionedDiagramService } from './diagramService';
import { diagramContentNodes } from './diagramContentNodes';
import { connectionBox, getArrowLabel, validateConnectionAnchor } from './diagramConnection';
import { flattenGrid, resolveScene, type GridBox, type LineGridScene } from './lineGrid';

import type { CanvasJump } from './canvasJump';
export const canvasTransferSchema = z.object({
  destinationCreated: z.boolean().optional(),
  id: z.string().min(1), mode: z.enum(['copy', 'move']), applied: z.boolean(), discarded: z.boolean().optional(),
  sourceId: z.string().min(1), destinationId: z.string().min(1),
  sourceBefore: z.string().min(1), sourceAfter: z.string().min(1),
  destinationBefore: z.string().min(1), destinationAfter: z.string().min(1)
}).strict();
export type CanvasTransfer = z.infer<typeof canvasTransferSchema>;
export interface TransferInput {
  mode: 'copy' | 'move'; sourceId: string; sourceAliases: string[]; destinationId: string;
  selectedIds: string[]; destinationView: unknown; sourceView?: unknown;
}
export interface TransferState { document: ResolvedCanvasDocument; history: CanvasHistoryRecord; view: unknown }
export interface PreparedCanvasTransfer { transaction: CanvasTransfer; source: TransferState; destination: TransferState; selectedIds: string[] }
const fresh = (kind: string) => `${kind}-${crypto.randomUUID()}`;
export const emptyCanvasDocument = (): ResolvedCanvasDocument => ({ scene: { contents: {}, root: { id: 'root', kind: 'container',
  position: { column: 0, row: 0 }, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [] } }, edges: [], sections: {} });
const state = (history: CanvasHistory): TransferState => ({ document: history.document(), history: history.export(), view: history.head.view });

/** Preparation operates on isolated histories. Publication belongs to the workspace transaction. */
export function prepareCanvasTransfer(record: CanvasHistoryRecord, input: TransferInput, destinationRecord?: CanvasHistoryRecord): PreparedCanvasTransfer {
  if (input.sourceId === input.destinationId) throw Error('Choose another canvas as the destination');
  const diagrams = new RevisionedDiagramService();
  const original = new CanvasHistory(documentFromHistory(record), {}, record), before = original.document();
  if (!input.selectedIds.length || new Set(input.selectedIds).size !== input.selectedIds.length) throw Error('Select one or more diagrams');
  const existing = destinationRecord ? documentFromHistory(destinationRecord) : emptyCanvasDocument();
  const destination = new CanvasHistory(existing, input.destinationView, destinationRecord);
  const existingIds = new Set<string>();
  const visitIds = (box: GridBox) => { existingIds.add(box.id); if (box.kind === 'container') box.children.forEach(visitIds); };
  visitIds(existing.scene.root);
  const selected = new Set(input.selectedIds);
  for (const id of selected) if (connectionBox(before.scene, id)?.kind !== 'diagram') throw Error('Selection must contain only diagrams');
  const expand = (box: GridBox): GridBox => box.kind === 'container' ? { ...box, collapsed: false, children: box.children.map(expand) } : box;
  const boxes = flattenGrid(resolveScene({ ...before.scene, root: expand(before.scene.root) })).filter(({ box }) => selected.has(`grid:${box.id}`));
  const minColumn = Math.min(...boxes.map(box => box.bounds.column)), minRow = Math.min(...boxes.map(box => box.bounds.row));
  const boxIds = new Map(boxes.map(({ box }) => [box.id, input.mode === 'copy' || existingIds.has(box.id) ? fresh('diagram') : box.id]));
  const contentIds = new Map<string, string>();
  const target = emptyCanvasDocument(), contents: Record<string, LineGridScene['contents'][string]> = {};
  const sections: Record<string, ResolvedCanvasDocument['sections'][string]> = {};
  const cloneContent = (id: string) => {
    if (!contentIds.has(id)) {
      const next = input.mode === 'copy' || Object.hasOwn(existing.scene.contents, id) ? fresh('diagram-content') : id;
      contentIds.set(id, next);
      const old = before.scene.contents[id];
      if (next === id) contents[next] = old;
      else {
        const created = diagrams.create({ id: next, revision: 0, ascii: old.content.ascii,
          structureKind: old.content.structure.kind, source: old.sourceContext.binding,
          mappings: old.sourceContext.mappings, evidence: old.sourceContext.evidence }).diagram;
        const annotated = old.highlights ? diagrams.revise(created.revisionId, { kind: 'highlights',
          highlights: rebaseDiagramHighlights(old.highlights, correspondingNodes(old, created)) }).diagram : created;
        contents[next] = old.jumps ? diagrams.revise(annotated.revisionId,
          { kind: 'jumps', jumps: rebaseDiagramJumps(old.content, created.content, old.jumps) }).diagram : annotated;
      }
      if (before.sections[id]) sections[next] = structuredClone(before.sections[id]);
    }
    return contentIds.get(id)!;
  };
  const children = boxes.map(({ box, bounds }) => {
    if (box.kind !== 'diagram') throw Error('Expected diagram');
    return { ...structuredClone(box), id: boxIds.get(box.id)!, contentId: cloneContent(box.contentId),
      collapsedContentId: box.collapsedContentId ? cloneContent(box.collapsedContentId) : undefined,
      position: { column: bounds.column - minColumn, row: bounds.row - minRow } };
  });
  target.scene = { contents, root: { ...target.scene.root, kind: 'container', layout: { collisionPolicy: 'push-right', gap: 3 }, children } };
  target.sections = sections;
  const remapNode = (displayNodeId: string, nodeId: string) => {
    const box = connectionBox(before.scene, displayNodeId);
    if (box?.kind !== 'diagram') throw Error('Expected diagram node target');
    const old = diagramContentNodes(before.scene.contents[box.contentId].content).find(node => node.id === nodeId);
    if (!old) return nodeId; // Preserve explicitly stale links as stale.
    return diagramContentNodes(contents[contentIds.get(box.contentId)!].content)
      .find(node => node.line === old.line && node.startColumn === old.startColumn && node.endColumn === old.endColumn)?.id ?? nodeId;
  };
  const remapTarget = (jump: DiagramJumpTarget): DiagramJumpTarget => input.sourceAliases.includes(jump.representationId) && jump.displayNodeId && selected.has(jump.displayNodeId)
    ? { ...jump, representationId: input.destinationId, displayNodeId: `grid:${boxIds.get(jump.displayNodeId.slice(5))}`,
      ...(jump.contentNodeId ? { contentNodeId: remapNode(jump.displayNodeId, jump.contentNodeId) } : {}) } : jump;
  const remapJumps = (diagram: LineGridScene['contents'][string]) => diagram.jumps
    ? diagrams.revise(diagram.revisionId, { kind: 'jumps', jumps: diagram.jumps.map(jump => ({ ...jump, target: remapTarget(jump.target) })) }).diagram : diagram;
  for (const [id, diagram] of Object.entries(contents)) contents[id] = remapJumps(diagram);
  const targetJumps: CanvasJump[] = [], sourceJumps: CanvasJump[] = [];
  for (const jump of before.jumps ?? []) {
    if (selected.has(jump.sourceDisplayNodeId)) {
      const box = connectionBox(before.scene, jump.sourceDisplayNodeId)!;
      if (box.kind !== 'diagram') throw Error('Expected jump source diagram');
      const rebased = rebaseDiagramJumps(before.scene.contents[box.contentId].content, contents[contentIds.get(box.contentId)!].content, [jump])[0];
      targetJumps.push({ ...structuredClone(jump), ...rebased, id: fresh('jump'),
        sourceDisplayNodeId: `grid:${boxIds.get(jump.sourceDisplayNodeId.slice(5))}`, target: remapTarget(jump.target) });
    }
    if (input.mode === 'copy' || !selected.has(jump.sourceDisplayNodeId)) sourceJumps.push({ ...jump,
      target: input.mode === 'move' ? remapTarget(jump.target) : jump.target });
  }
  if (input.mode === 'copy') {
    const remapAnchor = <T extends typeof before.edges[number]['target']>(anchor: T): T => {
      const displayNodeId = `grid:${boxIds.get(anchor.displayNodeId.slice(5))}`;
      if (anchor.kind === 'box') return { ...anchor, displayNodeId };
      validateConnectionAnchor(before.scene, anchor);
      const box = connectionBox(before.scene, anchor.displayNodeId)!;
      if (box.kind !== 'diagram') throw Error('Expected diagram anchor');
      return { ...anchor, displayNodeId, contentNodeId: remapNode(anchor.displayNodeId, anchor.contentNodeId),
        revisionId: contents[contentIds.get(box.contentId)!].content.revisionId };
    };
    target.edges = before.edges.filter(edge => selected.has(edge.source.displayNodeId) && selected.has(edge.target.displayNodeId)).map(edge => ({
      ...structuredClone(edge), id: fresh('edge'), source: remapAnchor(edge.source), target: remapAnchor(edge.target) }));
  } else {
    for (const edge of before.edges) {
      validateConnectionAnchor(before.scene, edge.source); validateConnectionAnchor(before.scene, edge.target);
      const owner = connectionBox(before.scene, edge.source.displayNodeId)!;
      if (owner.kind !== 'diagram') throw Error('Edge source must be a diagram');
      const content = before.scene.contents[owner.contentId].content;
      const node = diagramContentNodes(content).find(node => node.id === edge.source.contentNodeId)!;
      const movedSource = selected.has(edge.source.displayNodeId), movedTarget = selected.has(edge.target.displayNodeId);
      const jump: CanvasJump = { id: fresh('jump'), label: getArrowLabel(edge.appearance).text || undefined,
        sourceDisplayNodeId: movedSource ? `grid:${boxIds.get(owner.id)}` : edge.source.displayNodeId,
        source: { revisionId: content.revisionId, contentHash: content.asciiSha256, contentNodeId: node.id,
          line: node.line, startColumn: node.startColumn, endColumn: node.endColumn },
        target: { representationId: movedTarget ? input.destinationId : input.sourceId,
          displayNodeId: movedTarget ? `grid:${boxIds.get(edge.target.displayNodeId.slice(5))}` : edge.target.displayNodeId,
          ...(edge.target.kind === 'content-node' ? { contentNodeId: edge.target.contentNodeId } : {}) } };
      if (movedSource) jump.source = rebaseDiagramJumps(content, contents[contentIds.get(owner.contentId)!].content, [jump])[0].source;
      if (movedTarget && jump.target.contentNodeId) jump.target.contentNodeId = remapNode(edge.target.displayNodeId, jump.target.contentNodeId);
      (movedSource ? targetJumps : sourceJumps).push(jump);
    }
    const remove = (box: GridBox): GridBox => box.kind === 'container'
      ? { ...box, children: box.children.filter(child => !selected.has(`grid:${child.id}`)).map(remove) } : box;
    const root = selected.has(`grid:${before.scene.root.id}`) ? emptyCanvasDocument().scene.root : remove(before.scene.root);
    const used = new Set<string>();
    const visit = (box: GridBox) => { if (box.collapsedContentId) used.add(box.collapsedContentId);
      if (box.kind === 'diagram') used.add(box.contentId); else box.children.forEach(visit); };
    visit(root);
    const source: ResolvedCanvasDocument = { ...before, edges: [], jumps: sourceJumps,
      sections: Object.fromEntries(Object.entries(before.sections).filter(([id]) => used.has(id))),
      scene: { root, contents: Object.fromEntries(Object.entries(before.scene.contents).filter(([id]) => used.has(id))) } };
    // Diagram-local links on remaining placements also follow moved targets.
    source.scene = { ...source.scene, contents: Object.fromEntries(Object.entries(source.scene.contents).map(([id, diagram]) =>
      [id, remapJumps(diagram)])) };
    original.append(source, input.sourceView ?? original.head.view);
  }
  target.jumps = targetJumps;
  if (destinationRecord) {
    const placement = placeTransferredGroup(existing.scene, target.scene);
    const root = existing.scene.root;
    const parent = root.kind === 'container' && !root.collapsed ? root : {
      id: fresh('group'), kind: 'container' as const, position: { column: 0, row: 0 }, collapsed: false,
      layout: { collisionPolicy: 'push-right' as const, gap: 3 }, children: [root]
    };
    const placed = children.map(child => ({ ...child, position: {
      column: child.position.column + placement.column - parent.position.column,
      row: child.position.row + placement.row - parent.position.row
    } }));
    const existingContents = Object.fromEntries(Object.entries(existing.scene.contents).map(([id, diagram]) => [id,
      input.mode === 'move' ? remapJumps(diagram) : diagram]));
    target.scene = { contents: { ...existingContents, ...contents }, root: { ...parent, children: [...parent.children, ...placed] } };
    target.edges = [...existing.edges, ...target.edges];
    target.jumps = [...(existing.jumps ?? []).map(jump => input.mode === 'move' ? { ...jump, target: remapTarget(jump.target) } : jump), ...targetJumps];
    target.sections = { ...existing.sections, ...sections };
  }
  const transaction: CanvasTransfer = { id: fresh('transfer'), mode: input.mode, applied: true, destinationCreated: !destinationRecord,
    sourceId: input.sourceId, destinationId: input.destinationId, sourceBefore: record.headId, sourceAfter: original.head.id,
    destinationBefore: destination.head.id, destinationAfter: '' };
  destination.append(target, input.destinationView); transaction.destinationAfter = destination.head.id;
  destination.linkTransaction(transaction.id);
  if (input.mode === 'move') original.linkTransaction(transaction.id);
  return { transaction, source: state(original), destination: state(destination), selectedIds: [...boxIds.values()].map(id => `grid:${id}`) };
}

export function transferBoundary(record: Pick<CanvasHistoryRecord, 'headId'>, transaction: CanvasTransfer, canvasId: string, redo = false) {
  if (transaction.discarded || transaction.applied === redo) return false;
  const expected = canvasId === transaction.sourceId ? redo ? transaction.sourceBefore : transaction.sourceAfter
    : canvasId === transaction.destinationId ? redo ? transaction.destinationBefore : transaction.destinationAfter : undefined;
  return record.headId === expected;
}
export function prepareTransferNavigation(sourceRecord: CanvasHistoryRecord, destinationRecord: CanvasHistoryRecord, transaction: CanvasTransfer, redo = false) {
  if (!transferBoundary(sourceRecord, transaction, transaction.sourceId, redo) || !transferBoundary(destinationRecord, transaction, transaction.destinationId, redo))
    throw Error('Undo newer edits in both participating canvases before undoing or redoing this transfer.');
  const source = new CanvasHistory(documentFromHistory(sourceRecord), {}, sourceRecord), destination = new CanvasHistory(documentFromHistory(destinationRecord), {}, destinationRecord);
  if (transaction.mode === 'move' && !source.navigate(redo)) throw Error('Source transfer checkpoint is unavailable');
  if (!destination.navigate(redo)) throw Error('Destination transfer checkpoint is unavailable');
  return { source: state(source), destination: state(destination), transaction: { ...transaction, applied: redo } };
}
