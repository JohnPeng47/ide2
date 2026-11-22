import { reanchorEditedEdges } from '../rollup/rollUpMaterializer';
import { CanvasHistory, documentFromHistory, type CanvasHistoryRecord } from '../../../domain/core/diagrams/canvasHistory';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState, type MappingCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { connectionBox, connectionContentNodes, type ContentNodeAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { flattenGrid, resolveScene } from '../../../domain/core/diagrams/lineGrid';
import { historyEdgeSchema, historyFillSchema, type HistoryBatch, type HistoryFill } from '../../../domain/mapping/history/diagramHistory';
import { importDiagramRevision } from '../../../domain/core/diagrams/diagramRevisionStore';

export interface HistoryCanvas { id: string; name: string; history: CanvasHistoryRecord; diagramIds: Record<string, string> }
export type HistoryCanvasSet = Record<string, HistoryCanvas>;
const empty = () => new CanvasHistory({ scene: { contents: {}, root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [] } }, edges: [], sections: {} }, initialCanvasState()).export();
export function controller(canvas: HistoryCanvas) {
  return new MappingDocumentController(documentFromHistory(canvas.history), canvas.history.snapshots[canvas.history.headId].view as MappingCanvasState, 0, undefined, undefined, canvas.history);
}
export function viewId(canvas: HistoryCanvas) { return canvas.history.canvasViews!.activeViewId!; }
export function canvasInput(set: HistoryCanvasSet) {
  return Object.entries(set).map(([id, c]) => {
    const document = documentFromHistory(c.history), boxes = flattenGrid(resolveScene(document.scene));
    return { id, name: c.name, diagrams: Object.entries(c.diagramIds).map(([diagramId, boxId]) => {
      const box = boxes.find(b => b.box.id === boxId)!;
      const content = document.scene.contents[box.contentId!].content;
      const attachmentIds = new Set(document.edges.flatMap(e => [e.source, e.target]).filter(a => a.kind === 'content-node' && a.displayNodeId === `grid:${boxId}`).map(a => (a as ContentNodeAnchor).contentNodeId));
      const jumpLines = new Set((document.jumps ?? []).filter(j => j.sourceDisplayNodeId === `grid:${boxId}`).map(j => j.source.line));
      for (const other of Object.values(set)) for (const jump of documentFromHistory(other.history).jumps ?? []) {
        if (jump.target.representationId === c.id && jump.target.displayNodeId === `grid:${boxId}` && jump.target.contentNodeId) attachmentIds.add(jump.target.contentNodeId);
      }
      return { id: diagramId, displayNodeId: `grid:${boxId}`, retainedAttachments: connectionContentNodes(content).filter(n => attachmentIds.has(n.id) || jumpLines.has(n.line)).map(n => ({ line: n.line, label: n.label })), position: box.bounds, ascii: content.ascii };
    }), edges: document.edges, jumps: document.jumps ?? [] };
  });
}
function anchor(c: MappingDocumentController, boxId: string, label?: string | null): ContentNodeAnchor {
  const doc = c.getSnapshot().document, box = connectionBox(doc.scene, `grid:${boxId}`);
  if (box?.kind !== 'diagram') throw Error(`Unknown diagram ${boxId}`);
  const content = doc.scene.contents[box.contentId].content, nodes = connectionContentNodes(content), matches = label ? nodes.filter(n => n.label === label) : nodes.slice(0, 1), node = matches[0];
  if (matches.length !== 1) throw Error(`Expected one attachment label ${JSON.stringify(label)} in ${boxId}`);
  if (!node) throw Error('Diagram needs a title anchor');
  return { kind: 'content-node', displayNodeId: `grid:${boxId}`, contentNodeId: node.id, revisionId: content.revisionId, side: 'auto' };
}
/** A scaffold is an actual reserved rectangle; text nodes are filled in a later phase. */
export function scaffoldAscii(title: string, nodes: number) {
  const width = Math.max(78, title.length + 4), label = `${title} [${nodes} nodes]`;
  return label + '\n+' + '-'.repeat(width - 2) + '+\n' + Array.from({ length: nodes * 2 }, () => '|' + ' '.repeat(width - 2) + '|').join('\n') + '\n+' + '-'.repeat(width - 2) + '+';
}
export function materializeHistoryStep(previous: HistoryCanvasSet, batch: HistoryBatch, namespace: string,
  mode: 'scaffold' | 'execute', raw?: unknown, scaffolds?: HistoryCanvasSet, fixed = false): HistoryCanvasSet {
  const fill: HistoryFill | undefined = mode === 'execute' ? historyFillSchema.parse(raw) : undefined;
  const expected = new Set(batch.changes.flatMap(c => c.diagrams.map(d => `${c.canvasId}/${d.diagramId}`)));
  if (fill && (fill.diagrams.length !== expected.size || new Set(fill.diagrams.map(d => `${d.canvasId}/${d.diagramId}`)).size !== expected.size
    || fill.diagrams.some(d => !expected.has(`${d.canvasId}/${d.diagramId}`)))) throw Error('Fill every planned diagram exactly once, with no unplanned edits.');
  if (fixed && fill && JSON.stringify(fill.edges) !== JSON.stringify(batch.edges.map(edge => historyEdgeSchema.parse(edge)))) throw Error('The fixed scaffold edges must remain unchanged.');
  const result = structuredClone(previous), controllers = new Map<string, MappingDocumentController>();
  const remaps = new Map<string, Map<string, Map<string, string>>>();
  for (const m of fill?.attachmentMappings ?? []) {
    const canvas = previous[m.canvasId], boxId = canvas?.diagramIds[m.diagramId];
    if (!boxId || !expected.has(`${m.canvasId}/${m.diagramId}`)) throw Error('Attachment mapping must refer to an edited existing diagram');
    const doc = documentFromHistory(canvas.history), box = connectionBox(doc.scene, `grid:${boxId}`);
    if (box?.kind !== 'diagram' || !connectionContentNodes(doc.scene.contents[box.contentId].content).some(n => n.label === m.previousLabel)) throw Error(`Unknown previous attachment label: ${m.previousLabel}`);
    if (!remaps.has(m.canvasId)) remaps.set(m.canvasId, new Map());
    const byBox = remaps.get(m.canvasId)!;
    if (!byBox.has(`grid:${boxId}`)) byBox.set(`grid:${boxId}`, new Map());
    const labels = byBox.get(`grid:${boxId}`)!;
    if (labels.has(m.previousLabel)) throw Error('Duplicate attachment mapping');
    labels.set(m.previousLabel, m.nextLabel);
  }
  const take = (key: string) => {
    if (controllers.has(key)) return controllers.get(key)!;
    const canvas = result[key]; if (!canvas) throw Error(`Unknown canvas ${key}`);
    const c = controller(canvas), parent = canvas.history.canvasViews?.activeViewId;
    c.canvasView(c.getSnapshot().version, parent ? { operation: 'fork', viewId: parent, name: batch.title } : { operation: 'create', name: batch.title });
    controllers.set(key, c); return c;
  };
  for (const change of batch.changes) {
    if (change.newCanvas) {
      if (result[change.canvasId]) throw Error('Canvas already exists');
      result[change.canvasId] = { id: `${namespace}-${change.canvasId}`, name: change.canvasName, history: empty(), diagramIds: {} };
    }
    for (const d of change.diagrams) {
      if (mode === 'scaffold' && !d.newDiagram) continue;
      const canvas = result[change.canvasId], c = take(change.canvasId);
      const value = fill?.diagrams.find(v => v.canvasId === change.canvasId && v.diagramId === d.diagramId);
      const ascii = mode === 'scaffold' ? scaffoldAscii(d.title, d.targetNodes!) : value!.ascii;
      if (mode === 'execute' && fixed && d.newDiagram) {
        const lines = ascii.split('\n').filter(l => l.trim() && !/^[\s|+`\\-]+$/.test(l));
        if (lines.length !== d.targetNodes) throw Error(`${d.diagramId}: expected exactly ${d.targetNodes} tree nodes (one nonempty concept line per node), received ${lines.length}`);
      }
      if (d.newDiagram) {
        const boxId = `${namespace}-${change.canvasId}-${d.diagramId}`, position = mode === 'scaffold' || fixed ? d.position : value?.position;
        if (!position) throw Error('New diagrams require a position');
        canvas.diagramIds[d.diagramId] = boxId;
        const pinned = scaffolds?.[change.canvasId];
        if (pinned && mode === 'execute') {
          const doc = documentFromHistory(pinned.history), box = connectionBox(doc.scene, `grid:${pinned.diagramIds[d.diagramId]}`);
          if (box?.kind !== 'diagram') throw Error('Missing planned scaffold diagram');
          const diagram = doc.scene.contents[box.contentId]; importDiagramRevision(pinned.history.diagramRevisions[diagram.revisionId]);
          c.applyUpdate(c.getSnapshot().version, [{ method: 'diagram-insert', id: boxId, revisionId: diagram.revisionId, position },
            { method: 'replace', nodeId: `grid:${boxId}`, ascii, structureKind: 'tree' }]);
        } else c.applyUpdate(c.getSnapshot().version, [{ method: 'diagram-create', id: boxId, ascii, position, structureKind: mode === 'scaffold' ? 'diagram' : 'tree' }]);
      } else {
        const boxId = canvas.diagramIds[d.diagramId]; if (!boxId) throw Error('Unknown edit target');
        c.applyUpdate(c.getSnapshot().version, [{ method: 'replace', nodeId: `grid:${boxId}`, ascii, structureKind: 'tree' }]);
      }
    }
  }
  // Re-anchor to the retained semantic label, never silently collapse every edge to the title.
  for (const [key, c] of controllers) if (previous[key]) {
    const edited = new Set(batch.changes.filter(change => change.canvasId === key).flatMap(change => change.diagrams.filter(d => !d.newDiagram).map(d => `grid:${result[key].diagramIds[d.diagramId]}`)));
    for (const [displayId, labels] of remaps.get(key) ?? []) {
      const doc = c.getSnapshot().document, box = connectionBox(doc.scene, displayId);
      if (box?.kind !== 'diagram') throw Error('Attachment target diagram missing');
      for (const next of labels.values()) if (connectionContentNodes(doc.scene.contents[box.contentId].content).filter(n => n.label === next).length !== 1) throw Error(`Attachment target must identify one node: ${next}`);
    }
    reanchorEditedEdges(c, documentFromHistory(previous[key].history), edited, remaps.get(key));
  }
  const edges = fill?.edges ?? batch.edges;
  for (const [i, e] of edges.entries()) {
    const source = result[e.sourceCanvas], target = result[e.targetCanvas];
    if (!source?.diagramIds[e.sourceDiagram] || !target?.diagramIds[e.targetDiagram]) throw Error('Unknown edge endpoint');
    const c = take(e.sourceCanvas), from = source.diagramIds[e.sourceDiagram], to = target.diagramIds[e.targetDiagram];
    if (e.sourceCanvas === e.targetCanvas) c.applyUpdate(c.getSnapshot().version, [{ method: 'edge-create', edge: {
      id: `${namespace}-${batch.id}-edge-${i}`, source: anchor(c, from, mode === 'scaffold' ? null : e.sourceLabel), target: mode !== 'scaffold' && e.targetLabel ? anchor(c, to, e.targetLabel) : { kind: 'box', displayNodeId: `grid:${to}`, side: 'auto' },
      appearance: { color: '#88c0d0', lineStyle: 'solid', label: e.label } } }]);
    // Cross-canvas links are assembled below, after every title revision is final.
  }
  for (const [key, c] of controllers) {
    c.canvasView(c.getSnapshot().version, { operation: 'save' }); result[key].history = c.exportHistory();
  }
  for (const key of new Set(edges.filter(e => e.sourceCanvas !== e.targetCanvas).map(e => e.sourceCanvas))) {
    const canvas = result[key], h = new CanvasHistory(documentFromHistory(canvas.history), canvas.history.snapshots[canvas.history.headId].view, canvas.history);
    const doc = h.document(), additions = edges.filter(e => e.sourceCanvas === key && e.targetCanvas !== key);
    doc.jumps = [...(doc.jumps ?? []), ...additions.map((e, i) => {
      const boxId = canvas.diagramIds[e.sourceDiagram], box = connectionBox(doc.scene, `grid:${boxId}`)!;
      if (box.kind !== 'diagram') throw Error('Invalid navigation source');
      const content = doc.scene.contents[box.contentId].content;
      const sourceAnchor = anchor(controller(canvas), boxId, mode === 'scaffold' ? null : e.sourceLabel);
      const line = connectionContentNodes(content).find(n => n.id === sourceAnchor.contentNodeId)!.line;
      const targetCanvas = result[e.targetCanvas], targetBox = targetCanvas.diagramIds[e.targetDiagram];
      const targetNode = mode !== 'scaffold' && e.targetLabel ? anchor(controller(targetCanvas), targetBox, e.targetLabel).contentNodeId : undefined;
      return { id: `${namespace}-${batch.id}-jump-${i}`, sourceDisplayNodeId: `grid:${boxId}`, label: e.label,
        source: { line, startColumn: 1, endColumn: content.ascii.split('\n')[line - 1].length, revisionId: content.revisionId, contentHash: content.asciiSha256 },
        target: { representationId: targetCanvas.id, displayNodeId: `grid:${targetBox}`, ...(targetNode ? {contentNodeId: targetNode} : {}) } };
    })];
    h.append(doc, h.head.view); h.canvasView({ operation: 'save' }); canvas.history = h.export();
  }
  for (const [key, canvas] of Object.entries(result)) {
    const doc = documentFromHistory(canvas.history);
    let changed = false;
    for (const jump of doc.jumps ?? []) {
      const box = connectionBox(doc.scene, jump.sourceDisplayNodeId);
      if (box?.kind !== 'diagram') throw Error('Missing retained navigation source');
      const content = doc.scene.contents[box.contentId].content;
      if (jump.source.revisionId !== content.revisionId || jump.source.contentHash !== content.asciiSha256) {
        const before = previous[key] && documentFromHistory(previous[key].history);
        const oldBox = before && connectionBox(before.scene, jump.sourceDisplayNodeId);
        if (!before || oldBox?.kind !== 'diagram') throw Error('Cannot recover retained navigation source');
        const oldContent = before.scene.contents[oldBox.contentId].content;
        const oldNode = connectionContentNodes(oldContent).find(n => n.line === jump.source.line);
        const label = oldNode && (remaps.get(key)?.get(jump.sourceDisplayNodeId)?.get(oldNode.label) ?? oldNode.label);
        const matches = connectionContentNodes(content).filter(n => n.label === label);
        const node = matches.length === 1 ? matches[0] : matches.find(n => n.line === oldNode?.line);
        if (!node) throw Error(`Preserve the existing navigation attachment text: ${oldNode?.label}`);
        const line = node.line;
        jump.source = { line, startColumn: 1, endColumn: content.ascii.split('\n')[line - 1].length,
          revisionId: content.revisionId, contentHash: content.asciiSha256 }; changed = true;
      }
      if (jump.target.contentNodeId && jump.target.displayNodeId) {
        const targetKey = Object.keys(result).find(k => result[k].id === jump.target.representationId);
        const targetBefore = targetKey && previous[targetKey] ? documentFromHistory(previous[targetKey].history) : undefined;
        const targetAfter = targetKey ? documentFromHistory(result[targetKey].history) : undefined;
        const oldBox = targetBefore && connectionBox(targetBefore.scene, jump.target.displayNodeId);
        const newBox = targetAfter && connectionBox(targetAfter.scene, jump.target.displayNodeId);
        if (targetBefore && targetAfter && oldBox?.kind === 'diagram' && newBox?.kind === 'diagram') {
          const oldContent = targetBefore.scene.contents[oldBox.contentId].content, newContent = targetAfter.scene.contents[newBox.contentId].content;
          const oldNode = connectionContentNodes(oldContent).find(n => n.id === jump.target.contentNodeId);
          if (oldNode && oldContent.revisionId !== newContent.revisionId) {
            const label = remaps.get(targetKey!)?.get(jump.target.displayNodeId)?.get(oldNode.label) ?? oldNode.label;
            const matches = connectionContentNodes(newContent).filter(n => n.label === label);
            const node = matches.length === 1 ? matches[0] : matches.find(n => n.line === oldNode.line);
            if (!node) throw Error(`Preserve the existing navigation target text: ${oldNode.label}`);
            jump.target.contentNodeId = node.id; changed = true;
          }
        }
      }
    }
    if (changed) {
      const h = new CanvasHistory(documentFromHistory(canvas.history), canvas.history.snapshots[canvas.history.headId].view, canvas.history);
      h.append(doc, h.head.view); h.canvasView({ operation: 'save' }); canvas.history = h.export();
    }
    if (fixed && previous[key]) {
      const positions = new Map(flattenGrid(resolveScene(documentFromHistory(previous[key].history).scene)).map(b => [b.box.id, b.bounds]));
      for (const box of flattenGrid(resolveScene(documentFromHistory(canvas.history).scene))) {
        const old = positions.get(box.box.id);
        if (old && (box.bounds.column !== old.column || box.bounds.row !== old.row)) throw Error(`Fixed layout moved ${box.box.id}; fit the content into the reserved space.`);
      }
    }
  }
  if (fixed) for (const change of batch.changes) for (const d of change.diagrams.filter(d => d.newDiagram)) {
    const c = result[change.canvasId], box = flattenGrid(resolveScene(documentFromHistory(c.history).scene)).find(b => b.box.id === c.diagramIds[d.diagramId])!;
    if (box.bounds.column !== d.position!.column || box.bounds.row !== d.position!.row) throw Error(`Scaffold position changed for ${d.diagramId}; choose unoccupied space.`);
  }
  return result;
}
