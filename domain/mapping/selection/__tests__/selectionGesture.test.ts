import { describe, expect, it } from 'vitest';
import { NativeSelectionOwnership, SelectionGestureController, type GestureStart } from '../selectionGesture';

const label = { diagramId: 'grid:a', nodeId: 'node', revision: 'r1' };
const start = (patch: Partial<GestureStart> = {}): GestureStart => ({ pointerId: 1, pointerType: 'touch',
  x: 20, y: 20, time: 0, tool: 'select', add: false, hit: label, ...patch });

describe('shared selection recognition', () => {
  it('commits a first tap immediately; touch jitter has a ten-pixel budget', () => {
    const controller = new SelectionGestureController();
    controller.down(start()); controller.move(start({ x: 29 }));
    expect(controller.up(start({ time: 80 }))).toEqual({ kind: 'tap', hit: label, policy: 'replace' });
  });
  it.each(['mouse', 'pen', 'touch'])('remembers ever crossing slop for %s, even after returning to origin', pointerType => {
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
  it('leaves stationary Ctrl-clicks unchanged so Ctrl-doubleclick can toggle a whole diagram', () => {
    const controller = new SelectionGestureController();
    controller.down(start({ pointerType: 'mouse', ctrl: true }));
    expect(controller.up(start({ time: 30 }))).toBeUndefined();
  });
  it('uses precise pen slop and selected tool semantics without a touch doubletap shortcut', () => {
    const controller = new SelectionGestureController();
    controller.down(start({ pointerType: 'pen' }));
    expect(controller.move(start({ x: 25 }))?.moved).toBe(true);
    controller.up(start({ time: 30, x: 25 }));
    expect(controller.down(start({ pointerType: 'pen', tool: 'hand', time: 80 }))).toMatchObject({ kind: 'pan', secondTap: false });
  });
  it('keeps desktop accumulation and makes touch Add explicit', () => {
    for (const [pointerType, add, policy] of [['touch', false, 'replace'], ['touch', true, 'add'], ['mouse', false, 'add']] as const) {
      const controller = new SelectionGestureController();
      expect(controller.down(start({ pointerType, add }))?.policy).toBe(policy);
    }
  });
  it('recognizes a timed nearby second tap and enables its marquee in Pan', () => {
    const controller = new SelectionGestureController();
    controller.down(start({ tool: 'hand' }));
    expect(controller.up(start({ time: 50 }))?.kind).toBe('tap');
    expect(controller.down(start({ tool: 'hand', time: 250, x: 24 }))).toMatchObject({ secondTap: true, kind: 'marquee' });
    expect(controller.up(start({ time: 300, x: 24 }))?.kind).toBe('doubletap');
    controller.down(start({ tool: 'hand', time: 500 })); controller.up(start({ time: 530 }));
    controller.down(start({ tool: 'hand', time: 650 })); controller.move(start({ x: 80 }));
    expect(controller.up(start({ time: 700, x: 80 }))?.kind).toBe('marquee');
  });
  it.each([{ time: 500 }, { x: 60, time: 150 }, { hit: { ...label, revision: 'r2' }, time: 150 },
    { hit: { ...label, nodeId: 'other' }, time: 150 }, { pointerType: 'pen', time: 150 }])('requires time, distance, pointer type and exact identity: %j', patch => {
    const controller = new SelectionGestureController();
    controller.down(start({ tool: 'hand' })); controller.up(start({ time: 50 }));
    expect(controller.down(start({ tool: 'hand', ...patch }))).toMatchObject({ secondTap: false, kind: 'pan' });
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
    expect(controller.down(start())?.kind).toBe('marquee');
  });
  it('leaves native move, Alt duplication, Space pan and mouse frame operations to the editor', () => {
    const controller = new SelectionGestureController();
    for (const patch of [{ moveHandle: true }, { pointerType: 'mouse', alt: true }, { pan: true }, { pointerType: 'mouse', hit: undefined }]) {
      expect(controller.down(start(patch))?.kind).toMatch(/native|move/);
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
