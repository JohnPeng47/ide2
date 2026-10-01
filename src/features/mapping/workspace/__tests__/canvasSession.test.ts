import { selectCanvasMarquee } from '../../../../../domain/mapping/selection/canvasSelection';
import { describe, expect, it, vi } from 'vitest';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { CanvasWorkspace } from '../canvasWorkspace';
import * as history from '../../../../../domain/core/diagrams/canvasHistory';

function setup() {
  const document = mappingDocumentFromScene(singleDiagramScene('Root\n`-- Child'));
  const seed = { name: 'Canvas', savedName: 'Canvas', savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges),
    revisionId: 'saved', busy: false, document, canvas: initialCanvasState() };
  const workspace = new CanvasWorkspace();
  workspace.setDrafts({ a: seed, b: { ...seed, name: 'Second', savedName: 'Second' } });
  const session = workspace.store.getState().drafts.a.session;
  return { workspace, session, seed };
}
function edit(session: ReturnType<typeof setup>['session'], text: string) {
  const controller = session.controller;
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'replace', nodeId: 'grid:overview', ascii: `Root\n\`-- ${text}` }]);
}

describe('CanvasSession state boundaries', () => {
  it('isolates 1000 marquee hit tests from documents, panels, status, registry, history and persistence', () => {
    const { workspace, session } = setup();
    const stores = [session.document, session.presentation, session.controls, session.geometry, session.status,
      workspace.store, workspace.dirtyScenes, workspace.changes, workspace.store.getState().drafts.b.session.document];
    const listeners = stores.map(store => { const listener = vi.fn(); store.subscribe(listener); return listener; });
    const controller = vi.fn(); session.controller.subscribe(controller);
    const exportHistory = vi.spyOn(session.controller, 'exportHistory');
    const fingerprints = vi.spyOn(history, 'stateKey');
    for (let i = 0; i < 1000; i++) selectCanvasMarquee(session.document.getState().document.scene, undefined,
      { left: 0, top: 0, right: 10, bottom: i / 1000 });
    expect(listeners.every(listener => listener.mock.calls.length === 0)).toBe(true);
    expect(controller).not.toHaveBeenCalled(); expect(exportHistory).not.toHaveBeenCalled(); expect(fingerprints).not.toHaveBeenCalled();
    fingerprints.mockRestore(); workspace.dispose();
  });

  it('publishes a presentation checkpoint without dirty comparisons or document notifications', () => {
    const { workspace, session } = setup();
    const document = vi.fn(), registry = vi.fn(), persistence = vi.fn();
    session.document.subscribe(document); workspace.store.subscribe(registry); workspace.changes.subscribe(persistence);
    const fingerprints = vi.spyOn(history, 'stateKey');
    session.controller.updateCanvas(current => ({ ...current, display: { ...current.display } }), true);
    expect(session.status.getState()).toMatchObject({ isDirty: false, sceneDirty: false, canUndo: true });
    expect(document).not.toHaveBeenCalled(); expect(registry).not.toHaveBeenCalled(); expect(fingerprints).not.toHaveBeenCalled();
    expect(persistence).toHaveBeenCalledTimes(1);
    fingerprints.mockRestore(); workspace.dispose();
  });

  it('marks edits dirty, undo to saved content clean, and redo dirty again', () => {
    const { workspace, session } = setup();
    const other = vi.fn(); workspace.store.getState().drafts.b.session.document.subscribe(other);
    edit(session, 'Changed');
    expect(session.status.getState().isDirty).toBe(true); expect(workspace.dirtyScenes.getState().ids).toEqual(['a']);
    session.controller.undo();
    expect(session.status.getState().isDirty).toBe(false);
    session.controller.undo(true);
    expect(session.status.getState().isDirty).toBe(true); expect(other).not.toHaveBeenCalled();
    workspace.dispose();
  });

  it('acknowledges the saved snapshot without losing newer edits, including renames', () => {
    const { workspace, session, seed } = setup();
    edit(session, 'Saved edit');
    const savedScene = JSON.stringify(session.document.getState().document.scene);
    edit(session, 'Newer edit');
    workspace.setDrafts(drafts => ({ ...drafts, a: { ...drafts.a, savedScene, name: 'Newer name' } }));
    expect(session.status.getState().isDirty).toBe(true);
    session.controller.undo();
    expect(session.status.getState()).toMatchObject({ sceneDirty: false, isDirty: true });
    workspace.setDrafts(drafts => ({ ...drafts, a: { ...drafts.a, name: seed.name } }));
    expect(session.status.getState().isDirty).toBe(false);
    workspace.dispose();
  });

  it('replaces restored sessions and stops forwarding events from discarded controllers', () => {
    const { workspace, session, seed } = setup();
    workspace.setDrafts({ a: seed });
    const events = vi.fn(); workspace.changes.subscribe(events);
    edit(session, 'Discarded');
    expect(events).not.toHaveBeenCalled();
    expect(workspace.controllers.get('a')).not.toBe(session.controller);
    expect(workspace.controllers.has('b')).toBe(false);
    expect(workspace.store.getState().drafts.a.session.status.getState().isDirty).toBe(false);
    workspace.dispose();
  });
});

it('copies the current workspace document with independent history and preserved presentation', () => {
  const { workspace, session } = setup();
  const controller = session.controller;
  controller.applyUpdate(0, [{ method: 'diagram-create', id: 'second', ascii: 'Other', position: { column: 40, row: 8 } }]);
  const first = controller.nodes().find(n => n.id === 'grid:overview');
  if (!first || first.layout !== 'grid' || !first.content || !first.contentNodes) throw Error('Missing diagram');
  controller.applyUpdate(1, [{ method: 'edge-create', edge: { id: 'edge', source: { kind: 'content-node', displayNodeId: first.id,
    contentNodeId: first.contentNodes[0].id, revisionId: first.content.revisionId, side: 'right' },
    target: { kind: 'box', displayNodeId: 'grid:second', side: 'left' },
    appearance: { color: '#88c0d0', lineStyle: 'solid', label: 'Related' } } }]);
  controller.updateCanvas(current => ({ ...current, display: { rootIds: ['detail'], nodes: { detail: {
    id: 'detail', kind: 'detail', title: 'Notes', ascii: 'Kept', childIds: [], expansion: 'expanded',
    coordinateSpace: 'canvas', position: { x: 450, y: 200 }, bounds: { width: 300, height: 180 },
    geometryPolicy: { placement: 'manual', sizing: 'fixed' }
  } } } }), true);
  edit(session, 'Unsaved edit');
  const mapped = controller.getSnapshot().document.scene.contents.overview;
  controller.applyUpdate(controller.getSnapshot().version, [{ method: 'setSourceMappings', nodeId: 'grid:overview', expectedContentHash: mapped.content.asciiSha256,
    mappings: [{ id: 'mapping', entityId: 'entity', sourceRangeIndex: 0, sourceRangeId: 'range', line: 1, startColumn: 1, endColumn: 4 }],
    evidence: { entity: { id: 'entity', handle: 'Root', label: 'Root', category: 'operation', summary: 'Root definition',
      sourceRanges: [{ id: 'range', path: 'root.ts', startLine: 1, endLine: 1, originalLines: ['function Root() {}'] }] } } }]);
  const before = controller.getSnapshot(), historyBefore = controller.exportHistory();
  const persisted: string[][] = []; workspace.onPersist(ids => persisted.push(ids));
  const viewport = { offset: { x: 123, y: 45 }, scale: .8 };
  const { documentId } = workspace.copyDocument({ documentId: 'a', name: 'Independent copy', expectedVersion: before.version, viewport });
  const draft = workspace.store.getState().drafts[documentId], copied = draft.session.controller;
  expect(documentId).toMatch(/^draft-/);
  expect(draft.representationId).toBeUndefined(); expect(draft.revisionId).toBe('');
  expect(draft.viewport).toEqual(viewport); expect(draft.viewport).not.toBe(viewport);
  expect(copied.getSnapshot().document).toEqual(before.document);
  expect(copied.resolveDiagram('overview').sourceContext.mappings).toHaveLength(1);
  expect(copied.resolveDiagram('overview').sourceContext).toEqual(controller.resolveDiagram('overview').sourceContext);
  expect(copied.getSnapshot().canvas.display).toEqual(before.canvas.display);
  expect(copied.getSnapshot().contextId).not.toBe(before.contextId);
  expect(copied.getSnapshot()).toMatchObject({ version: 0, canUndo: false, canRedo: false });
  expect(draft.session.status.getState().isDirty).toBe(true);
  expect(persisted).toEqual([[documentId]]);
  edit(draft.session, 'Changed only in copy'); copied.undo();
  expect(copied.getSnapshot().document).toEqual(before.document);
  expect(controller.getSnapshot()).toBe(before); expect(controller.exportHistory()).toEqual(historyBefore);
  edit(session, 'Changed only in original');
  expect(copied.getSnapshot().document).toEqual(before.document);
  workspace.dispose();
});

it('rejects stale, busy, hidden or missing copy sources without adding drafts', () => {
  const { workspace, session } = setup();
  edit(session, 'Changed');
  expect(() => workspace.copyDocument({ documentId: 'a', name: 'Copy', expectedVersion: 0 })).toThrow('VERSION_CONFLICT');
  expect(() => workspace.copyDocument({ documentId: 'missing', name: 'Copy' })).toThrow('DOCUMENT_UNAVAILABLE');
  workspace.setDrafts(current => ({ ...current, a: { ...current.a, busy: true } }));
  expect(() => workspace.copyDocument({ documentId: 'a', name: 'Copy' })).toThrow('DOCUMENT_BUSY');
  workspace.setDrafts(current => ({ ...current, a: { ...current.a, busy: false, hidden: true } }));
  expect(() => workspace.copyDocument({ documentId: 'a', name: 'Copy' })).toThrow('DOCUMENT_UNAVAILABLE');
  expect(Object.keys(workspace.store.getState().drafts)).toEqual(['a', 'b']);
  workspace.dispose();
});
