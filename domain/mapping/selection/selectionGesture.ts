import type { SelectionBounds } from './canvasSelection';

export type SelectionPolicy = 'add' | 'replace';
export interface SelectionHit { diagramId: string; nodeId?: string; revision?: string }
export interface GesturePoint { pointerId: number; pointerType: string; x: number; y: number; time: number }
export interface GestureStart extends GesturePoint {
  hit?: SelectionHit; tool: 'select' | 'hand'; add: boolean;
  ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; pan?: boolean; moveHandle?: boolean;
}
export type GestureKind = 'marquee' | 'pan' | 'node' | 'native' | 'move' | 'blocked';
export interface SelectionGesture {
  start: GestureStart; kind: GestureKind; policy: SelectionPolicy; moved: boolean; bounds: SelectionBounds;
}
export type GestureCompletion = { kind: 'marquee'; bounds: SelectionBounds; policy: SelectionPolicy }
  | { kind: 'tap'; hit: SelectionHit; policy: SelectionPolicy };

/** Recognition in screen pixels, shared by mouse, pen and touch. No document or SDK state. */
export class SelectionGestureController {
  readonly contacts = new Set<number>();
  gesture?: SelectionGesture;
  blocked = false;
  constructor(readonly slop = 4, readonly touchSlop = 10) {}
  down(start: GestureStart): SelectionGesture | undefined {
    this.contacts.add(start.pointerId);
    if (this.contacts.size > 1 || this.blocked) { this.cancel(); this.blocked = true; return; }
    const direct = start.pointerType !== 'mouse';
    const kind: GestureKind = start.pointerType === 'touch' ? 'pan'
      : start.moveHandle ? 'move' : start.pan ? 'native'
      : direct ? (start.tool === 'select' ? 'marquee' : 'pan')
      : start.ctrl && !start.meta ? 'marquee'
      : start.shift && !start.meta ? 'blocked'
      : start.hit?.nodeId && !start.meta && !start.alt ? 'node' : 'native';
    return this.gesture = { start, kind, policy: direct ? (start.add ? 'add' : 'replace') : 'add',
      moved: false, bounds: { left: start.x, right: start.x, top: start.y, bottom: start.y } };
  }
  move(point: GesturePoint) {
    const gesture = this.gesture;
    if (!gesture || point.pointerId !== gesture.start.pointerId) return;
    gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > (gesture.start.pointerType === 'touch' ? this.touchSlop : this.slop);
    gesture.bounds = { left: Math.min(point.x, gesture.start.x), right: Math.max(point.x, gesture.start.x),
      top: Math.min(point.y, gesture.start.y), bottom: Math.max(point.y, gesture.start.y) };
    return gesture;
  }
  up(point: GesturePoint): GestureCompletion | undefined {
    const gesture = this.move(point);
    this.contacts.delete(point.pointerId);
    if (!this.contacts.size) this.blocked = false;
    if (!gesture) return;
    this.gesture = undefined;
    if (gesture.start.pointerType === 'touch') return;
    if (gesture.kind === 'marquee' && gesture.moved) return { kind: 'marquee', bounds: gesture.bounds, policy: gesture.policy };
    if (gesture.moved || ['native', 'move', 'blocked'].includes(gesture.kind)) return;
    if (gesture.start.pointerType === 'mouse' && gesture.kind !== 'node') return;
    if (gesture.start.hit) return { kind: 'tap', hit: gesture.start.hit, policy: gesture.policy };
  }
  /** Keep the multi-contact latch until every contact has left, including after cancellation. */
  cancel() { this.gesture = undefined; }
  reset() { this.cancel(); this.contacts.clear(); this.blocked = false; }
}

/** A DOM release is earlier than native pointer-up/pinch settlement. Ownership
 * remains latched until the next intentionally native operation begins. */
export class NativeSelectionOwnership {
  private owner: 'application' | 'native' = 'application';
  claim(owner: 'application' | 'native') { this.owner = owner; }
  get captureSelection() { return this.owner === 'native'; }
}
