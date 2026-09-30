import { afterEach, expect, it, vi } from 'vitest';
import { observeCanvasSelection } from '../liveCanvasPublisher';
import { CanvasSession } from '../../workspace/canvasSession';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { selectionClipboardText } from '../../../../../domain/mapping/workspace/selectionClipboard';

afterEach(() => vi.useRealTimers());
it('preserves padding, blank lines and deduplicated references in the shared copy payload', () => {
  const diagram = new RevisionedDiagramService().prepareCreate({ id: 'test', revision: 0, ascii: ' AB\n\nEnd', evidence: {
    source: { id: 'source', handle: 'source', label: 'Example', category: 'operation', summary: 'Example',
      sourceRanges: [{ id: 'range', path: 'file.ts', startLine: 4, endLine: 6, originalLines: ['a', 'b', 'c'] }] }
  }, mappings: ['a', 'b'].map((id, i) => ({ id, entityId: 'source', sourceRangeIndex: 0, line: 1, startColumn: i + 2, endColumn: i + 2 })) }).diagram;
  expect(selectionClipboardText(diagram, { startLine: 1, endLine: 3, startColumn: 1, endColumn: 4 }, ['test:a', 'test:b']))
    .toBe(' AB \n    \nEnd \nAssociated Code Entities:\nExample: file.ts:4-6');
  expect(selectionClipboardText(diagram, null, ['test:a'])).toBeNull();
});

it('coalesces selection controls, ignores pointer previews and never exports history or writes to the controller', () => {
  vi.useFakeTimers();
  const scene = singleDiagramScene('Root\n\nEnd');
  const session = new CanvasSession({ name: 'Test', savedName: 'Test', savedScene: JSON.stringify(scene),
    document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() });
  const history = vi.spyOn(session.controller, 'exportHistory');
  const changed = vi.fn();
  const observer = observeCanvasSelection(session, 'document', changed);
  expect(changed.mock.lastCall?.[0].text).toBeNull();
  for (let i = 0; i < 1000; i++) session.previewSelection({ boxId: 'overview', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } });
  vi.runAllTimers(); expect(changed).toHaveBeenCalledTimes(1);
  const rect = { startLine: 1, endLine: 3, startColumn: 1, endColumn: 4 };
  session.controller.updateCanvas(c => ({ ...c, controls: { ...c.controls, selectionRect: rect } }));
  session.controller.updateCanvas(c => ({ ...c, controls: { ...c.controls, selectedNodeIds: [] } }));
  expect(changed).toHaveBeenCalledTimes(1);
  const update = vi.spyOn(session.controller, 'updateCanvas');
  vi.runAllTimers();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed.mock.lastCall?.[0].text).toBe('Root\n    \nEnd \nAssociated Code Entities:');
  expect(update).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
  // Editing selected text republishes it even when the rectangle itself is unchanged.
  session.controller.applyUpdate(session.controller.getSnapshot().version, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 1, end: 1, patch: 'Next' }]);
  vi.runAllTimers(); expect(changed.mock.lastCall?.[0].text.startsWith('Next')).toBe(true);
  session.controller.updateCanvas(c => ({ ...c, controls: { ...c.controls, selectionRect: null } }));
  vi.runAllTimers(); expect(changed.mock.lastCall?.[0].text).toBeNull();
  observer.dispose(); session.dispose();
});
