import { describe, expect, it, vi } from 'vitest';

describe('one diagram as its own document', () => {
  it('works on a canvas this page has never displayed, whose revisions are not yet in the registry', async () => {
    const { createStoredDiagram, reviseStoredDiagram } = await import('../../../../../domain/core/diagrams/diagramRevisionStore');
    const { DefaultCanvasHistoryService } = await import('../../../../../domain/core/diagrams/canvasHistoryService');
    const { mappingDocumentFromScene } = await import('../../../../../domain/mapping/workspace/mappingDocument');
    const { initialCanvasState } = await import('../../../../../domain/mapping/workspace/mappingWorkspace');
    const first = createStoredDiagram({ id: 'a', revision: 0, ascii: '[A] Alpha' }).diagram;
    const edited = reviseStoredDiagram(first.revisionId, { kind: 'replace', input: { ascii: '[A] Alpha\n`-- edited' } }).diagram;
    const other = createStoredDiagram({ id: 'b', revision: 0, ascii: '[B] Beta' }).diagram;
    const scene = { contents: { a: edited, b: other }, root: { id: 'root', kind: 'container' as const, position: { column: 0, row: 0 }, collapsed: false, layout: { collisionPolicy: 'push-right' as const, gap: 3 }, children: [
      { id: 'box-a', kind: 'diagram' as const, position: { column: 0, row: 0 }, collapsed: false, contentId: 'a' },
      { id: 'box-b', kind: 'diagram' as const, position: { column: 40, row: 0 }, collapsed: false, contentId: 'b' }] } };
    const histories = new DefaultCanvasHistoryService();
    const stored = JSON.parse(JSON.stringify(histories.exportContext(histories.openContext(mappingDocumentFromScene(scene), initialCanvasState()))));

    // As after a page load: stored JSON, and a registry that has seen none of it.
    vi.resetModules();
    const { singleDiagramDocument } = await import('../promoteDiagram');
    const { document, history } = singleDiagramDocument(stored, 'box-a');
    expect(Object.keys(document.scene.contents)).toEqual(['a']);
    expect(document.scene.contents.a.content.ascii).toBe('[A] Alpha\n`-- edited');
    expect(history.headId).toBeTruthy();
  });
});
