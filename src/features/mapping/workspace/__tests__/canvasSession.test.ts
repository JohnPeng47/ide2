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
