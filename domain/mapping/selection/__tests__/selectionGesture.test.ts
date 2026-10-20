import { describe, expect, it } from 'vitest';
import { NativeSelectionOwnership, SelectionGestureController, type GestureStart } from '../selectionGesture';

const label = { diagramId: 'grid:a', nodeId: 'node', revision: 'r1' };
const start = (patch: Partial<GestureStart> = {}): GestureStart => ({ pointerId: 1, pointerType: 'touch',
  x: 20, y: 20, time: 0, tool: 'select', add: false, hit: label, ...patch });

describe('shared selection recognition', () => {
  it.each(['select', 'hand'] as const)('fingers only pan in %s, including double taps, tap-drag and move handles', tool => {
    const controller = new SelectionGestureController();
    for (const patch of [{}, { moveHandle: true }, { ctrl: true, add: true }]) {
      expect(controller.down(start({ tool, ...patch }))?.kind).toBe('pan');
      expect(controller.up(start({ time: 50 }))).toBeUndefined();
      expect(controller.down(start({ tool, time: 120, ...patch }))?.kind).toBe('pan');
      expect(controller.up(start({ time: 160 }))).toBeUndefined();
      controller.down(start({ tool, time: 200, ...patch }));
      expect(controller.move(start({ x: 80 }))?.kind).toBe('pan');
      expect(controller.up(start({ time: 260, x: 80 }))).toBeUndefined();
    }
  });
  it.each(['mouse', 'pen'])('remembers ever crossing slop for %s, even after returning to origin', pointerType => {
    const controller = new SelectionGestureController();
    controller.down(start({ pointerType, ctrl: pointerType === 'mouse' }));
    controller.move(start({ x: 50 }));
    expect(controller.up(start({ time: 90 }))?.kind).toBe('marquee');
  });
  it('does not reinterpret a returning mouse label drag as a click', () => {
    const controller = new SelectionGestureController();
    controller.down(start({ pointerType: 'mouse' })); controller.move(start({ x: 25 }));
    expect(controller.up(start({ time: 90 }))).toBeUndefined();
  });
  it('leaves stationary mouse clicks to the Ctrl-click count handler', () => {
    const controller = new SelectionGestureController();
    controller.down(start({ pointerType: 'mouse' }));
    expect(controller.up(start({ time: 20 }))).toBeUndefined();
    controller.down(start({ pointerType: 'mouse', ctrl: true }));
    expect(controller.up(start({ time: 30 }))).toBeUndefined();
  });
  it('uses precise pen slop and selected tool semantics without a touch doubletap shortcut', () => {
    const controller = new SelectionGestureController();
    controller.down(start({ pointerType: 'pen' }));
    expect(controller.move(start({ x: 25 }))?.moved).toBe(true);
    controller.up(start({ time: 30, x: 25 }));
    expect(controller.down(start({ pointerType: 'pen', tool: 'hand', time: 80 }))).toMatchObject({ kind: 'pan' });
  });
  it('keeps desktop accumulation and retains explicit pen selection policy', () => {
    for (const [pointerType, add, policy] of [['pen', false, 'replace'], ['pen', true, 'add'], ['mouse', false, 'add']] as const) {
      const controller = new SelectionGestureController();
      expect(controller.down(start({ pointerType, add }))?.policy).toBe(policy);
    }
  });
  it('can select with a pen immediately after fingers finish panning', () => {
    const controller = new SelectionGestureController();
    controller.down(start()); controller.move(start({ x: 100 })); controller.up(start({ time: 50, x: 100 }));
    expect(controller.down(start({ pointerType: 'pen', time: 80 }))?.kind).toBe('marquee');
    expect(controller.up(start({ pointerType: 'pen', time: 90 }))).toEqual({ kind: 'tap', hit: label, policy: 'replace' });
  });
  it('cancels immediately on a second contact and holds the latch across native interrupts and partial releases', () => {
    const controller = new SelectionGestureController();
    controller.down(start()); controller.move(start({ x: 100 }));
    expect(controller.down(start({ pointerId: 2 }))).toBeUndefined();
    expect(controller.gesture).toBeUndefined();
    controller.cancel(); // Native pinch interrupt must not forget either contact.
    expect(controller.contacts.size).toBe(2);
    expect(controller.up(start({ pointerId: 2 }))).toBeUndefined();
    expect(controller.blocked).toBe(true);
    expect(controller.move(start({ x: 150 }))).toBeUndefined();
    expect(controller.down(start({ pointerId: 3 }))).toBeUndefined();
    controller.up(start({ pointerId: 3 })); controller.up(start());
    expect(controller.blocked).toBe(false);
    expect(controller.down(start())?.kind).toBe('pan');
  });
  it('leaves native move, Alt duplication, Space pan and mouse frame operations to the editor', () => {
    const controller = new SelectionGestureController();
    for (const patch of [{ moveHandle: true }, { pointerType: 'mouse', alt: true }, { pan: true }, { pointerType: 'mouse', hit: undefined }]) {
      expect(controller.down(start({ pointerType: 'mouse', ...patch }))?.kind).toMatch(/native|move/);
      expect(controller.up(start())).toBeUndefined();
    }
  });
  it('retains application ownership through repeated settlements until an intended native operation', () => {
    const ownership = new NativeSelectionOwnership();
    expect(ownership.captureSelection).toBe(false);
    ownership.claim('native'); expect(ownership.captureSelection).toBe(true);
    ownership.claim('application');
    for (let frame = 0; frame < 5; frame++) expect(ownership.captureSelection).toBe(false);
  });
});
