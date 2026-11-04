import { describe, expect, it } from 'vitest';
import { createStoredDiagram } from '../diagramRevisionStore';
import { DefaultCanvasHistoryService } from '../canvasHistoryService';
import { documentFromHistory, validateCanvasHistory } from '../canvasHistory';
import { validateCanvasScene } from '../projectDiagramCanvas';
import { promotedCanvasName, singleBoxScene } from '../promoteDiagram';
import type { LineGridScene } from '../lineGrid';
import { mappingDocumentFromScene } from '../../../mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../mapping/workspace/mappingWorkspace';

const diagram = (id: string, ascii: string) => createStoredDiagram({ id, revision: 0, ascii }).diagram;
const source: LineGridScene = {
  contents: { a: diagram('a', '[A] Alpha\n=====\nAlpha body'), b: diagram('b', '=====\n[B] Beta'), 'b-summary': diagram('b-summary', '[B]') },
  root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [
    { id: 'box-a', kind: 'diagram', position: { column: 0, row: 0 }, collapsed: false, contentId: 'a' },
    { id: 'group', kind: 'container', position: { column: 40, row: 10 }, collapsed: false, layout: { collisionPolicy: 'push-right', gap: 3 }, children: [
      { id: 'box-b', kind: 'diagram', position: { column: 5, row: 7 }, collapsed: true, contentId: 'b', collapsedContentId: 'b-summary' }] }] }
};

describe('promoting one diagram to its own canvas', () => {
  it('keeps the diagram value and its summary, placed expanded at the origin', () => {
    const scene = singleBoxScene(source, 'box-b');
    expect(Object.keys(scene.contents).sort()).toEqual(['b', 'b-summary']);
    expect(scene.contents.b).toBe(source.contents.b);
    expect(scene.root.kind === 'container' && scene.root.children).toEqual([
      { id: 'box-b', kind: 'diagram', position: { column: 0, row: 0 }, collapsed: false, contentId: 'b', collapsedContentId: 'b-summary' }]);
    validateCanvasScene(scene);
  });

  it('yields a document whose fresh history validates', () => {
    const document = mappingDocumentFromScene(singleBoxScene(source, 'box-a'));
    const histories = new DefaultCanvasHistoryService();
    const history = histories.exportContext(histories.openContext(document, initialCanvasState()));
    validateCanvasHistory(history);
    expect(Object.keys(documentFromHistory(history).scene.contents)).toEqual(['a']);
  });

  it('rejects containers and unknown boxes, and names the canvas from the first line of text', () => {
    expect(() => singleBoxScene(source, 'group')).toThrow('Only a diagram box');
    expect(() => singleBoxScene(source, 'missing')).toThrow('Only a diagram box');
    expect(promotedCanvasName(source, 'box-a', 'Fallback')).toBe('[A] Alpha');
    expect(promotedCanvasName(source, 'box-b', 'Fallback')).toBe('[B] Beta');
  });
});
