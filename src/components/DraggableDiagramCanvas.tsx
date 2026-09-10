import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import {
  beginCanvasPinch,
  canvasPinchGeometry,
  centeredCanvasTransform,
  recenterCanvasTransform,
  scaleCanvasTransform,
  updateCanvasPinch,
  type CanvasPinch,
  type CanvasPoint,
  type CanvasTransform
} from "../diagramCanvas";

const ZOOM_SENSITIVITY = 0.0015;
const PAN_KEY_STEP = 32;
const ZOOM_KEY_FACTOR = 1.2;
const TRANSITION_MS = 160;

interface ActivePan {
  pointerId: number;
  start: CanvasPoint;
  base: CanvasPoint;
}

function localPoint(element: HTMLElement, clientX: number, clientY: number): CanvasPoint {
  const bounds = element.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "button, a, input, textarea, select, [contenteditable='true'], [data-diagram-canvas-static-ui]"
  ));
}

export function DraggableDiagramCanvas(props: {
  children: ReactNode;
  enabled: boolean;
  resetKey: string;
  className?: string;
  leftInset?: number;
  focusBox?: { id: string; serial: number };
  initialTransform?: CanvasTransform;
  onTransformChange?: (transform: CanvasTransform) => void;
}) {
  const transformChange = useRef(props.onTransformChange); transformChange.current = props.onTransformChange;
  const initialTransform = useRef(props.initialTransform);
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const zoomOutputRef = useRef<HTMLOutputElement>(null);
  const transformRef = useRef<CanvasTransform>({ offset: { x: 0, y: 0 }, scale: 1 });
  const viewportSizeRef = useRef({ width: 0, height: 0 });
  const pointersRef = useRef(new Map<number, CanvasPoint>());
  const panRef = useRef<ActivePan | null>(null);
  const pinchRef = useRef<CanvasPinch | null>(null);

  const applyTransform = useCallback((transform: CanvasTransform, animate = false) => {
    transformRef.current = transform;
    transformChange.current?.(transform);
    const surface = surfaceRef.current;
    if (surface) {
      surface.style.transition = animate ? `transform ${TRANSITION_MS}ms ease` : "none";
      surface.style.transform = `translate3d(${transform.offset.x}px, ${transform.offset.y}px, 0) scale(${transform.scale})`;
    }
    if (zoomOutputRef.current) {
      zoomOutputRef.current.value = `${Math.round(transform.scale * 100)}%`;
      zoomOutputRef.current.textContent = `${Math.round(transform.scale * 100)}%`;
    }
  }, []);

  const endGesture = useCallback(() => {
    panRef.current = null;
    pinchRef.current = null;
    viewportRef.current?.classList.remove("is-dragging");
  }, []);

  const resetCanvas = useCallback((animate = true) => {
    const viewport = viewportRef.current;
    const surface = surfaceRef.current;
    if (!viewport || !surface || !props.enabled) return;
    const viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight };
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;
    viewportSizeRef.current = viewportSize;
    const inset = Math.min(props.leftInset ?? 0, viewportSize.width / 2);
    const centered = centeredCanvasTransform({ ...viewportSize, width: viewportSize.width - inset }, {
      width: surface.offsetWidth,
      height: surface.offsetHeight
    });
    applyTransform({ ...centered, offset: { ...centered.offset, x: centered.offset.x + inset } }, animate);
  }, [applyTransform, props.enabled, props.leftInset]);

  useLayoutEffect(() => {
    pointersRef.current.clear();
    endGesture();
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    if (!props.enabled) {
      surface.style.transition = "none";
      surface.style.transform = "";
      transformRef.current = { offset: { x: 0, y: 0 }, scale: 1 };
      return undefined;
    }
    const frame = requestAnimationFrame(() => initialTransform.current ? applyTransform(initialTransform.current) : resetCanvas(false));
    return () => cancelAnimationFrame(frame);
  }, [endGesture, props.enabled, props.resetKey, resetCanvas]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !props.enabled || typeof ResizeObserver === "undefined") return undefined;
    viewportSizeRef.current = { width: viewport.clientWidth, height: viewport.clientHeight };
    const observer = new ResizeObserver(() => {
      const previous = viewportSizeRef.current;
      const next = { width: viewport.clientWidth, height: viewport.clientHeight };
      // Sidebar navigation hides mounted diagrams. Keep their last visible geometry.
      if (next.width <= 0 || next.height <= 0) return;
      viewportSizeRef.current = next;
      if (previous.width <= 0 || previous.height <= 0
        || (previous.width === next.width && previous.height === next.height)) return;
      applyTransform(recenterCanvasTransform(transformRef.current, previous, next));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyTransform, props.enabled]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !props.enabled) return undefined;
    const onWheel = (event: globalThis.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = localPoint(viewport, event.clientX, event.clientY);
      applyTransform(scaleCanvasTransform(
        transformRef.current,
        transformRef.current.scale * Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
        anchor
      ));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyTransform, props.enabled]);

  useEffect(() => {
    if (!props.focusBox) return;
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => { innerFrame = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const target = Array.from(surfaceRef.current?.querySelectorAll<HTMLElement>("[data-grid-box]") ?? [])
        .find((element) => element.dataset.gridBox === props.focusBox?.id);
      if (!viewport || !target) return;
      const bounds = viewport.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const inset = Math.min(props.leftInset ?? 0, bounds.width / 2);
      const current = transformRef.current;
      applyTransform({ ...current, offset: { x: current.offset.x + (bounds.width + inset) / 2 - (box.left - bounds.left + box.width / 2),
        y: current.offset.y + Math.min(bounds.height / 2, box.height / 2 + 80) - (box.top - bounds.top + box.height / 2) } }, true);
    }); });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(innerFrame); };
  }, [props.focusBox, props.leftInset, applyTransform]);

  const beginPinch = (points: Map<number, CanvasPoint>) => {
    const [first, second] = [...points.values()];
    if (!first || !second) return false;
    const geometry = canvasPinchGeometry(first, second);
    if (!geometry) return false;
    pinchRef.current = beginCanvasPinch(transformRef.current, geometry);
    panRef.current = null;
    return true;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!props.enabled || event.button !== 0 || isInteractiveTarget(event.target)) return;
    if (event.pointerType !== "touch" && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    event.currentTarget.classList.add("is-dragging");
    if (pointersRef.current.size >= 2 && beginPinch(pointersRef.current)) return;
    panRef.current = {
      pointerId: event.pointerId,
      start: point,
      base: { ...transformRef.current.offset }
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    const point = localPoint(event.currentTarget, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const geometry = first && second ? canvasPinchGeometry(first, second) : null;
      if (geometry) applyTransform(updateCanvasPinch(pinchRef.current, geometry));
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    applyTransform({
      offset: {
        x: pan.base.x + point.x - pan.start.x,
        y: pan.base.y + point.y - pan.start.y
      },
      scale: transformRef.current.scale
    });
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (pinchRef.current) {
      pinchRef.current = null;
      const remaining = [...pointersRef.current.entries()][0];
      if (remaining) {
        panRef.current = {
          pointerId: remaining[0],
          start: remaining[1],
          base: { ...transformRef.current.offset }
        };
        return;
      }
    }
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    if (pointersRef.current.size === 0) endGesture();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!props.enabled || event.target !== event.currentTarget) return;
    let next: CanvasTransform | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight"
      || event.key === "ArrowUp" || event.key === "ArrowDown") {
      next = {
        ...transformRef.current,
        offset: {
          x: transformRef.current.offset.x
            + (event.key === "ArrowLeft" ? -PAN_KEY_STEP : event.key === "ArrowRight" ? PAN_KEY_STEP : 0),
          y: transformRef.current.offset.y
            + (event.key === "ArrowUp" ? -PAN_KEY_STEP : event.key === "ArrowDown" ? PAN_KEY_STEP : 0)
        }
      };
    } else if (event.key === "+" || event.key === "=") {
      next = scaleCanvasTransform(
        transformRef.current,
        transformRef.current.scale * ZOOM_KEY_FACTOR,
        { x: event.currentTarget.clientWidth / 2, y: event.currentTarget.clientHeight / 2 }
      );
    } else if (event.key === "-") {
      next = scaleCanvasTransform(
        transformRef.current,
        transformRef.current.scale / ZOOM_KEY_FACTOR,
        { x: event.currentTarget.clientWidth / 2, y: event.currentTarget.clientHeight / 2 }
      );
    } else if (event.key === "0") {
      event.preventDefault();
      resetCanvas();
      return;
    }
    if (!next) return;
    event.preventDefault();
    applyTransform(next);
  };

  return (
    <div
      ref={viewportRef}
      className={`${props.className ?? ""} diagram-canvas${props.enabled ? " is-enabled" : ""}`.trim()}
      data-diagram-canvas
      tabIndex={props.enabled ? 0 : undefined}
      aria-label={props.enabled ? "Draggable diagram canvas" : undefined}
      aria-keyshortcuts={props.enabled ? "ArrowLeft ArrowRight ArrowUp ArrowDown + - 0" : undefined}
      title={props.enabled ? "Drag to pan · Ctrl-drag to select · Ctrl/Cmd-wheel to zoom · Shift-drag to select text" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={onKeyDown}
    >
      <div ref={surfaceRef} className="diagram-canvas__surface">
        {props.children}
      </div>
      {props.enabled ? (
        <div className="diagram-canvas__controls" data-diagram-canvas-static-ui>
          <output ref={zoomOutputRef} aria-label="Diagram zoom">100%</output>
          <button type="button" onClick={() => resetCanvas()} title="Reset zoom and center diagram">
            center
          </button>
        </div>
      ) : null}
    </div>
  );
}
