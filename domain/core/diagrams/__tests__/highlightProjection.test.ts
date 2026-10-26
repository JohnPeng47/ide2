import { describe, expect, it } from 'vitest';
import { CanvasHistory, documentFromHistory, validateCanvasHistory } from '../canvasHistory';
import { emptyCanvasDocument, prepareTransferNavigation } from '../canvasTransfer';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { diagramContentNodes } from '../diagramContentNodes';
import { defaultArrowAppearance, validateConnections } from '../diagramConnection';
import { composeScene, flattenGrid, resolveScene } from '../lineGrid';
import { highlightedDiagramIds, prepareDiagramProjection, prepareHighlightProjection, layoutHighlightProjection, projectionPresets, projectionGeometry, calculateProjectionPositions, applyProjectionPositions } from '../highlightProjection';
import { initialCanvasState, type MappingCanvasState, type MappingWorkspaceSnapshot } from '../../../mapping/workspace/mappingWorkspace';
import { MappingDocumentController } from '../../../mapping/workspace/mappingDocumentController';
import { serializeWorkspace, deserializeWorkspace } from '../../../mapping/workspace/mappingWorkspaceCodec';
import { recordsWorkspace, workspaceRecords, validateRecordUpdate } from '../../../mapping/workspace/workspaceRecords';

function fixture() {
  const document = emptyCanvasDocument(), service = revisionFixture();
  const contents = Object.fromEntries(['a', 'b', 'c', 'excluded', 'stale'].map((id, i) => {
    let diagram = service.create({ id, revision: 0, ascii: `${id} root${' '.repeat(i * 3)}\n|-- branch\n\x60-- tail`, structureKind: 'tree' }).diagram;
    if (id !== 'excluded') diagram = service.revise(diagram.revisionId, { kind: 'highlights', highlights: [
      { id: `highlight-${id}`, color: 'yellow', ...(id === 'stale' ? { contentNodeId: 'missing-node' } : id === 'b' ? { contentNodeId: diagramContentNodes(diagram.content)[0].id } : {}) }
    ] }).diagram;
    return [id, diagram];
  }));
  document.scene = { contents, root: { ...document.scene.root, kind: 'container', layout: { collisionPolicy: 'push-right', gap: 3 }, children:
    ['a', 'b', 'c', 'excluded', 'stale'].map((id, i) => ({ id, kind: 'diagram', collapsed: false, contentId: id, position: { column: i * 45, row: [4, 40, 12, 60, 80][i] } })) } };
  document.edges = [['a', 'b'], ['b', 'a'], ['a', 'a'], ['b', 'excluded']].map(([a, b], i) => ({ id: `edge-${i}`,
    source: { kind: 'content-node' as const, displayNodeId: `grid:${a}`, contentNodeId: diagramContentNodes(contents[a].content)[0].id, revisionId: contents[a].content.revisionId, side: 'auto' as const },
    target: { kind: 'box' as const, displayNodeId: `grid:${b}`, side: 'auto' as const }, appearance: { ...defaultArrowAppearance, label: `${a} → ${b}` } }));
  const history = new CanvasHistory(document, initialCanvasState()).export();
  const input = { sourceId: 'source', sourceAliases: ['source'], destinationId: 'draft-child', destinationView: initialCanvasState() };
  const prepared = prepareHighlightProjection(history, input);
  const view = prepared.destination.view as MappingCanvasState, projection = view.projectionLayout!;
  return { document, history, input, prepared, view, projection };
}

describe('highlight projection', () => {
  it('projects an explicit set including unhighlighted diagrams, preserving source order and internal connections', () => {
    const { history, input, document } = fixture();
    const prepared = prepareDiagramProjection(history, { ...input, selectedIds: ['grid:excluded', 'grid:b'] });
    const projection = (prepared.destination.view as MappingCanvasState).projectionLayout!;
    expect(projection.nodes.flatMap(node => node.sourceId ? [node.sourceId] : [])).toEqual(['b', 'excluded']);
    expect(prepared.destination.document.edges.map(edge => edge.appearance.label)).toEqual(['b → excluded']);
    expect(Object.values(prepared.destination.document.scene.contents).map(d => d.content.ascii))
      .toContain(document.scene.contents.excluded.content.ascii);
    expect(prepared.source.history).toEqual(history);
    validateConnections(prepared.destination.document.scene, prepared.destination.document.edges);
    const undone = prepareTransferNavigation(history, prepared.destination.history, prepared.transaction);
    expect(undone.destination.document.scene).toEqual(emptyCanvasDocument().scene);
  });

  it('rejects empty, duplicate, unknown and non-diagram IDs without changing the source', () => {
    const { history, input } = fixture(), before = structuredClone(history);
    for (const selectedIds of [[], ['grid:a', 'grid:a'], ['grid:a', 'grid:missing'], ['grid:root'], ['a']]) {
      expect(() => prepareDiagramProjection(history, { ...input, selectedIds })).toThrow();
      expect(history).toEqual(before);
    }
  });

  it('projects an unhighlighted diagram inside a collapsed container', () => {
    const { document, input } = fixture();
    document.scene.root.collapsed = true;
    document.scene.root.collapsedContentId = 'excluded';
    const prepared = prepareDiagramProjection(new CanvasHistory(document, {}).export(), { ...input, selectedIds: ['grid:excluded'] });
    expect((prepared.destination.view as MappingCanvasState).projectionLayout!.nodes.map(node => node.sourceId))
      .toEqual(['excluded', undefined]);
  });

  it('projects from only the current checkpoint while retaining the source undo archive and transfer boundary', () => {
    const { document, input } = fixture();
    const archive = new CanvasHistory(document, { archivedText: 'x'.repeat(1_000_000) });
    archive.append(document, initialCanvasState());
    const before = archive.export(), compact = archive.export(true);
    validateCanvasHistory(compact);
    expect(Object.keys(compact.snapshots)).toEqual([archive.headId]);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(before).length / 10);
    const projected = prepareHighlightProjection(compact, input);
    expect(projected.transaction.sourceBefore).toBe(archive.headId);
    expect(projected.transaction.sourceAfter).toBe(archive.headId);
    expect(archive.export()).toEqual(before);
    const undone = prepareTransferNavigation(before, projected.destination.history, projected.transaction);
    expect(undone.source.history).toEqual(before);
    expect(undone.destination.document.scene).toEqual(emptyCanvasDocument().scene);
  });

  it('transports geometry alone for layout updates and reuses the original content and edges', () => {
    const { prepared, projection } = fixture();
    const document = prepared.destination.document;
    const geometry = projectionGeometry(document, projection);
    const result = applyProjectionPositions(document, calculateProjectionPositions(structuredClone(geometry), projection, projectionPresets.Tight));
    expect(result).toEqual(layoutHighlightProjection(document, projection, projectionPresets.Tight));
    expect(result.scene.contents).toBe(document.scene.contents);
    expect(result.edges).toBe(document.edges);
    expect(JSON.stringify(geometry)).not.toContain('ascii');
    expect(JSON.stringify(geometry)).not.toContain('sourceContext');
    expect(JSON.stringify(geometry).length).toBeLessThan(JSON.stringify(document).length / 5);
  });

  it('copies only valid highlighted diagrams and internal edges, with independent content and unchanged source', () => {
    const { document, history, prepared, projection } = fixture();
    expect(highlightedDiagramIds(document.scene)).toEqual(['grid:a', 'grid:b', 'grid:c']);
    expect(prepared.source.history).toEqual(history);
    expect(prepared.destination.document.edges.map(e => e.appearance.label)).toEqual(['a → b', 'b → a', 'a → a']);
    validateConnections(prepared.destination.document.scene, prepared.destination.document.edges);
    expect(projection.sourceRevisionId).toBe(history.headId);
    expect(projection.nodes.flatMap(n => n.sourceId ? [n.sourceId] : [])).toEqual(['a', 'b', 'c']);
    expect(Object.values(prepared.destination.document.scene.contents).every(d => !Object.hasOwn(document.scene.contents, d.id))).toBe(true);
    expect(projection.nodes[1].column - projection.nodes[0].column).toBe(45);
    expect(projection.nodes[1].row - projection.nodes[0].row).toBe(36);
    expect(documentFromHistory(history)).toEqual(document);
  });

  it('adds one blank 35-by-65 editable placeholder and uses the requested defaults on creation', () => {
    const { prepared, projection } = fixture();
    expect(projection.settings).toEqual({ mode: 'compact', centroid: 'mean', attraction: 1, neighbors: 1, fidelity: 1, gap: 8 });
    const placeholder = prepared.destination.document.scene.contents[projection.placeholderId!];
    expect(placeholder.content.ascii.split('\n')).toEqual(Array.from({ length: 35 }, () => ' '.repeat(65)));
    expect(projection.nodes.find(node => node.id === projection.placeholderId)?.sourceId).toBeUndefined();
    expect(prepared.destination.document.edges.every(edge => ![edge.source.displayNodeId, edge.target.displayNodeId].includes(`grid:${projection.placeholderId}`))).toBe(true);
    expect(() => composeScene(prepared.destination.document.scene)).not.toThrow();
    const centered = layoutHighlightProjection(prepared.destination.document, projection, { ...projection.settings, centroid: 'placeholder' });
    expect(() => composeScene(centered.scene)).not.toThrow();
    const updated = revisionFixture().revise(placeholder.revisionId, { kind: 'replace', input: { ascii: 'Generated diagram', structureKind: 'diagram' } }).diagram;
    expect(updated.diagramId).toBe(placeholder.diagramId);
    expect(updated.content.ascii).toBe('Generated diagram');
    const next = prepareHighlightProjection(prepared.destination.history, { sourceId: 'draft-child', sourceAliases: ['draft-child'], destinationId: 'draft-grandchild', destinationView: initialCanvasState() });
    expect(next.selectedIds).toHaveLength(3);
    expect((next.destination.view as MappingCanvasState).projectionLayout!.nodes).toHaveLength(4);
  });

  it('rejects empty highlights and includes highlighted placements inside collapsed containers', () => {
    const document = emptyCanvasDocument();
    expect(() => prepareHighlightProjection(new CanvasHistory(document, {}).export(), { sourceId: 's', sourceAliases: ['s'], destinationId: 'd', destinationView: {} })).toThrow('Highlight at least');
    const source = fixture().document;
    const root = source.scene.root;
    if (root.kind !== 'container') throw Error();
    source.scene = { ...source.scene, root: { ...root, collapsed: true, collapsedContentId: 'excluded' } };
    expect(highlightedDiagramIds(source.scene)).toEqual(['grid:a', 'grid:b', 'grid:c']);
  });

  it('compacts deterministically, preserves ordering and edges, and returns exactly to original spacing', () => {
    const { prepared, projection } = fixture();
    const original = layoutHighlightProjection(prepared.destination.document, projection, projectionPresets.Original);
    const compact = layoutHighlightProjection(original, projection, projectionPresets.Tight);
    expect(layoutHighlightProjection(compact, projection, projectionPresets.Tight)).toEqual(compact);
    expect(compact.edges).toEqual(original.edges);
    expect(() => composeScene(compact.scene)).not.toThrow();
    const measure = (d: typeof original) => resolveScene(d.scene).bounds;
    expect(measure(compact).columns * measure(compact).rows).toBeLessThan(measure(original).columns * measure(original).rows);
    const boxes = new Map(flattenGrid(resolveScene(compact.scene)).map(n => [n.box.id, n.bounds]));
    for (const a of projection.nodes) for (const b of projection.nodes) {
      const x = boxes.get(a.id)!, y = boxes.get(b.id)!;
      expect((a.column + a.columns / 2 - b.column - b.columns / 2) * (x.column + x.columns / 2 - y.column - y.columns / 2)).toBeGreaterThanOrEqual(0);
      expect((a.row + a.rows / 2 - b.row - b.rows / 2) * (x.row + x.rows / 2 - y.row - y.rows / 2)).toBeGreaterThanOrEqual(0);
      if (a !== b) expect(x.column + x.columns + 2 <= y.column || y.column + y.columns + 2 <= x.column
        || x.row + x.rows + 2 <= y.row || y.row + y.rows + 2 <= x.row).toBe(true);
    }
    expect(layoutHighlightProjection(compact, projection, projectionPresets.Original).scene).toEqual(original.scene);
  });

  it('persists ancestry and baseline through workspace records; settings and geometry undo together', () => {
    const { prepared, projection, view } = fixture();
    const controller = new MappingDocumentController(prepared.destination.document, view, 0, undefined, undefined, prepared.destination.history);
    const compact = layoutHighlightProjection(controller.getSnapshot().document, projection, projectionPresets.Tight);
    controller.commitProjectionLayout(0, compact, { ...projection, settings: projectionPresets.Tight });
    controller.undo();
    expect(controller.getSnapshot().canvas.projectionLayout?.settings).toEqual(projectionPresets.Default);
    expect(controller.getSnapshot().document.scene).toEqual(prepared.destination.document.scene);
    controller.undo(true);
    expect(controller.getSnapshot().canvas.projectionLayout?.settings).toEqual(projectionPresets.Tight);
    expect(() => controller.commitProjectionLayout(0, compact, projection)).toThrow('Canvas changed');
    const workspace: MappingWorkspaceSnapshot = { schemaVersion: 3, projectId: 'project', activeDocumentId: 'draft-child', transfers: [prepared.transaction], documents: [
      { representationId: 'source', name: 'Source', revisionId: 'revision', savedName: 'Source', savedScene: JSON.stringify(prepared.source.document.scene), document: prepared.source.document, canvas: initialCanvasState(), history: prepared.source.history },
      { representationId: 'draft-child', parentCanvasId: 'source', name: 'Child', revisionId: '', savedName: '', savedScene: JSON.stringify(emptyCanvasDocument().scene), document: compact, canvas: controller.getSnapshot().canvas, history: controller.exportHistory() }
    ] };
    const reloaded = deserializeWorkspace(serializeWorkspace(workspace));
    const records = workspaceRecords(reloaded);
    validateRecordUpdate(records, Object.keys(records), 'project');
    expect(recordsWorkspace(records)?.documents[1].parentCanvasId).toBe('source');
    expect(recordsWorkspace(records)?.documents[1].canvas.projectionLayout).toEqual({ ...projection, settings: projectionPresets.Tight });
    const bad = structuredClone(workspace); bad.documents[0].parentCanvasId = 'draft-child';
    expect(() => serializeWorkspace(bad)).toThrow('cycle');
    const undone = prepareTransferNavigation(prepared.source.history, prepared.destination.history, prepared.transaction);
    expect(undone.destination.document.scene).toEqual(emptyCanvasDocument().scene);
    expect((prepareTransferNavigation(undone.source.history, undone.destination.history, undone.transaction, true).destination.view as MappingCanvasState).projectionLayout).toEqual(projection);
  });

  it('separates unequal rectangles across varied layouts and settings after grid rounding', () => {
    const { prepared, projection } = fixture();
    for (let sample = 0; sample < 20; sample++) {
      const settings = { ...projectionPresets.Tight, gap: sample, centroid: sample % 2 ? 'area' as const : 'diagram' as const, focusId: projection.nodes[sample % 3].id, fidelity: sample / 20 };
      const result = layoutHighlightProjection(prepared.destination.document, projection, settings);
      expect(() => composeScene(result.scene)).not.toThrow();
      const boxes = flattenGrid(resolveScene(result.scene)).filter(n => n.box.kind === 'diagram').map(n => n.bounds);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.column + a.columns + sample <= b.column || b.column + b.columns + sample <= a.column || a.row + a.rows + sample <= b.row || b.row + b.rows + sample <= a.row).toBe(true);
      }
    }
  });
});
