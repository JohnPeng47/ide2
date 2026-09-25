export const MIN_DIAGRAM_CANVAS_SCALE = 0.25;
export const MAX_DIAGRAM_CANVAS_SCALE = 4;

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasTransform {
  offset: CanvasPoint;
  scale: number;
}

export interface CanvasPinchGeometry {
  center: CanvasPoint;
  distance: number;
}

export interface CanvasPinch {
  startDistance: number;
  startScale: number;
  contentPoint: CanvasPoint;
}

export function clampDiagramCanvasScale(scale: number): number {
  return Math.min(MAX_DIAGRAM_CANVAS_SCALE, Math.max(MIN_DIAGRAM_CANVAS_SCALE, scale));
}

export function scaleCanvasTransform(
  transform: CanvasTransform,
  requestedScale: number,
  anchor: CanvasPoint
): CanvasTransform {
  const scale = clampDiagramCanvasScale(requestedScale);
  const ratio = scale / transform.scale;
  return {
    offset: {
      x: anchor.x - ratio * (anchor.x - transform.offset.x),
      y: anchor.y - ratio * (anchor.y - transform.offset.y)
    },
    scale
  };
}

export function canvasPinchGeometry(
  first: CanvasPoint,
  second: CanvasPoint
): CanvasPinchGeometry | null {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return null;
  return {
    center: {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2
    },
    distance
  };
}

export function beginCanvasPinch(
  transform: CanvasTransform,
  geometry: CanvasPinchGeometry
): CanvasPinch {
  return {
    startDistance: geometry.distance,
    startScale: transform.scale,
    contentPoint: {
      x: (geometry.center.x - transform.offset.x) / transform.scale,
      y: (geometry.center.y - transform.offset.y) / transform.scale
    }
  };
}

export function updateCanvasPinch(
  pinch: CanvasPinch,
  geometry: CanvasPinchGeometry
): CanvasTransform {
  const scale = clampDiagramCanvasScale(
    pinch.startScale * (geometry.distance / pinch.startDistance)
  );
  return {
    offset: {
      x: geometry.center.x - pinch.contentPoint.x * scale,
      y: geometry.center.y - pinch.contentPoint.y * scale
    },
    scale
  };
}

export function centeredCanvasTransform(
  viewport: { width: number; height: number },
  content: { width: number; height: number },
  inset = 32
): CanvasTransform {
  return {
    offset: {
      x: content.width + inset * 2 <= viewport.width
        ? (viewport.width - content.width) / 2
        : inset,
      y: content.height + inset * 2 <= viewport.height
        ? (viewport.height - content.height) / 2
        : inset
    },
    scale: 1
  };
}

export function recenterCanvasTransform(
  transform: CanvasTransform,
  previousViewport: { width: number; height: number },
  nextViewport: { width: number; height: number }
): CanvasTransform {
  const contentAtCenter = {
    x: (previousViewport.width / 2 - transform.offset.x) / transform.scale,
    y: (previousViewport.height / 2 - transform.offset.y) / transform.scale
  };
  return {
    offset: {
      x: nextViewport.width / 2 - contentAtCenter.x * transform.scale,
      y: nextViewport.height / 2 - contentAtCenter.y * transform.scale
    },
    scale: transform.scale
  };
}
/** A transient navigation request, never part of persisted diagram content. */
export interface DiagramFocus {
  id: string; serial: number; contentNodeId?: string;
  search?: {
    displayNodeId: string; revisionId: string; asciiSha256: string; line: number;
    matches: { startColumn: number; endColumn: number }[];
  };
}
