import { diagramSelectionItem, regionSelectionItem } from '../../../../../domain/mapping/selection/selectionState';
import { afterEach, expect, it, vi } from 'vitest';
import { observeCanvasSelection, publishLiveCanvasSelections } from '../liveCanvasPublisher';
import { CanvasWorkspace } from '../../workspace/canvasWorkspace';
import { CanvasSession } from '../../workspace/canvasSession';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { addDisplayNode, displayGeometry, type SelectionRegion } from '../../../../../domain/mapping/workspace/displayModel';
import { selectionDelta } from '../../../../../domain/mapping/agent/liveCanvasStatus';
import { selectionClipboardText } from '../../../../../domain/mapping/workspace/selectionClipboard';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('preserves padding, blank lines and deduplicated references in the shared copy payload', () => {
  const diagram = new RevisionedDiagramService().create({ id: 'test', revision: 0, ascii: ' AB\n\nEnd', evidence: {
    source: { id: 'source', handle: 'source', label: 'Example', category: 'operation', summary: 'Example',
      sourceRanges: [{ id: 'range', path: 'file.ts', startLine: 4, endLine: 6, originalLines: ['a', 'b', 'c'] }] }
  }, mappings: ['a', 'b'].map((id, i) => ({ id, entityId: 'source', sourceRangeIndex: 0, line: 1, startColumn: i + 2, endColumn: i + 2 })) }).diagram;
  expect(selectionClipboardText(diagram, { startLine: 1, endLine: 3, startColumn: 1, endColumn: 4 }, ['test:a', 'test:b']))
    .toBe(' AB \n    \nEnd \nAssociated Code Entities:\nExample: file.ts:4-6');
  expect(selectionClipboardText(diagram, null, ['test:a'])).toBeNull();
});

it('coalesces selection controls and never exports history or writes to the controller', () => {
  vi.useFakeTimers();
  const scene = singleDiagramScene('Root\n\nEnd');
  const session = new CanvasSession({ name: 'Test', savedName: 'Test', savedScene: JSON.stringify(scene),
    document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() });
  const history = vi.spyOn(session.controller, 'exportHistory');
  const changed = vi.fn();
  const observer = observeCanvasSelection(session, 'document', changed);
  expect(changed.mock.lastCall?.[0].regions).toEqual([]);
  const rect = { startLine: 1, endLine: 3, startColumn: 1, endColumn: 4 };
  session.controller.select({ type: 'add', items: [regionSelectionItem(session.controller.getSnapshot().document.scene.contents.overview, 'overview', rect, 'retained-a')] });
  session.controller.updateCanvas(c => ({ ...c, controls: { ...c.controls, selectionFocusId: 'retained-a' } }));
  expect(changed).toHaveBeenCalledTimes(1);
  const update = vi.spyOn(session.controller, 'updateCanvas');
  vi.runAllTimers();
  expect(changed).toHaveBeenCalledTimes(2);
  expect(changed.mock.lastCall?.[0].regions[0].text).toBe('Root\n    \nEnd \nAssociated Code Entities:');
  expect(update).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
  // A source edit marks the captured selection stale without silently changing its meaning.
  session.controller.applyUpdate(session.controller.getSnapshot().version, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 1, end: 1, patch: 'Next' }]);
  vi.runAllTimers(); expect(changed.mock.lastCall?.[0].regions[0]).toMatchObject({ stale: true, text: expect.stringContaining('Root') });
  session.controller.select({ type: 'clear' });
  vi.runAllTimers(); expect(changed.mock.lastCall?.[0].regions).toEqual([]);
  observer.dispose(); session.dispose();
});


it('enumerates retained regions across diagrams, deduplicates the active one, and reports removals without resending unchanged text', () => {
  vi.useFakeTimers();
  const base = singleDiagramScene('Root\nEnd');
  if (base.root.kind !== 'container') throw new Error('Expected a container fixture');
  const scene = { ...base, contents: { ...base.contents,
    other: new RevisionedDiagramService().create({ id: 'other', revision: 0, ascii: 'Other' }).diagram },
    root: { ...base.root, children: [...base.root.children, { id: 'other-box', kind: 'diagram' as const,
      contentId: 'other', position: { column: 20, row: 0 }, collapsed: false }] } };
  const session = new CanvasSession({ name: 'Test', savedName: 'Test', savedScene: JSON.stringify(scene),
    document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() });
  const changed = vi.fn(), observer = observeCanvasSelection(session, 'doc', changed);
  const rect = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 };
  const contentId = Object.keys(scene.contents)[0];
  const a: SelectionRegion = { ...displayGeometry(), id: 'retained-a', kind: 'selection', childIds: [], expansion: 'expanded',
    displayMode: 'stacked', sourceBoxId: 'overview', sourceContentId: contentId, sourceAscii: 'Root\nEnd', rect, selectedIds: [] };
  session.controller.select({ type: 'add', items: [regionSelectionItem(session.controller.getSnapshot().document.scene.contents.overview, 'overview', rect, 'retained-a')] });
  vi.runAllTimers();
  const draftId = changed.mock.lastCall![0].regions[0].id;
  session.controller.updateCanvas(c => ({ ...c, display: addDisplayNode(c.display, a),
    controls: { ...c.controls, selectionFocusId: a.id } }));
  vi.runAllTimers();
  expect(changed.mock.lastCall![0].regions).toHaveLength(1);
  expect(changed.mock.lastCall![0].regions[0].id).toBe(draftId);
  // Regions can belong to different diagrams within the same canvas.
  const b: SelectionRegion = { ...a, id: 'retained-b', sourceBoxId: 'other-box', sourceContentId: 'other', sourceAscii: 'Other' };
  session.controller.updateCanvas(c => ({ ...c, display: addDisplayNode(c.display, b) }));
  session.controller.select({ type: 'add', items: [regionSelectionItem(scene.contents.other, 'other-box', rect, b.id)] });
  vi.runAllTimers();
  const both = changed.mock.lastCall![0];
  expect(both.regions).toHaveLength(2);
  expect(both.regions[1]).toMatchObject({ id: b.id, stale: false, text: 'Othe\nAssociated Code Entities:' });
  // A retained snapshot survives source edits without claiming to be current.
  session.controller.applyUpdate(session.controller.getSnapshot().version,
    [{ method: 'patchDiagram', nodeId: 'grid:other-box', start: 1, end: 1, patch: 'Changed' }]);
  vi.runAllTimers();
  const stale = changed.mock.lastCall![0];
  expect(stale.regions[1]).toMatchObject({ id: b.id, stale: true, text: 'Othe\nAssociated Code Entities:' });
  const count = changed.mock.calls.length;
  // Focus, collapse, and unrelated document versions do not republish content.
  session.controller.updateCanvas(c => ({ ...c, controls: { ...c.controls, selectionFocusId: null },
    display: { ...c.display, nodes: { ...c.display.nodes, [a.id]: { ...a, expansion: 'collapsed' } } } }));
  vi.runAllTimers(); expect(changed).toHaveBeenCalledTimes(count);
  session.controller.select({ type: 'remove', id: a.id });
  vi.runAllTimers();
  expect(selectionDelta(stale, changed.mock.lastCall![0])).toMatchObject({ removed: [draftId], upserted: [] });
  session.controller.select({ type: 'remove', id: b.id });
  vi.runAllTimers(); expect(changed.mock.lastCall![0].regions).toEqual([]);
  observer.dispose(); session.dispose();
});


it('diffs coalesced publisher updates against the last sent state and resets to a snapshot on reconnect', () => {
  vi.useFakeTimers();
  class Socket {
    static OPEN = 1;
    static all: Socket[] = [];
    readyState = 1; bufferedAmount = 0;
    onopen = () => {}; onclose = () => {}; onerror = () => {};
    onmessage = (_event: { data: string }) => {};
    frames: Record<string, unknown>[] = [];
    constructor() { Socket.all.push(this); }
    send(raw: string) { this.frames.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose(); }
    ready() { this.onopen(); this.onmessage({ data: '{"type":"publisher.ready","protocolVersion":2}' }); }
  }
  vi.stubGlobal('WebSocket', Socket);
  const workspace = new CanvasWorkspace(), scene = singleDiagramScene('Root\nEnd');
  workspace.setDrafts({ doc: { name: 'Test', savedName: 'Test', savedScene: JSON.stringify(scene), revisionId: '', busy: false,
    document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() } });
  const status = vi.fn();
  const dispose = publishLiveCanvasSelections(workspace, 'workspace', 'ws://test', status);
  try {
    const ws = Socket.all[0]; ws.ready();
    expect(status.mock.lastCall?.[0]).toEqual({ connected: true, count: 0 });
    ws.onmessage({ data: '{"type":"agents.changed","count":2}' });
    expect(status.mock.lastCall?.[0]).toEqual({ connected: true, count: 2 });
    expect(ws.frames[1]).toMatchObject({ type: 'selection.snapshot', regions: [], sequence: 0 });
    const controller = workspace.store.getState().drafts.doc.session.controller;
    const setRect = (line: number | null) => controller.select(line ? { type: 'replace', items: [regionSelectionItem(scene.contents.overview, 'overview', { startLine: line, endLine: line, startColumn: 1, endColumn: 4 })] } : { type: 'clear' });
    setRect(1); vi.advanceTimersByTime(1);
    const added = ws.frames.at(-1)!;
    expect(added).toMatchObject({ type: 'selection.delta', baseSequence: 0, sequence: 1 });
    const id = (added.upserted as { id: string }[])[0].id;
    ws.bufferedAmount = 100_000;
    setRect(null); vi.advanceTimersByTime(1);
    setRect(2); vi.advanceTimersByTime(1);
    expect(ws.frames).toHaveLength(3);
    ws.bufferedAmount = 0; vi.advanceTimersByTime(20);
    expect(ws.frames.at(-1)).toMatchObject({ type: 'selection.delta', baseSequence: 1, sequence: 3, removed: [id],
      upserted: [{ text: 'End \nAssociated Code Entities:' }] });
    ws.close();
    expect(status.mock.lastCall?.[0]).toEqual({ connected: false, count: 0 });
    vi.advanceTimersByTime(1000);
    const replacement = Socket.all[1]; replacement.ready();
    expect(status.mock.lastCall?.[0]).toEqual({ connected: true, count: 0 });
    expect(replacement.frames[1]).toMatchObject({ type: 'selection.snapshot', sequence: 3,
      regions: [{ text: 'End \nAssociated Code Entities:' }] });
    const count = replacement.frames.length;
    controller.updateCanvas(c => ({ ...c, controls: { ...c.controls, activeThreadId: 'unrelated' } }));
    vi.advanceTimersByTime(10); expect(replacement.frames).toHaveLength(count);
  } finally { dispose(); workspace.dispose(); }
});

it('publishes whole diagrams by nodes.list IDs only, replaces their regions, and keeps other regions unchanged', async () => {
  vi.useFakeTimers();
  const { deselectCanvas } = await import('../../../../../domain/mapping/selection/canvasSelection');
  const scene = singleDiagramScene('Root\nEnd');
  if (scene.root.kind !== 'container') throw Error('Expected container');
  scene.contents = { ...scene.contents, other: new RevisionedDiagramService().create({ id: 'other', revision: 0, ascii: 'Other' }).diagram };
  scene.root.children = [...scene.root.children, { id: 'other-box', kind: 'diagram', contentId: 'other', position: { column: 20, row: 0 }, collapsed: false }];
  const session = new CanvasSession({ name: 'Test', savedName: 'Test', savedScene: JSON.stringify(scene),
    document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() });
  const a: SelectionRegion = { ...displayGeometry(), id: 'a', kind: 'selection', childIds: [], expansion: 'expanded', displayMode: 'stacked',
    sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii: 'Root\nEnd', selectedIds: [],
    rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } };
  const b: SelectionRegion = { ...a, id: 'b', sourceBoxId: 'other-box', sourceContentId: 'other', sourceAscii: 'Other' };
  session.controller.updateCanvas(c => ({ ...c, display: addDisplayNode(addDisplayNode(c.display, a), b) }));
  session.controller.select({ type: 'add', items: [regionSelectionItem(scene.contents.overview, 'overview', a.rect, a.id), regionSelectionItem(scene.contents.other, 'other-box', b.rect, b.id)] });
  const changed = vi.fn(), observer = observeCanvasSelection(session, 'doc', changed);
  const before = changed.mock.lastCall![0];
  session.controller.select({ type: 'add', items: [diagramSelectionItem('grid:overview')] });
  vi.runAllTimers();
  const after = changed.mock.lastCall![0];
  expect(after.diagramIds).toEqual(['grid:overview']);
  expect(session.controller.nodes().some(node => node.id === after.diagramIds[0])).toBe(true);
  expect(after.regions).toEqual([before.regions[1]]);
  expect(selectionDelta(before, after)).toMatchObject({ diagramIds: ['grid:overview'], upserted: [], removed: ['a'] });
  const count = changed.mock.calls.length;
  session.controller.applyUpdate(session.controller.getSnapshot().version,
    [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 1, end: 1, patch: 'Changed diagram' }]);
  vi.runAllTimers();
  expect(changed).toHaveBeenCalledTimes(count); // No diagram contents are streamed by selection.
  session.controller.updateCanvas(deselectCanvas);
  vi.runAllTimers();
  expect(changed.mock.lastCall![0]).toMatchObject({ diagramIds: [], regions: [] });
  expect(session.controller.getSnapshot().canvas.display.nodes.a).toBeDefined(); // Pane context remains available.
  observer.dispose(); session.dispose();
});
