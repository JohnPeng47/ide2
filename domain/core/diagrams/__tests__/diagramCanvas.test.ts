import { describe, expect, it } from "vitest";
import {
  beginCanvasPinch,
  canvasPinchGeometry,
  centeredCanvasTransform,
  clampDiagramCanvasScale,
  recenterCanvasTransform,
  scaleCanvasTransform,
  updateCanvasPinch
} from "../diagramCanvas";

describe("diagram canvas geometry", () => {
  it("anchors zoom at the pointer and clamps the supported scale", () => {
    expect(scaleCanvasTransform(
      { offset: { x: -50, y: -25 }, scale: 1 },
      2,
      { x: 100, y: 100 }
    )).toEqual({ offset: { x: -200, y: -150 }, scale: 2 });
    expect(clampDiagramCanvasScale(0.01)).toBe(0.25);
    expect(clampDiagramCanvasScale(10)).toBe(4);
  });

  it("keeps the touched content point beneath a moving pinch midpoint", () => {
    const start = canvasPinchGeometry({ x: 50, y: 100 }, { x: 150, y: 100 });
    const next = canvasPinchGeometry({ x: 20, y: 120 }, { x: 220, y: 120 });
    expect(start).not.toBeNull();
    expect(next).not.toBeNull();
    const pinch = beginCanvasPinch(
      { offset: { x: -100, y: -50 }, scale: 1 },
      start!
    );
    expect(updateCanvasPinch(pinch, next!)).toEqual({
      offset: { x: -280, y: -180 },
      scale: 2
    });
  });

  it("centers small diagrams and insets oversized diagrams", () => {
    expect(centeredCanvasTransform(
      { width: 1000, height: 700 },
      { width: 400, height: 300 }
    )).toEqual({ offset: { x: 300, y: 200 }, scale: 1 });
    expect(centeredCanvasTransform(
      { width: 500, height: 300 },
      { width: 800, height: 600 }
    )).toEqual({ offset: { x: 32, y: 32 }, scale: 1 });
  });

  it("preserves the content point at the viewport center across pane resizing", () => {
    expect(recenterCanvasTransform(
      { offset: { x: 100, y: 50 }, scale: 2 },
      { width: 800, height: 600 },
      { width: 1000, height: 500 }
    )).toEqual({ offset: { x: 200, y: 0 }, scale: 2 });
  });
});
