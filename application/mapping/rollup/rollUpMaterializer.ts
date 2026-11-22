import { MappingDocumentController, type DiagramOperation } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState, type MappingCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { documentFromHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { connectionBox, connectionContentNodes, type ContentNodeAnchor, type DiagramAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { rollUpOutputSchema, attachOutputSchema, type RollUpOutput } from '../../../domain/mapping/rollup/rollUp';
import type { MappingGridDocument } from '../../../domain/mapping/workspace/mappingGrid';
import { flattenGrid, resolveScene } from '../../../domain/core/diagrams/lineGrid';

const empty: MappingGridDocument = { scene: { contents: {}, root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [] } }, edges: [], sections: {} };
function anchor(c: MappingDocumentController, diagram: string, line: number): ContentNodeAnchor {
  const scene = c.getSnapshot().document.scene, box = connectionBox(scene, diagram);
  if (box?.kind !== 'diagram') throw Error(`Unknown endpoint ${diagram}`);
  const content = scene.contents[box.contentId].content;
  const node = connectionContentNodes(content).find(node => node.line === line);
  if (!node) throw Error(`No content anchor at ${diagram}:${line}`);
  return { kind: 'content-node', displayNodeId: diagram, revisionId: content.revisionId, contentNodeId: node.id, side: 'auto' };
}
export function addEdges(c: MappingDocumentController, edges: RollUpOutput['edges'], ids: Map<string, string>, prefix: string) {
  const endpoint = (value: RollUpOutput['edges'][number]['source']) => {
    const id = ids.get(value.diagram); if (!id) throw Error(`Unknown diagram ${value.diagram}`);
    return anchor(c, id, value.line);
  };
  if (edges.length) c.applyUpdate(c.getSnapshot().version, edges.map((edge, i) => ({ method: 'edge-create', edge: {
    id: `${prefix}-${i}`, source: endpoint(edge.source), target: endpoint(edge.target), appearance: { color: '#88c0d0', lineStyle: 'solid', label: edge.label }
  } })));
}
/** Content edits create revisions. Preserve existing edges using unambiguous
 * textual correspondence instead of retaining stale content-node handles. */
export function reanchorEditedEdges(c: MappingDocumentController, document: MappingGridDocument, edited: Set<string>, labels: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map()) {
  const reanchor = (old: DiagramAnchor) => {
    if (old.kind === 'box' || !edited.has(old.displayNodeId)) return old;
    const box = connectionBox(c.getSnapshot().document.scene, old.displayNodeId);
    const prior = connectionBox(document.scene, old.displayNodeId);
    if (box?.kind !== 'diagram' || prior?.kind !== 'diagram') throw Error('An edit removed an existing anchor');
    const content = c.getSnapshot().document.scene.contents[box.contentId].content;
    if (old.revisionId === content.revisionId) return old;
    const original = connectionContentNodes(document.scene.contents[prior.contentId].content).find(node => node.id === old.contentNodeId);
    const label = original && (labels.get(old.displayNodeId)?.get(original.label) ?? original.label);
    const matches = connectionContentNodes(content).filter(node => node.label === label);
    const node = matches.length === 1 ? matches[0] : matches.find(node => node.line === original?.line);
    if (!node) throw Error(`Preserve the existing attachment text in ${old.displayNodeId}: ${original?.label ?? old.contentNodeId}`);
    return { ...old, contentNodeId: node.id, revisionId: content.revisionId };
  };
  const updates: DiagramOperation[] = c.getSnapshot().document.edges.flatMap(edge => {
    const next = { ...edge, source: reanchor(edge.source) as ContentNodeAnchor, target: reanchor(edge.target) };
    return JSON.stringify(edge) === JSON.stringify(next) ? [] : [{ method: 'edge-update' as const, edge: next }];
  });
  if (updates.length) c.applyUpdate(c.getSnapshot().version, updates);
}
/** Builds a fresh canvas from generated diagrams; IDs are prefixed to stay distinct from parent grid IDs. */
export function materializeDiagrams(diagrams: RollUpOutput['diagrams'], edges: RollUpOutput['edges'], prefix: string) {
  const ids = new Map<string, string>();
  const c = new MappingDocumentController(structuredClone(empty), initialCanvasState());
  c.applyUpdate(0, diagrams.map(d => {
    if (ids.has(d.id)) throw Error(`Duplicate diagram ID ${d.id}`); ids.set(d.id, `grid:${prefix}-${d.id}`);
    return { method: 'diagram-create', id: `${prefix}-${d.id}`, ascii: d.ascii, position: d.position, structureKind: 'diagram' };
  }));
  addEdges(c, edges, ids, `${prefix}-edge`);
  return c.exportHistory();
}
export function materializeRollUp(raw: unknown) {
  const output = rollUpOutputSchema.parse(raw);
  return { output, history: materializeDiagrams(output.diagrams, output.edges, 'rollup') };
}
export function materializeAttachment(parent: CanvasHistoryRecord, r2: RollUpOutput, raw: unknown) {
  const output = attachOutputSchema.parse(raw), document = documentFromHistory(parent);
  const c = new MappingDocumentController(document, parent.snapshots[parent.headId].view as MappingCanvasState, 0, undefined, undefined, structuredClone(parent));
  const base = c.canvasView(c.getSnapshot().version, { operation: 'create', name: 'Pinned parent' }).activeViewId!;
  const viewId = c.canvasView(c.getSnapshot().version, { operation: 'fork', viewId: base, name: 'Attached roll-up' }).activeViewId!;
  const ids = new Map<string, string>(), consumed = new Set<string>(), edited = new Set<string>(), mergedParents = new Set<string>();
  const visit = (box: typeof document.scene.root): void => {
    if (box.kind === 'container') box.children.forEach(visit); else ids.set(`grid:${box.id}`, `grid:${box.id}`);
  }; visit(document.scene.root);
  const parentIds = new Set(ids.keys());
  const take = (id: string) => { const diagram = r2.diagrams.find(d => d.id === id); if (!diagram || consumed.has(id)) throw Error(`Unknown or repeated r2 diagram ${id}`); consumed.add(id); return diagram; };
  const operations: DiagramOperation[] = [];
  for (const edit of output.edits) {
    if (!parentIds.has(edit.diagram) || edited.has(edit.diagram)) throw Error('Unknown or repeated parent edit');
    edited.add(edit.diagram);
    for (const id of edit.merged) { take(id); mergedParents.add(edit.diagram); }
    operations.push({ method: 'replace', nodeId: edit.diagram, ascii: edit.ascii, structureKind: 'diagram' });
  }
  for (const placement of output.placements) {
    const d = take(placement.diagram), id = `rollup-${d.id}`;
    if (connectionBox(document.scene, `grid:${id}`)) throw Error('Roll-up diagram ID collides with parent');
    ids.set(d.id, `grid:${id}`);
    operations.push({ method: 'diagram-create', id, ascii: d.ascii, position: placement.position, structureKind: 'diagram' });
  }
  if (consumed.size !== r2.diagrams.length) throw Error('Attachment omitted an r2 diagram');
  if (output.attachment === 'a' && output.edits.length || output.attachment === 'b' && (!output.edits.length || mergedParents.size) || output.attachment === 'c' && !mergedParents.size)
    throw Error('Attachment operations do not match the selected strategy');
  if (!output.edges.some(e => parentIds.has(e.source.diagram) !== parentIds.has(e.target.diagram) ||
    output.attachment === 'c' && e.source.diagram !== e.target.diagram && (mergedParents.has(e.source.diagram) || mergedParents.has(e.target.diagram))))
    throw Error('No edge attaches the roll-up to the parent');
  if (operations.length) c.applyUpdate(c.getSnapshot().version, operations);
  // Inserting a colliding diagram must not silently rearrange the parent.
  const positions = new Map(flattenGrid(resolveScene(document.scene)).map(box => [box.box.id, box.bounds]));
  for (const box of flattenGrid(resolveScene(c.getSnapshot().document.scene))) {
    const before = positions.get(box.box.id);
    if (before && (before.column !== box.bounds.column || before.row !== box.bounds.row))
      throw Error(`Attachment moved parent diagram ${box.box.id}; place r2 in unoccupied space`);
  }
  reanchorEditedEdges(c, document, edited);
  addEdges(c, r2.edges.filter(e => ids.has(e.source.diagram) && ids.has(e.target.diagram)), ids, 'rollup-internal');
  addEdges(c, output.edges, ids, 'rollup-attachment');
  c.canvasView(c.getSnapshot().version, { operation: 'save' });
  return { output, history: c.exportHistory(), viewId };
}
