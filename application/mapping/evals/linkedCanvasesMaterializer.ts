import { placementSnapshot } from '../../../domain/core/diagrams/diagramPlacement';
import { linkedCanvasesOutputSchema } from '../../../domain/mapping/evals/linkedCanvases';
import type { EvalOutputResult } from '../../../domain/mapping/evals/evalOutputResult';
import type { CompareCanvasCopy } from '../../../domain/mapping/compare/comparePageSession';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import { connectionBox, connectionContentNodes } from '../../../domain/core/diagrams/diagramConnection';
import type { DiagramJump } from '../../../domain/core/diagrams/diagramJump';
import { validateDiagramJumps } from '../../../domain/core/diagrams/diagramJump';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import type { MappingCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { materializeDiagrams, reanchorEditedEdges } from '../rollup/rollUpMaterializer';

/** Validate/materialize the entire graph in memory before publishing a single frozen result. */
export function materializeLinkedCanvases(raw: unknown, inputs: CompareCanvasCopy[], namespace: string) {
  const output = linkedCanvasesOutputSchema.parse(raw);
  const used = new Set<string>();
  const canvases = new Map(output.canvases.map(item => {
    if (used.has(item.id)) throw Error(`Duplicate canvas ID ${item.id}`);
    used.add(item.id);
    const source = item.kind === 'existing' ? inputs.find((_, i) => item.sourceCanvas === `c${i + 1}`) : undefined;
    if (item.kind === 'existing' && !source) throw Error(`Unknown source canvas ${item.sourceCanvas}`);
    const history = source ? structuredClone(source.history) : item.kind === 'new'
      ? materializeDiagrams(item.diagrams, item.edges, `${namespace}-${item.id}`) : undefined!;
    const document = documentFromHistory(history);
    const canvas = structuredClone(history.snapshots[history.headId].view) as MappingCanvasState;
    const baseline = source ? { document: structuredClone(document), canvas: structuredClone(canvas) } : null;
    const controller = new MappingDocumentController(document, canvas, 0, undefined, undefined, history);
    const diagramIds = new Map<string, string>();
    if (item.kind === 'new') for (const d of item.diagrams) diagramIds.set(d.id, `grid:${namespace}-${item.id}-${d.id}`);
    else {
      const visit = (box: typeof document.scene.root): void => {
        if (box.kind === 'container') box.children.forEach(visit);
        else diagramIds.set(`grid:${box.id}`, `grid:${box.id}`);
      }; visit(document.scene.root);
      const edited = new Set<string>();
      for (const edit of item.edits) {
        if (!diagramIds.has(edit.diagram) || edited.has(edit.diagram)) throw Error(`Unknown or repeated edit ${item.id}/${edit.diagram}`);
        edited.add(edit.diagram);
      }
      if (item.edits.length) controller.applyUpdate(0, item.edits.map(edit => ({ method: 'replace' as const, nodeId: edit.diagram, ascii: edit.ascii, structureKind: 'diagram' as const })));
      reanchorEditedEdges(controller, document, edited);
    }
    return [item.id, { id: `${namespace}-${item.id}`, name: source?.view.name ?? (item.kind === 'new' ? item.name : item.id), controller, diagramIds, baseline }] as const;
  }));
  const sources = output.canvases.flatMap(c => c.kind === 'existing' ? [c.sourceCanvas] : []);
  if (sources.length !== inputs.length || new Set(sources).size !== inputs.length) throw Error('Include every input canvas exactly once');
  if (!canvases.has(output.rootCanvas)) throw Error('Unknown root canvas');
  const groups = new Map<string, DiagramJump[]>();
  const adjacency = new Map<string, string[]>();
  const resolveDiagram = (canvasId: string, diagramId: string) => {
    const c = canvases.get(canvasId), id = c?.diagramIds.get(diagramId);
    if (!c || !id) throw Error(`Unknown diagram ${canvasId}/${diagramId}`);
    const doc = c.controller.getSnapshot().document, box = connectionBox(doc.scene, id);
    if (box?.kind !== 'diagram') throw Error(`Not a diagram ${canvasId}/${diagramId}`);
    return { id, content: doc.scene.contents[box.contentId].content };
  };
  for (const [i, jump] of output.jumps.entries()) {
    if (jump.source.canvas === jump.target.canvas) throw Error('Jumps must connect different canvases');
    const source = resolveDiagram(jump.source.canvas, jump.source.diagram), target = canvases.get(jump.target.canvas);
    if (!target) throw Error(`Unknown target canvas ${jump.target.canvas}`);
    if (jump.target.line !== null && jump.target.diagram === null) throw Error('A target line needs a target diagram');
    const targetDiagram = jump.target.diagram === null ? undefined : resolveDiagram(jump.target.canvas, jump.target.diagram);
    const targetNode = jump.target.line === null ? undefined : connectionContentNodes(targetDiagram!.content).find(n => n.line === jump.target.line);
    if (jump.target.line !== null && !targetNode) throw Error(`No target concept at line ${jump.target.line}`);
    const { line, startColumn, endColumn } = jump.source;
    if (!source.content.ascii.split('\n')[line - 1]?.slice(startColumn - 1, endColumn).trim()) throw Error('Jump source must contain visible text');
    const record: DiagramJump = { id: `jump-${i + 1}`, source: { line, startColumn, endColumn, revisionId: source.content.revisionId, contentHash: source.content.asciiSha256 },
      target: { representationId: target.id, ...(targetDiagram ? { displayNodeId: targetDiagram.id } : {}), ...(targetNode ? { contentNodeId: targetNode.id } : {}) } };
    const key = JSON.stringify([jump.source.canvas, source.id]);
    const list = groups.get(key) ?? []; list.push(record); groups.set(key, list);
    validateDiagramJumps(source.content, list, false);
    adjacency.set(jump.source.canvas, [...(adjacency.get(jump.source.canvas) ?? []), jump.target.canvas]);
  }
  const reached = new Set<string>();
  const visit = (id: string) => { if (reached.has(id)) return; reached.add(id); for (const next of adjacency.get(id) ?? []) visit(next); };
  visit(output.rootCanvas);
  if (reached.size !== canvases.size) throw Error('Every canvas must be reachable from rootCanvas');
  const result: EvalOutputResult = { schemaVersion: 1, canvases: [], diagramRevisions: {} };
  for (const [key, c] of [...canvases].sort(([a], [b]) => a === output.rootCanvas ? -1 : b === output.rootCanvas ? 1 : 0)) {
    const controller = c.controller;
    // The output owns its complete jump list. Old links must not escape to live canvases.
    controller.applyUpdate(controller.getSnapshot().version, [...c.diagramIds.values()].map(id => ({ method: 'setJumps' as const, nodeId: id, jumps: groups.get(JSON.stringify([key, id])) ?? [] })));
    const final = controller.getSnapshot();
    Object.assign(result.diagramRevisions, controller.exportHistory().diagramRevisions);
    result.canvases.push({ id: c.id, name: c.name, representationId: c.id, baseline: c.baseline,
      proposed: { document: { ...final.document, jumps: [] }, canvas: final.canvas }, version: final.version });
  }
  result.placementSnapshot = placementSnapshot(result.canvases.map(c => ({ id: c.id, scene: c.proposed.document.scene })));
  return { output, result: structuredClone(result) };
}
