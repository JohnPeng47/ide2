# Code guidelines

Make decisions, state changes, and assumptions easy to see. Apply these conventions to new and changed code, using judgment about the surrounding implementation. Extract responsibilities when they have a meaningful contract; do not optimize for arbitrary function or file lengths.

These twenty rules combine the original six readability conventions with fourteen additional patterns observed in the installed tldraw 5.4.2 source. They are this project's recommendations, not an official tldraw style guide or a claim that tldraw follows every rule universally. In particular, our recommendations about type assertions and React boundaries are stricter than some of the inspected code.

Examples illustrate the conventions. Domain types and helpers are assumed where their definitions would distract from the example. Source links point to the installed dependency sources and require dependencies to be present.

## 1. Put one statement on each line and expand meaningful control flow

Separate declarations, mutations, and branches. Require braces around branches with side effects. Keep trivial getters concise and let the project's formatter handle whitespace.

```ts
if (!checkpointChanged && editor.inputs.getIsPointing()) {
  this.pendingProjection = true;
  return;
}
```

The state change and early exit should be independently visible. Formatting cannot compensate for an expression that combines too many decisions.

Basis: [PointingShape](../../node_modules/tldraw/src/lib/tools/SelectTool/childStates/PointingShape.ts) generally separates these steps clearly. The braces requirement is our convention.

## 2. Name decisions before acting on them

Give meaningful or repeated predicates a domain name. Prefer `snapshot`, `previousSnapshot`, and `checkpointId` over abbreviated names in methods that coordinate several kinds of state. Short mathematical names remain appropriate for coordinates.

```ts
const checkpointChanged = checkpointId !== this.checkpoint;
const shouldRecordHistory =
  checkpointChanged && record && !this.navigating;
const shouldStartUndoStep =
  shouldRecordHistory && !this.settling;

if (shouldStartUndoStep) {
  editor.markHistoryStoppingPoint('mapping command');
}
```

Keep a predicate local if it only explains one operation. Extract a shared predicate when it represents a shared policy.

Basis: [PointingShape](../../node_modules/tldraw/src/lib/tools/SelectTool/childStates/PointingShape.ts) uses names such as `outermostSelectableShape`, `selectedAncestor`, and `additiveSelectionKey`.

## 3. Make consequential options understandable at the call site

Use named options when arguments represent policies or several optional settings. Avoid positional booleans whose meaning requires opening the function definition.

```ts
runtime.settle({
  force: true,
  captureSelection: false,
});

editor.run(applyChanges, { history: 'ignore' });
```

Straightforward arguments such as an ID or two coordinates do not automatically need an options object.

Basis: tldraw's [history batch options](../../node_modules/@tldraw/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts) make history policy explicit.

## 4. Prefer concrete types and explicit object construction

For a known object shape, construct its fields explicitly. Use unions for closed sets and discriminated unions when variants require different fields. Validate untrusted data at entry points and narrow types within the application.

```ts
const rounded: EndpointRect = {
  x: roundCoordinate(rect.x),
  y: roundCoordinate(rect.y),
  width: roundCoordinate(rect.width),
  height: roundCoordinate(rect.height),
};

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; requestId: string }
  | { status: 'ready'; document: DiagramDocument }
  | { status: 'failed'; error: Error };
```

Treat `as unknown as`, non-null assertions, and `any` as review points requiring a clear justification. Avoid generic object transformations that discard type information only to recover it with a cast.

Basis: tldraw uses typed variants, including [snap indicators](../../node_modules/@tldraw/editor/src/lib/editor/managers/SnapManager/SnapManager.ts). The stricter assertion policy and explicit construction recommendation are ours; tldraw also uses assertions and `any`.

## 5. Extract functions around concepts

An extracted function should have a purpose that can be described and a clear input/output or side-effect contract. Avoid extracting vaguely named helpers merely to shorten the caller.

```ts
const selectedContentIds = getSelectedContentIds(
  diagram,
  selectionRegions,
);

const visiblePanes = panes.filter(pane =>
  isPaneVisible(pane, diagramViews),
);
```

Within a helper, use intermediate variables or loops when they make the algorithm easier to follow. Array-method chains are useful when each step is simple. Do not impose universal function-length limits.

Basis: [PointingShape](../../node_modules/tldraw/src/lib/tools/SelectTool/childStates/PointingShape.ts) expresses operations through helpers such as `getOutermostSelectableShape` and `getPointInShapeSpace`. The extraction criteria are our interpretation of that pattern.

## 6. Keep application decisions behind named operations

React handlers should normally invoke application operations. Repeated or invariant-sensitive mutations belong in a named command or typed update function that owns the related changes.

```tsx
function OpenCodeButton({ selectionId }: { selectionId: SelectionId }) {
  const commands = useCanvasCommands();

  return (
    <button onClick={() => commands.openCodePanel(selectionId)}>
      Open code
    </button>
  );
}
```

The command owns panel creation, retained selection, and focus changes. A component should not reconstruct that operation through several unrelated setters. Use effects for subscriptions, measurement, and external synchronization; calculate ordinary derived values directly.

Basis: tldraw interaction code invokes shared editor operations in [PointingShape](../../node_modules/tldraw/src/lib/tools/SelectTool/childStates/PointingShape.ts). The specific React and effect conventions are our recommendations.

## 7. Handle closed sets exhaustively

When every variant requires a decision, use an exhaustive switch. Adding a variant should expose the places that require new behavior.

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

function canResizePane(pane: Pane): boolean {
  switch (pane.kind) {
    case 'projection':
    case 'detail':
      return true;
    case 'conversation':
    case 'selection':
      return false;
    default:
      return assertNever(pane);
  }
}
```

Avoid a fallback that silently assigns existing behavior to a new variant. This applies particularly to `DiagramOperation` and other closed domain unions.

Basis: [HistoryManager](../../node_modules/@tldraw/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts) handles recording modes with `exhaustiveSwitchError`, whose parameter is `never`.

## 8. Restore temporary state with try/finally

Temporary modes, suppression flags, and reentrancy guards need exception-safe scopes. When nesting is allowed, restore the previous value rather than assuming a default.

```ts
const previousMode = this.mode;
this.mode = 'replaying';

try {
  applyChanges();
} finally {
  this.mode = previousMode;
}
```

If reentry is forbidden, guard it explicitly before entering the scope. State restoration does not imply rollback of changes made inside the scope.

Basis: [HistoryManager](../../node_modules/@tldraw/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts) preserves and restores recording and replay state around batching and navigation.

## 9. Make unchanged results a first-class outcome

Update helpers should return the original object when the requested change has no effect. Preserve references to unchanged branches.

```ts
function setExpanded(pane: Pane, expanded: boolean): Pane {
  if (pane.expanded === expanded) return pane;
  return { ...pane, expanded };
}

const updated = setExpanded(pane, true);
if (updated !== pane) {
  store.put(updated);
}
```

Reference identity can then communicate whether subscribers and caches need to do work. Avoid recreating whole structures and repairing their identities afterward when a focused update can preserve them directly.

Basis: [Editor._updateShapes](../../node_modules/@tldraw/editor/src/lib/editor/Editor.ts) skips records whose update helper returned the original object; [Store.put](../../node_modules/@tldraw/store/src/lib/Store.ts) avoids recording empty changes.

## 10. Collect changes before publishing them

Give multi-object operations recognizable phases: read, calculate, collect, and publish. Avoid scattering writes through traversal unless later steps intentionally depend on those writes.

```ts
const updates: Pane[] = [];

for (const pane of selectedPanes) {
  const updated = calculatePaneLayout(pane, viewport);
  if (updated === pane) continue;
  updates.push(updated);
}

if (updates.length > 0) {
  store.putMany(updates);
}
```

Local mutable arrays and maps are appropriate accumulators. Immutability matters at shared-state boundaries; it does not require rebuilding an accumulator on every iteration. Collecting changes does not itself provide transactionality or rollback.

Basis: [Editor._updateShapes](../../node_modules/@tldraw/editor/src/lib/editor/Editor.ts) collects updated records before passing them to the store.

## 11. Distinguish expected absence from a broken invariant

A missing object may be normal during an interaction. Absence after an operation that guarantees the object's continued existence indicates a programming error.

```ts
function movePanel(panelId: PanelId, position: PagePoint) {
  const panel = store.getPanel(panelId);
  if (!panel) return;

  store.updatePanel(panelId, { position });

  const updatedPanel = store.getPanel(panelId);
  if (!updatedPanel) {
    throw new Error(`Panel disappeared during move: ${panelId}`);
  }

  return updatedPanel;
}
```

Return or skip for expected disappearance, return an explicit outcome for recoverable failure, and assert or throw for broken invariants. Optional chaining should not conceal an invalid internal state. Only assert guarantees the operation actually provides.

Basis: [ArrowBindingUtil](../../node_modules/tldraw/src/lib/bindings/arrow/ArrowBindingUtil.ts) tolerates an initially missing arrow but throws if an arrow unexpectedly disappears after reparenting.

## 12. Register cleanup next to resource acquisition

Every subscription, observer, timer, and owned service needs an identifiable owner and cleanup path. Registration APIs should return an unsubscribe function.

```ts
const cleanups: Array<() => void> = [];

const unsubscribe = store.subscribe(refresh);
cleanups.push(unsubscribe);

const observer = new ResizeObserver(measure);
observer.observe(element);
cleanups.push(() => observer.disconnect());

function dispose() {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
}
```

Choose cleanup order deliberately when resources depend on each other. A reviewer should be able to identify a resource's lifetime without searching another file.

Basis: the [Editor constructor](../../node_modules/@tldraw/editor/src/lib/editor/Editor.ts) registers manager disposal beside construction, and [StoreSideEffects](../../node_modules/@tldraw/store/src/lib/StoreSideEffects.ts) returns cleanup functions from registration methods.

## 13. Converge equivalent events on one lifecycle operation

Different events can express the same intent. Their handlers should invoke shared behavior so completion semantics remain consistent. Model cancellation separately and centralize shared exit cleanup.

```ts
onPointerUp() {
  this.complete();
}

onComplete() {
  this.complete();
}

onCancel() {
  this.restoreInitialPositions();
  this.exit();
}

private complete() {
  this.applyFinalPositions();
  this.commitGesture();
  this.exit();
}
```

The same convention applies to Enter and a submit button, Escape and a cancel button, or toolbar actions and keyboard shortcuts. Lifecycle cleanup must also account for failures where applicable.

Basis: [Translating](../../node_modules/tldraw/src/lib/tools/SelectTool/childStates/Translating.ts) routes pointer release and explicit completion through `complete()`, with cancellation and exit cleanup handled separately.

## 14. Calculate continuous interactions from a captured starting state

Capture initial geometry when dragging or resizing begins. Calculate each frame from that snapshot and current input.

```ts
interface DragSnapshot {
  pointerOrigin: PagePoint;
  initialPosition: PagePoint;
}

function calculatePosition(
  snapshot: DragSnapshot,
  pointer: PagePoint,
): PagePoint {
  const deltaX = pointer.x - snapshot.pointerOrigin.x;
  const deltaY = pointer.y - snapshot.pointerOrigin.y;

  return {
    x: snapshot.initialPosition.x + deltaX,
    y: snapshot.initialPosition.y + deltaY,
  };
}
```

Repeatedly modifying the previous frame's result can accumulate rounding or snapping errors. A stable starting state also supports predictable modifier changes and cancellation. Define how intervening external edits invalidate or rebase that snapshot.

Basis: [Translating.moveShapesToPoint](../../node_modules/tldraw/src/lib/tools/SelectTool/childStates/Translating.ts) combines captured positions with displacement from the pointer origin.

## 15. Give asynchronous results an explicit validity check

A request can finish after its target changes or its owner disappears. Verify that both successful results and errors still belong to the active operation before publishing them.

```ts
useEffect(() => {
  const controller = new AbortController();
  let active = true;

  async function load() {
    try {
      const preview = await loadPreview(documentId, {
        signal: controller.signal,
      });
      if (!active) return;
      setPreview(preview);
    } catch (error) {
      if (!active) return;
      setError(error);
    }
  }

  void load();

  return () => {
    active = false;
    controller.abort();
  };
}, [documentId]);
```

Choose the relevant validity boundary: owner lifetime, request ID, target revision, or generation counter. Overlapping requests within one lifetime need a stronger check than an effect cancellation flag. Cancellation alone may not prevent a result from arriving.

Basis: [useImageOrVideoAsset](../../node_modules/tldraw/src/lib/shapes/shared/useImageOrVideoAsset.ts) checks effect cancellation before publishing a resolved URL and cancels scheduled work during cleanup. Request and revision checks are applications of that principle.

## 16. Separate stable callback identity from fresh callback data

A long-lived subscription may need one stable callback while that callback needs changing props or state. Standardize this behavior in an appropriate helper instead of repeating callback-ref plumbing.

```ts
function useStableHandler<Args extends unknown[]>(
  handler: (...args: Args) => void,
) {
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  return useCallback((...args: Args) => {
    handlerRef.current(...args);
  }, []);
}

const onKeyDown = useStableHandler((event: KeyboardEvent) => {
  if (event.key === 'Delete') {
    deleteItems(selectedIds);
  }
});
```

This particular pattern is for event callbacks. Do not invoke it during rendering or rely on it being refreshed before child layout effects. Keep actual subscription dependencies explicit; a stable callback is not a way to suppress legitimate effect dependencies.

Basis: [useEvent](../../node_modules/@tldraw/editor/src/lib/hooks/useEvent.tsx) supplies a stable callback backed by a current handler, and [usePassThroughWheelEvents](../../node_modules/@tldraw/editor/src/lib/hooks/usePassThroughWheelEvents.ts) uses it for a DOM listener.

## 17. Put coordinate spaces and units in names and conversions

Visually identical numeric values may have incompatible meanings. Name coordinate spaces and units wherever confusion is plausible, and centralize conversion formulas.

```ts
const screenPoint = {
  x: event.clientX,
  y: event.clientY,
};

const pagePoint = editor.screenToPage(screenPoint);
const diagramCell = pagePointToDiagramCell(pagePoint, cellSize);

moveDiagram(diagramId, {
  column: diagramCell.column,
  row: diagramCell.row,
});

const snapRadiusScreenPx = 8;
const snapRadiusPageUnits =
  snapRadiusScreenPx / editor.getZoomLevel();
```

Prefer names such as `screenPoint`, `pageBounds`, `columnIndex`, and `timeoutMs`. Our screen pixels, canvas coordinates, diagram cells, and source positions must remain distinguishable.

Basis: [Editor](../../node_modules/@tldraw/editor/src/lib/editor/Editor.ts) exposes screen/page conversion methods; [SnapManager](../../node_modules/@tldraw/editor/src/lib/editor/managers/SnapManager/SnapManager.ts) converts its threshold using zoom.

## 18. Ask for a capability when the decision concerns a capability

Repeated lists of supported types spread one policy across multiple callers. Centralize that policy in a named predicate or capability.

```ts
function beginResize(pane: Pane) {
  if (!canResizePane(pane)) return;
  startResizeInteraction(pane.id);
}

function collectSnapTargets(shapes: Shape[]) {
  return shapes.filter(shape => {
    const capabilities = getShapeCapabilities(shape);
    return capabilities.canSnap(shape);
  });
}
```

Start with an ordinary function, such as the exhaustive `canResizePane` example in rule 7. Introduce a registry or class hierarchy when extensibility warrants it. Domain-specific decisions can still legitimately inspect a type.

Basis: [SnapManager](../../node_modules/@tldraw/editor/src/lib/editor/managers/SnapManager/SnapManager.ts) asks shape utilities `canSnap(shape)` rather than maintaining its own list of snappable types.

## 19. Apply inexpensive exclusions before expensive work

In frequently executed paths, eliminate irrelevant candidates before parsing, geometry calculations, allocations, or DOM style reads, provided reordering preserves behavior.

```ts
function isScrollable(element: HTMLElement): boolean {
  const overflowsY = element.scrollHeight > element.clientHeight;
  const overflowsX = element.scrollWidth > element.clientWidth;

  if (!overflowsX && !overflowsY) return false;

  const style = getComputedStyle(element);

  return (
    (overflowsY && allowsScrolling(style.overflowY)) ||
    (overflowsX && allowsScrolling(style.overflowX))
  );
}
```

Pay particular attention to pointer, wheel, rendering, and subscription callbacks. Even the initial DOM measurements can have a cost; the example avoids an additional style read for excluded elements.

Basis: [usePassThroughWheelEvents](../../node_modules/@tldraw/editor/src/lib/hooks/usePassThroughWheelEvents.ts) checks overflow before reading computed styles, while [SnapManager](../../node_modules/@tldraw/editor/src/lib/editor/managers/SnapManager/SnapManager.ts) excludes irrelevant shapes before requesting bounds.

## 20. Represent change origin and replay mode explicitly

User edits, remote updates, and history replay may require different follow-up behavior. Pass or expose that context deliberately wherever behavior depends on it.

```ts
interface ChangeContext {
  source: 'user' | 'remote';
  mode: 'edit' | 'history-replay';
}

function afterShapeChange(
  before: Shape,
  after: Shape,
  context: ChangeContext,
) {
  if (context.mode === 'history-replay') return;
  if (!geometryChanged(before, after)) return;

  repairAttachedAnchors(after);

  if (context.source === 'user') {
    recordUserEdit(after.id);
  }
}
```

Keep origin and execution mode distinct when they answer different questions. Skip replay-time corrections only when recorded history already restores those consequences; do not use replay as a blanket reason to bypass required invariants.

Basis: [HistoryManager](../../node_modules/@tldraw/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts) distinguishes user changes, while [ArrowBindingUtil](../../node_modules/tldraw/src/lib/bindings/arrow/ArrowBindingUtil.ts) avoids recalculating endpoints during replay because the history diff already contains their intended state.
