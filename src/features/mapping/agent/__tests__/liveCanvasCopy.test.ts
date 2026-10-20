import { expect, it } from 'vitest';
import { LiveCanvasCopyReceiver } from '../liveCanvasCopy';
import { CanvasWorkspace } from '../../workspace/canvasWorkspace';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../../domain/mapping/workspace/mappingWorkspace';

function fixture() {
  const workspace = new CanvasWorkspace(), scene = singleDiagramScene('Existing');
  const seed = { name: 'Test', savedName: 'Test', savedScene: JSON.stringify(scene), revisionId: '', busy: false,
    document: { scene, edges: [], sections: {} }, canvas: initialCanvasState() };
  workspace.setDrafts({ a: seed, b: seed });
  const { a, b } = workspace.store.getState().drafts;
  return { workspace, receiver: new LiveCanvasCopyReceiver(), a, b };
}
const command = { type: 'diagram.copy.command' as const, commandId: 'copy-1', documentId: 'a', canvasEpoch: 'epoch', ascii: 'Copied\n|-- Child\n`-- Tail  ' };

it('stages without mutating history, pastes at current version repeatedly, and clears without undo changes', () => {
  const f = fixture(), controller = f.a.session.controller;
  try {
    const before = controller.getSnapshot();
    expect(f.receiver.apply(command, f.a, 'epoch').result).toEqual({ ok: true });
    expect(controller.getSnapshot()).toBe(before);
    expect(f.b.session.cursorCopy.store.getState().ascii).toBeUndefined();
    controller.applyUpdate(before.version, [{ method: 'diagram-create', id: 'unrelated', ascii: 'Other', position: { column: 50, row: 30 } }]);
    const paste = () => f.a.session.cursorCopy.paste(controller, { column: 12, row: 8 });
    const first = paste()!;
    expect(first.version).toBe(before.version + 2);
    expect(Object.values(controller.getSnapshot().document.scene.contents).filter(diagram => diagram.content.ascii === command.ascii)).toHaveLength(1);
    paste();
    const second = controller.getSnapshot();
    expect(Object.values(second.document.scene.contents).filter(diagram => diagram.content.ascii === command.ascii)).toHaveLength(2);
    f.a.session.cursorCopy.clear();
    expect(controller.getSnapshot()).toBe(second);
    expect(paste()).toBeUndefined();
    // Lost acknowledgements cannot resurrect canceled text, or replace a newer copy.
    expect(f.receiver.apply(command, f.a, 'epoch').result).toEqual({ ok: true });
    expect(f.a.session.cursorCopy.store.getState().ascii).toBeUndefined();
    f.receiver.apply({ ...command, commandId: 'copy-2', ascii: 'New copy' }, f.a, 'epoch');
    f.receiver.apply(command, f.a, 'epoch');
    expect(f.a.session.cursorCopy.store.getState().ascii).toBe('New copy');
  } finally { f.workspace.dispose(); }
});

it('rejects stale/busy/invalid copies without replacing the buffer and clears on disposal', () => {
  const f = fixture();
  try {
    f.receiver.apply(command, f.a, 'epoch');
    expect(f.receiver.apply({ ...command, commandId: 'bad', ascii: '─' }, f.a, 'epoch').result).toMatchObject({ ok: false, code: 'INVALID_DIAGRAM' });
    expect(f.receiver.apply({ ...command, commandId: 'busy' }, f.a, 'epoch', false).result).toMatchObject({ ok: false, code: 'WORKSPACE_BUSY' });
    expect(f.receiver.apply(command, f.a, 'different').result).toMatchObject({ ok: false, code: 'CANVAS_REPLACED' });
    expect(f.receiver.apply({ ...command, ascii: 'changed' }, f.a, 'epoch').result).toMatchObject({ ok: false, code: 'REQUEST_ID_REUSED' });
    expect(f.a.session.cursorCopy.store.getState().ascii).toBe(command.ascii);
  } finally { f.workspace.dispose(); }
  expect(f.a.session.cursorCopy.store.getState().ascii).toBeUndefined();
});
