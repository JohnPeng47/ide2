src/mapping/components/MappingPocPage.tsx:41-182
```typescript
export function MappingPocPage(props: { onStudio: () => void; onExperiments: () => void;
  registerNavigationGuard?: (guard: (() => boolean) | undefined) => void }) {
  const [snapshot, setSnapshot] = useState<ProjectRepresentationsSnapshot>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [activeId, setActiveId] = useState<string>();
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("New diagram");
  const [newAscii, setNewAscii] = useState("[New diagram]");
  const [copyCurrent, setCopyCurrent] = useState(false);
  const active = activeId ? drafts[activeId] : undefined;
  const diagrams = Object.values(snapshot?.catalog?.representations ?? {}).filter((diagram) => diagram.status === "settled");

  const open = (id: string, data = snapshot, navigate = true) => {
    const representation = data?.catalog?.representations[id];
    const revision = representation && data?.catalog?.revisions[representation.currentRevisionId];
    if (!representation || representation.status !== "settled" || !revision) { setError("Project diagram was not found"); return; }
    const document = mappingDocumentFromScene(sceneFromRevision(revision), revision.evidence);
    setDrafts((current) => current[id] ? current : { ...current, [id]: { name: representation.name,
      document, savedScene: JSON.stringify(document.scene), savedName: representation.name, revisionId: revision.id, busy: false } });
    setActiveId(id);
    if (navigate) {
      const url = new URL(location.href); url.searchParams.set("diagram", id);
      history.pushState({}, "", url);
    }
    setError("");
  };

  useEffect(() => {
    let cancelled = false;
    loadProjectRepresentations().then((data) => {
      if (cancelled) return;
      setSnapshot(data);
      const id = new URL(location.href).searchParams.get("diagram")
        ?? Object.values(data.catalog?.representations ?? {}).find((diagram) => diagram.status === "settled")?.id;
      if (id) open(id, data, false);
    }).catch((error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const back = () => { const id = new URL(location.href).searchParams.get("diagram"); if (id) open(id, snapshot, false); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, [snapshot]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (Object.values(drafts).some((draft) => dirty(draft) || draft.busy)) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);
  useEffect(() => {
    props.registerNavigationGuard?.(() => !Object.values(drafts).some((draft) => dirty(draft) || draft.busy)
      || window.confirm("Leave Mapping and discard unsaved changes and pending edits?"));
    return () => props.registerNavigationGuard?.(undefined);
  }, [drafts, activeId, props.registerNavigationGuard]);

  const save = async () => {
    if (!activeId || !active || active.busy || savingId) return;
    const id = activeId;
    const captured = active;
    setSavingId(id); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, representationId: id,
        expectedRevisionId: captured.revisionId, name: captured.name, scene: captured.document.scene });
      setSnapshot(result);
      setDrafts((current) => ({ ...current, [id]: { ...current[id], savedName: captured.name.trim(),
        name: current[id].name === captured.name ? captured.name.trim() : current[id].name,
        savedScene: JSON.stringify(captured.document.scene), revisionId: result.representation.currentRevisionId } }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save diagram"); }
    finally { setSavingId(undefined); }
  };
  const create = async () => {
    if (savingId || (copyCurrent && active?.busy)) return;
    setSavingId("new"); setError("");
    try {
      const result = await saveMappingProjectDiagram({ projectId: snapshot?.project?.id, name: newName,
        ...(copyCurrent && active ? { sourceRevisionId: active.revisionId, scene: active.document.scene } : { scene: singleDiagramScene(newAscii) }) });
      setSnapshot(result); setCreating(false); open(result.representation.id, result);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create diagram"); }
    finally { setSavingId(undefined); }
  };

  return <UiTestFramework id="mapping-local-chat" title="Local chat variants" controls={LOCAL_CHAT_UI_CONTROLS}>
    {(ui) => <main className="mapping-poc-shell" data-local-chat-variant={ui.variant}>
      <header className="studio-header mapping-poc-header">
        <MappingSubmenu projectName={snapshot?.project?.name ?? "Project"} name={active?.name ?? ""}
          status={savingId ? "Saving…" : active?.busy ? "Editing…" : active ? dirty(active) ? "Unsaved changes" : "Saved" : ""}
          canSave={Boolean(active?.name.trim() && active && dirty(active) && !active.busy && !savingId)}
          onNameChange={(name) => { if (activeId) setDrafts((current) => ({ ...current, [activeId]: { ...current[activeId], name } })); }}
          onNew={() => { setCopyCurrent(false); setCreating(true); }} onSave={() => void save()} />
        <nav className="screen-tabs" aria-label="Application pages">
          <button type="button" onClick={props.onStudio}>STUDIO</button>
          <button type="button" onClick={props.onExperiments}>EXPERIMENTS</button>
          <button type="button" className="is-active" aria-current="page">MAPPING</button>
        </nav>
      </header>
      <section className="mapping-poc-workspace">
        <div className="mapping-viewport">
          {Object.entries(drafts).map(([id, draft]) => <div key={id} className="mapping-document-view" hidden={id !== activeId}>
            <DraggableDiagramCanvas className="mapping-poc-canvas" enabled resetKey={id} leftInset={340} focusBox={draft.focusBox}>
              <MappingPocSelectionCanvas initialDocument={draft.document} active={id === activeId && !creating} focusBox={draft.focusBox}
                projectContext={{ projectId: snapshot!.project!.id, representationId: id, baseRevisionId: draft.revisionId }}
                projectionCatalog={snapshot?.catalog ?? undefined} savedScene={draft.savedScene}
                dirtyRepresentationIds={Object.keys(drafts).filter((key) => JSON.stringify(drafts[key].document.scene) !== drafts[key].savedScene)}
                onDocumentChange={(document) => setDrafts((current) => current[id].document === document ? current : { ...current, [id]: { ...current[id], document } })}
                onBusyChange={(busy) => setDrafts((current) => current[id].busy === busy ? current : { ...current, [id]: { ...current[id], busy } })}
                localChatVariant={ui.variant as LocalChatVariant} />
            </DraggableDiagramCanvas>
          </div>)}
          {!active && <div className="mapping-empty"><h1>{snapshot ? "Create a project diagram" : error ? "Could not load project diagrams" : "Loading project diagrams…"}</h1>
            {snapshot && <button type="button" onClick={() => setCreating(true)}>New diagram</button>}</div>}
          <FloatingPane><MappingDiagramExplorer projectName={snapshot?.project?.name ?? "Project"} diagrams={diagrams}
            activeId={activeId} scene={active?.document.scene} dirtyIds={Object.keys(drafts).filter((id) => dirty(drafts[id]))}
            onOpen={(id) => open(id)} onFocus={(id) => { if (activeId) setDrafts((current) => ({ ...current,
              [activeId]: { ...current[activeId], focusBox: { id, serial: (current[activeId].focusBox?.serial ?? 0) + 1 } } })); }} /></FloatingPane>
          {error && <div className="mapping-project-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></div>}
        </div>
        <footer className="mapping-poc-status"><span>{active?.name ?? "PROJECT DIAGRAMS"}</span>
          <span>select text to generate a sub-diagram · N opens call tree · P patches · A asks locally</span></footer>
      </section>
      {creating && <div className="mapping-dialog-backdrop"><form className="mapping-create-dialog" role="dialog" aria-modal="true" aria-label="New project diagram"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !savingId) { event.preventDefault(); setCreating(false); setError(""); }
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled), textarea:not(:disabled), button:not(:disabled)"));
          const next = event.shiftKey ? controls.at(-1) : controls[0];
          if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); next?.focus(); }
        }}
        onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <h2>New project diagram</h2>
        <label>Name<input autoFocus aria-label="New diagram name" value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} /></label>
        {active && <label><input type="checkbox" checked={copyCurrent} onChange={(event) => setCopyCurrent(event.target.checked)} />Start from current diagram</label>}
        {!copyCurrent && <label>ASCII content<textarea aria-label="Initial diagram content" value={newAscii} onChange={(event) => setNewAscii(event.target.value)} rows={8} maxLength={20000} /></label>}
        <p>Start from a mapped diagram to keep its source evidence for select → prompt.</p>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" disabled={Boolean(savingId)} onClick={() => { setCreating(false); setError(""); }}>Cancel</button>
          <button type="submit" disabled={Boolean(savingId) || !newName.trim() || (!copyCurrent && !newAscii.trim()) || (copyCurrent && active?.busy)}>Create diagram</button></footer>
      </form></div>}
    </main>}
  </UiTestFramework>;
}
```

src/mapping/components/MappingSubmenu.tsx:1-12
```typescript
export function MappingSubmenu(props: {
  projectName: string; name: string; status: string; canSave: boolean;
  onNameChange: (name: string) => void; onNew: () => void; onSave: () => void;
}) {
  return <div className="mapping-submenu" aria-label="Mapping submenu">
    <div><span>{props.projectName}</span><input aria-label="Diagram name" value={props.name}
      placeholder="Project diagrams" maxLength={120} onChange={(event) => props.onNameChange(event.target.value)} /></div>
    <button type="button" onClick={props.onNew}>New</button>
    <button type="button" onClick={props.onSave} disabled={!props.canSave}>Save</button>
    <small role="status">{props.status}</small>
  </div>;
}
```

src/core/components/DraggableDiagramCanvas.tsx:44-299
```typescript
export function DraggableDiagramCanvas(props: {
  children: ReactNode;
  enabled: boolean;
  resetKey: string;
  className?: string;
  leftInset?: number;
  focusBox?: { id: string; serial: number };
}) {
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
    const frame = requestAnimationFrame(() => resetCanvas(false));
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
      title={props.enabled ? "Drag to pan · Ctrl/Cmd-wheel to zoom · Shift-drag to select text" : undefined}
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
```

src/core/lineGrid.ts:15-24
```typescript
export type GridBox = {
  id: string;
  position: GridPoint;
  minimumSize?: GridSize;
  collapsed: boolean;
  collapsedContentId?: string;
} & (
  | { kind: "diagram"; contentId: string }
  | { kind: "container"; children: readonly GridBox[]; layout: { collisionPolicy: "push-right"; gap: number } }
);
```

src/core/lineGrid.ts:61-100
```typescript
export function resolveScene(scene: LineGridScene): ResolvedGridBox {
  const ids = new Set<string>();
  function visit(box: GridBox, parent: GridPoint): ResolvedGridBox {
    if (ids.has(box.id)) throw new Error(`Duplicate GridBox id: ${box.id}`);
    ids.add(box.id);
    integer(box.position.column, "column");
    integer(box.position.row, "row");
    if (box.minimumSize) {
      integer(box.minimumSize.columns, "columns");
      integer(box.minimumSize.rows, "rows");
    }
    const origin = { column: parent.column + box.position.column, row: parent.row + box.position.row };
    integer(origin.column, "absolute column");
    integer(origin.row, "absolute row");
    if (box.kind === "container") integer(box.layout.gap, "gap");
    const contentId = box.collapsed ? box.collapsedContentId : box.kind === "diagram" ? box.contentId : undefined;
    if (box.collapsed && !contentId) throw new Error(`Collapsed box ${box.id} needs collapsed content`);
    let size: GridSize = { columns: 1, rows: 1 };
    if (contentId) {
      const content = scene.contents[contentId];
      if (!content) throw new Error(`Missing grid content: ${contentId}`);
      size = measureContent(content.ascii);
    }
    const children = box.kind === "container" && !box.collapsed
      ? box.children.map((child) => visit(child, origin)) : [];
    for (const child of children) {
      size.columns = Math.max(size.columns, child.bounds.column - origin.column + child.bounds.columns);
      size.rows = Math.max(size.rows, child.bounds.row - origin.row + child.bounds.rows);
    }
    // Reserved expanded space does not keep a collapsed box large.
    if (!box.collapsed && box.minimumSize) {
      size.columns = Math.max(size.columns, box.minimumSize.columns);
      size.rows = Math.max(size.rows, box.minimumSize.rows);
    }
    integer(origin.column + size.columns, "right edge");
    integer(origin.row + size.rows, "bottom edge");
    return { box, bounds: { ...origin, ...size }, contentId, children };
  }
  return visit(scene.root, { column: 0, row: 0 });
}
```

src/mapping/components/MappingPocSelectionCanvas.tsx:401-428
```typescript
  const finishSelection = (event: PointerEvent<HTMLDivElement>) => {
    const active = activeSelectionRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const focus = pointAtClient(event.clientX, event.clientY) ?? active.anchor;
    const rect = normalizeRect(active.anchor, focus);
    const selected = nodes.filter((node) => (
      node.head.line >= rect.startLine
      && node.head.line <= rect.endLine
      && node.head.startColumn <= rect.endColumn
      && node.head.endColumn >= rect.startColumn
    ));
    activeSelectionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setOpenedProjection(null);
    setPromptOpen(false);
    setPromptText("");
    setAskOpen(false);
    setAskText("");
    setPromptPhase("ready");
    const sourceRangeCount = selected.reduce((count, node) => count + node.sourceRanges.length, 0);
    setStatusMessage(`${sourceRangeCount} mapped corpus range${sourceRangeCount === 1 ? "" : "s"} ready`);
    setSelectedNodeIds(selected.map((node) => node.id));
    setSelectionRect(selected.length ? rect : null);
  };
```

src/mapping/components/MappingPocSelectionCanvas.tsx:552-589
```typescript
  const submitPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectionRect || !promptText.trim() || promptPhase === "generating") return;
    if (promptOperation === "generate") {
      setDiagramPlacement(promptText.trim());
      setPromptOpen(false);
      setStatusMessage("Drag a region on the canvas for the new diagram; Escape cancels");
      return;
    }
    setPromptPhase("generating");
    setStatusMessage("starting diagram agent…");
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`,
        diagramAscii: ascii, diagramRevision, mappings: [...content.mappings],
        selection: selectionRect, instruction: promptText.trim()
      }, (message) => setStatusMessage(message));
      const nextContent = { ...content, ascii: result.diagramAscii, revision: result.diagramRevision,
        mappings: result.mappings ?? [] };
      const nextScene = layoutScene({ ...scene, contents: { ...scene.contents, [content.id]: nextContent } }, activeBox.box.id);
      commit(gridDocument.evidence ? mappingDocumentFromScene(nextScene, gridDocument.evidence)
        : { ...gridDocument, scene: nextScene, nodes: { ...gridDocument.nodes, [content.id]: nodesAfterPatch(nodes, result) },
          sections: { ...gridDocument.sections, [content.id]: sectionsAfterPatch(sections, result) } });
      setOpenDetailOverlayId(null);
      setOpenedProjection(null);
      setSelectedNodeIds([]);
      setSelectionRect({ startLine: result.startLine, endLine: result.newEndLine,
        startColumn: selectionRect.startColumn, endColumn: selectionRect.endColumn });
      setPromptOpen(false);
      setPromptText("");
      setPromptPhase("applied");
      setStatusMessage(`patch applied · ${result.verticalDelta >= 0 ? "+" : ""}${result.verticalDelta} rows · revision ${result.diagramRevision}`);
    } catch (error) {
      setPromptPhase("error");
      setStatusMessage(error instanceof Error ? error.message : "diagram prompt failed");
    }
  };
```

src/mapping/components/MappingPocSelectionCanvas.tsx:591-624
```typescript
  const generateAt = async (start: ScenePoint, end: ScenePoint) => {
    if (!diagramPlacement || !selectionRect) return;
    const column = Math.min(start.column, end.column);
    const row = Math.min(start.row, end.row);
    const minimumSize = { columns: Math.abs(end.column - start.column) + 1, rows: Math.abs(end.row - start.row) + 1 };
    const parent = boxes.find((node) => node.children.some((child) => child.box.id === activeBox.box.id)) ?? resolved;
    // An area outside the source container belongs to the root canvas.
    const targetParent = column >= parent.bounds.column && row >= parent.bounds.row ? parent : resolved;
    setDiagramPlacement(null);
    setPlacementPreview(null);
    setPromptPhase("generating");
    setStatusMessage("generating sub-diagram…");
    try {
      const result = await promptMappingPocSelection({
        ...props.projectContext,
        clientSessionId: `${clientSessionId}-${crypto.randomUUID()}`, operation: "generate",
        diagramAscii: ascii, diagramRevision, mappings: [...content.mappings], selection: selectionRect,
        instruction: `${diagramPlacement}\nAim for ${minimumSize.columns} columns by ${minimumSize.rows} rows; the canvas can grow if needed.`
      }, setStatusMessage);
      const id = `diagram-${crypto.randomUUID()}`;
      const next = insertGridDiagram(gridDocument, targetParent.box.id, {
        id, kind: "diagram", contentId: id, collapsed: false, minimumSize,
        position: { column: column - targetParent.bounds.column, row: row - targetParent.bounds.row }
      }, { id, ascii: result.diagramAscii, revision: result.diagramRevision, mappings: result.mappings ?? [] });
      commit(next);
      clearSelection();
      setActiveBoxId(id);
      setPromptPhase("applied");
      setStatusMessage("Sub-diagram generated; layout updated");
    } catch (error) {
      setPromptPhase("error");
      setStatusMessage(error instanceof Error ? error.message : "Sub-diagram generation failed");
    }
  };
```

src/mapping/components/MappingPocSelectionCanvas.tsx:1186-1245
```typescript
        <aside
          className="mapping-poc-companion"
          data-mapping-static-ui
          data-diagram-canvas-static-ui
          data-b-start-line={openedProjection.alignedBRange?.startLine}
          data-b-end-line={openedProjection.alignedBRange?.endLine}
          data-mapped-b-start-line={openedProjection.mappedBRange?.startLine}
          data-mapped-b-end-line={openedProjection.mappedBRange?.endLine}
          data-aligned-section-ids={openedProjection.alignedSectionIds.join(" ")}
          data-b-node-ids={openedProjection.selectedBNodeIds.join(" ")}
          data-projection-id={props.projectContext ? chosenProjection?.id : undefined}
          style={{
            left: `calc(100% + ${SIDE_GUTTER_PX}px)`,
            top: (firstSelectedANode.head.line - 1) * cell.height
          }}
        >
          <header className="mapping-poc-companion-controls">
            <span>{compactionOpen ? "COMPACTED SOURCE" : props.projectContext ? callTreeProjection.title ?? "CALL TREE" : "B_SELECTED"}</span>
            <span className="mapping-poc-companion-meta">
              <strong>
                {compactionOpen ? `${selectedCompactions.length} files · ${selectedCompactions.reduce((sum, file) => sum + file.selectedLineCount, 0)} mapped rows`
                  : props.projectContext ? `${callTreeProjection.result?.matchedSourceEvidenceIds.length ?? 0}/${selectedEvidenceIds.length} entities linked · ${openedProjection.directlyMappedBNodeIds.length} branches` : <>mapped {openedProjection.mappedBRange?.startLine}–{openedProjection.mappedBRange?.endLine}
                {" · "}aligned {openedProjection.alignedBRange?.startLine}–{openedProjection.alignedBRange?.endLine}
                {" · "}{openedProjection.alignedSectionIds.length} sections</>}
              </strong>
              {props.projectContext && <button type="button" className="mapping-compaction-action"
                aria-label={compactionOpen ? "Back to call tree" : "Open compaction"}
                disabled={!compactionOpen && !selectedCompactions.length}
                title={!selectedCompactions.length ? "No compaction projection is mapped for these branches" : "Show mapped compaction rows grouped by source file"}
                onClick={() => setCompactionOpen((open) => !open)}>
                {compactionOpen ? "Back to call tree" : "Open compaction"}
              </button>}
              {compactionOpen && sourceFile && <button type="button" className="mapping-compaction-action"
                aria-label="Return to source file" onClick={() => setSourceVisible(true)}>Source file →</button>}
              <button
                type="button"
                aria-label="Close call tree"
                title="Close call tree"
                onClick={() => setOpenedProjection(null)}
              >×</button>
            </span>
          </header>
          {compactionOpen ? <div data-projected-compactions>
            {selectedCompactions.map((file) => <section key={file.sourceFile} data-compaction-file={file.sourceFile}
              data-compaction-rows={file.rows.filter((row) => row.selected).map((row) => row.treeLine).join(" ")}>
              <header className="mapping-compaction-file"><span>{file.sourceFile}</span>
                <button type="button" aria-label={`Open source ${file.sourceFile}`} onClick={() => openSource(file.sourceFile)}>Open source ↗</button>
                <small>{file.selectedLineCount} mapped rows · source snapshot {file.sourceSha256.slice(0, 8)}</small>
              </header>
              <pre>{file.ascii}</pre>
            </section>)}
          </div> : <pre data-projected-tree>{openedProjection.bAscii}</pre>}
          {compactionOpen && sourceFile && props.projectContext && selectedCompactions.some((file) => file.sourceFile === sourceFile) &&
            <div ref={sourceStackRef} className="mapping-source-stack" hidden={!sourceVisible}>
              <ProjectedSourcePane key={sourceFile} projectId={props.projectContext.projectId} files={selectedCompactions}
                file={selectedCompactions.find((file) => file.sourceFile === sourceFile)!} onFileChange={openSource}
                onBack={() => setSourceVisible(false)} onCallTree={() => setCompactionOpen(false)} />
            </div>}

        </aside>
```

src/core/diagramProjection.ts:159-225
```typescript
export function projectSelection(
  projection: ProjectProjectionRecord,
  targetRevision: ProjectRepresentationRevisionRecord,
  selectedEvidenceIds: readonly string[]
): ProjectionSelectionResult {
  validateShape(projection);
  ids(selectedEvidenceIds, "selectedEvidenceIds", false);
  record(targetRevision, "target revision");
  if (targetRevision.id !== projection.targetRevisionId
    || targetRevision.representationId !== projection.targetRepresentationId
    || targetRevision.projectId !== projection.projectId) {
    throw new Error("projection target revision does not match its pinned revision");
  }
  const tree = buildProjectionTree(targetRevision);
  const selected = [...new Set(selectedEvidenceIds)];
  const selectedSet = new Set(selected);
  const matched = new Set<string>();
  const targets = new Set<string>();
  for (const link of projection.links) {
    for (const nodeId of link.targetNodeIds) {
      if (!Object.hasOwn(tree.nodes, nodeId)) throw new Error(`unknown target node: ${nodeId}`);
    }
    const matches = link.sourceEvidenceIds.filter((evidenceId) => selectedSet.has(evidenceId));
    if (!matches.length) continue;
    matches.forEach((evidenceId) => matched.add(evidenceId));
    link.targetNodeIds.forEach((nodeId) => targets.add(nodeId));
  }
  const visible = new Set<string>();
  const pending = [...targets];
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (visible.has(nodeId)) continue;
    visible.add(nodeId);
    pending.push(...tree.nodes[nodeId].childIds);
  }
  const projected = new Set(visible);
  for (const nodeId of targets) {
    let parentId = tree.nodes[nodeId].parentId;
    while (parentId) {
      visible.add(parentId);
      parentId = tree.nodes[parentId].parentId;
    }
  }
  const lines: string[] = [];
  const rows: ProjectionSelectionResult["rows"] = [];
  const render = (nodeId: string, prefix: string, connector: string, childPrefix: string): void => {
    const node = tree.nodes[nodeId];
    lines.push(prefix + connector + node.text);
    rows.push({ nodeId, sourceLine: node.line });
    const children = node.childIds.filter((childId) => visible.has(childId));
    children.forEach((childId, index) => {
      const last = index === children.length - 1;
      render(childId, childPrefix, last ? "\\-- " : "+-- ", childPrefix + (last ? "    " : "|   "));
    });
  };
  tree.rootIds.filter((nodeId) => visible.has(nodeId)).forEach((nodeId) => render(nodeId, "", "", ""));
  const ordered = Object.values(tree.nodes).sort((left, right) => left.order - right.order);
  return {
    ascii: lines.join("\n"),
    matchedSourceEvidenceIds: selected.filter((evidenceId) => matched.has(evidenceId)),
    unmatchedSourceEvidenceIds: selected.filter((evidenceId) => !matched.has(evidenceId)),
    targetNodeIds: ordered.filter((node) => targets.has(node.id)).map((node) => node.id),
    visibleNodeIds: ordered.filter((node) => visible.has(node.id)).map((node) => node.id),
    projectedNodeIds: ordered.filter((node) => projected.has(node.id)).map((node) => node.id),
    rows
  };
}
```

src/core/compactionProjection.ts:62-99
```typescript
export function projectCompactions(projection: CompactionProjection, callTreeNodeIds: readonly string[]) {
  const selected = new Set(callTreeNodeIds);
  const selections = new Map<string, Set<number>>();
  for (const link of projection.links) {
    if (!selected.has(link.callTreeNodeId)) continue;
    const lines = selections.get(link.file) ?? new Set<number>();
    link.treeLines.forEach((line) => lines.add(line));
    selections.set(link.file, lines);
  }
  return projection.files.flatMap((file) => {
    const selectedLines = selections.get(file.sourceFile);
    if (!selectedLines?.size) return [];
    const tree = index(file);
    const visible = new Set<string>();
    for (const node of Object.values(tree.nodes)) {
      if (!selectedLines.has(node.line)) continue;
      visible.add(node.id);
      let parent = node.parentId;
      while (parent) { visible.add(parent); parent = tree.nodes[parent].parentId; }
    }
    const lines: string[] = [];
    const rows: { treeLine: number; selected: boolean; sourceRanges: CompactionSnapshot["mappings"][number]["sourceRanges"] }[] = [];
    const mappings = new Map(file.mappings.map((mapping) => [mapping.treeLine, mapping.sourceRanges]));
    const render = (id: string, prefix: string, connector: string, childPrefix: string) => {
      const node = tree.nodes[id];
      lines.push(prefix + connector + node.text);
      rows.push({ treeLine: node.line, selected: selectedLines.has(node.line), sourceRanges: mappings.get(node.line)! });
      const children = node.childIds.filter((id) => visible.has(id));
      children.forEach((id, i) => {
        const last = i === children.length - 1;
        render(id, childPrefix, last ? "\\-- " : "+-- ", childPrefix + (last ? "    " : "|   "));
      });
    };
    tree.rootIds.filter((id) => visible.has(id)).forEach((id) => render(id, "", "", ""));
    return [{ sourceFile: file.sourceFile, sourceSha256: file.sourceSha256, ascii: lines.join("\n"), rows,
      selectedLineCount: selectedLines.size }];
  });
}
```

src/mapping/components/LocalChatConvo.tsx:17-108
```typescript
export function LocalChatConvo(props: {
  thread: LocalChatThread;
  variant: LocalChatVariant;
  onSubmit: (message: string) => void;
  onClose: () => void;
  onVerbosityChange: (value: LocalChatVerbosity) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const scrollToLatest = useCallback(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [props.thread.messages, props.thread.pending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || props.thread.pending) return;
    props.onSubmit(message);
    setDraft("");
  };

  return (
    <section
      className={`local-chat-convo is-${props.variant}`}
      data-local-chat-convo={props.variant}
      aria-label={`Local conversation about ${props.thread.title}`}
    >
      <header>
        <div>
          <span>LOCAL CHAT</span>
          <strong>{props.thread.title}</strong>
        </div>
        <button type="button" aria-label="Collapse local conversation" onClick={props.onClose}>×</button>
      </header>

      <div ref={transcriptRef} className="local-chat-transcript" role="log" aria-live="polite">
        {props.thread.messages.map((message) => (
          <article key={message.id} className={`is-${message.role}`} data-local-chat-role={message.role}>
            <span>{message.role === "user" ? "YOU" : "AI"}</span>
            {message.role === "assistant"
              ? <TerminalMarkdownContent source={message.text} className="local-chat-markdown" onRendered={scrollToLatest} />
              : <p>{message.text}</p>}
          </article>
        ))}
        {props.thread.pending ? (
          <article className="is-assistant is-pending" data-local-chat-pending="true">
            <span>AI</span>
            <p>{props.thread.progress ?? "Thinking…"}</p>
          </article>
        ) : null}
      </div>

      {props.thread.error && <div className="local-chat-error" role="alert">
        <p>{props.thread.error}</p>
        <button type="button" onClick={props.onRetry} disabled={props.thread.pending}>Retry</button>
      </div>}
      <LocalChatVerbosityToggle value={props.thread.verbosity} disabled={props.thread.pending} onChange={props.onVerbosityChange} />
      <form onSubmit={submit}>
        <label>
          <span>Follow up</span>
          <textarea
            value={draft}
            rows={2}
            maxLength={4000}
            disabled={props.thread.pending}
            placeholder="Ask about this region…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (!isLocalChatSubmitHotkey({
                key: event.key,
                ctrlKey: event.ctrlKey,
                isComposing: event.nativeEvent.isComposing
              })) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
        </label>
        <button type="submit" disabled={!draft.trim() || props.thread.pending} title="Send (Ctrl+Enter)">
          {props.thread.pending ? "waiting…" : "send"}
        </button>
      </form>
    </section>
  );
}
```

src/mapping/components/MappingDiagramExplorer.tsx:4-31
```typescript
export function MappingDiagramExplorer(props: {
  projectName: string; diagrams: ProjectRepresentationRecord[]; activeId?: string;
  scene?: LineGridScene; dirtyIds: string[]; onOpen: (id: string) => void; onFocus: (boxId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const boxTree = (box: GridBox) => <li key={box.id}>
    <button type="button" onClick={() => props.onFocus(box.id)} data-explorer-box={box.id}>
      {box.kind === "container" ? "▸ " : "· "}{box.kind === "diagram"
        ? props.scene?.contents[box.contentId]?.ascii.split("\n")[0].slice(0, 60) || box.id : "Group"}
    </button>
    {box.kind === "container" && <ul>{box.children.map(boxTree)}</ul>}
  </li>;
  return <>
    <header><strong>{props.projectName}</strong><span>PROJECT DIAGRAMS</span></header>
    <input type="search" aria-label="Filter diagrams" placeholder="Find a diagram…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <nav aria-label="Project diagrams"><ul>{props.diagrams.filter((diagram) => diagram.name.toLowerCase().includes(query.toLowerCase())).map((diagram) =>
      <li key={diagram.id}>
        <button type="button" className={diagram.id === props.activeId ? "is-active" : ""}
          aria-current={diagram.id === props.activeId ? "page" : undefined} data-project-diagram={diagram.id} onClick={() => props.onOpen(diagram.id)}>
          {diagram.name}{props.dirtyIds.includes(diagram.id) ? " *" : ""}
        </button>
        {diagram.id === props.activeId && props.scene && <ul>{props.scene.root.kind === "container"
          ? props.scene.root.children.map(boxTree) : boxTree(props.scene.root)}</ul>}
      </li>
    )}</ul></nav>
    {!props.diagrams.length && <p>No project diagrams yet. Create one with New.</p>}
  </>;
}
```
