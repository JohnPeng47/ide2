# Canvas architecture lessons from tldraw

Reviewed 2026-09-28. tldraw source revision: `fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74` (main at inspection time; not a pinned npm release). Local findings refer to the current working tree, including its uncommitted CanvasSession and CodePanel work. This is a source review, not a runtime benchmark or an implementation change.

**Recommendation:** develop the existing CanvasSession into a coherent editor boundary, separate state by ownership and update frequency, and move behavior out of the canvas component. These principles are useful whether or not tldraw becomes the renderer.

## 1. Classify state along several independent axes

tldraw's schema declares record scopes: shape records are document-scoped; cameras, pointers, and instance/page state are session-scoped; collaborator presence has its own scope. Instance records additionally identify ephemeral properties. Store serialization can filter by scope, and history has its own recording and replay policies.

Sources: [shape record](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/tlschema/src/records/TLShape.ts), [camera record](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/tlschema/src/records/TLCamera.ts), [instance record](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/tlschema/src/records/TLInstance.ts), [store](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/store/src/lib/Store.ts), [history](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts).

The general lesson is to ask separate questions for each field:

- Who owns it: document, workspace/view, individual interaction, or service?
- Should it survive reload?
- Should it participate in undo?
- How frequently does it change, and who needs notification?

“Saved” and “undoable” are independent. A camera can survive reload without becoming a diagram edit. A pending request should not resume merely because a saved workspace contains its status.

Suggested policies for this application, to be made explicit rather than inferred from the setter used:

| State | Owner | Persistence | Undo |
| --- | --- | --- | --- |
| ASCII content, mappings, semantic edges | Document model | Document revisions | Semantic edit history |
| Manual diagram/pane placement | Document or saved workspace presentation, according to product policy | Yes | One entry per completed move |
| Retained selection and opened code panel | Workspace presentation | Yes | Explicit panel-open/close policy |
| Camera and pane scroll | View state | Workspace checkpoint | Normally no |
| Current selection and hovered node | Editor session | Optional selection restoration | Explicit policy |
| Composer draft | Conversation UI/session | Optional draft recovery | Separate from diagram history |
| Pointer capture, drag origin, preview rectangle | Active interaction | No | No independent entries |
| Measured text/endpoint bounds and resolved connector paths | Geometry cache | Recompute; optional startup cache | No |
| Requests, AbortControllers, loading progress | Feature service runtime | Persist durable results separately | No request replay |

Your [CanvasSession](../../src/features/mapping/workspace/canvasSession.ts) already separates subscriptions into document, presentation, controls, geometry, status, and interaction. Preserve it. [SourcePaneViewState](../../src/features/mapping/source-pane/sourcePaneViewState.ts) also already demonstrates saved view state that avoids high-frequency document updates.

A concrete policy leak exists in MappingCanvas: conversation draft changes call `setDisplay`, which invokes `updateCanvas(..., true)`. Thus typing reaches the recorded-history path. Decide that behavior intentionally instead of letting the location of the draft field decide it.

## 2. Give every mutation a clear command boundary

tldraw's Editor is an imperative API over its store, tools, shape/binding utilities, and managers. Its UI actions hold labels/shortcuts and invoke editor operations. The architecture has a central behavioral entry point, even though the Editor implementation itself is very large and some editor services use browser facilities.

Sources: [Editor](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/Editor.ts), [UI actions](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/tldraw/src/lib/ui/context/actions.tsx).

For your application, grow CanvasSession's public commands and keep MappingDocumentController as the document mutation authority. Do not introduce another independently writable document store.

Useful commands include:

```ts
session.selectContent(input)
session.openCodePanel(input)
session.moveNodes(input)
session.setPaneExpansion(id, expanded)
session.setComposerDraft(threadId, text)
session.removeNode(id)
```

The document-affecting commands delegate to the controller/revision service; view commands affect only the appropriate view state. Buttons, keyboard shortcuts, gestures, and MCP should converge on the same application operations, with transport/version validation at their boundaries.

Currently, behavior reaches the model through `applyUpdate`, `commitDocument`, and arbitrary `updateCanvas` callbacks. These are legitimate lower-level mechanisms, but React callers repeatedly assemble multi-field mutations themselves. For example, `openCodePanel` creates a retained selection, upserts a pane, changes active IDs, and initializes controls inside MappingCanvas. That is an application operation worth naming and testing independently.

## 3. Structure gestures as explicit state machines

tldraw has a StateNode tree. The translating state owns entry, initial geometry, pointer movement, modifiers, completion, cancellation, and cleanup. It marks history at gesture start and groups ongoing changes. It can update live shape records throughout dragging; the lesson is not that all pointer motion must live outside a store.

Sources: [StateNode](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/tools/StateNode.ts), [Translating](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/tldraw/src/lib/tools/SelectTool/childStates/Translating.ts).

Your canvas currently coordinates `diagramPlacement`, `movingBoxId`, placement refs, selection refs, modifier state, click-versus-pan detection, and multiple event listeners. A small discriminated union or reducer would suffice initially:

```ts
type Interaction =
  | { kind: 'idle' }
  | { kind: 'selecting-content'; pointerId: number; /* anchor, revision */ }
  | { kind: 'moving-nodes'; pointerId: number; /* IDs, initial positions */ }
  | { kind: 'placing-diagram'; pointerId: number; /* origin */ }
  | { kind: 'panning'; pointerId: number; /* initial camera */ }
```

Specify who captures the pointer, when a click becomes a drag, which event cancels, and how Escape, pointercancel, canvas switching, and disposal clean up. Centralize event arbitration while preserving ordinary text selection, scrolling, and typing inside panes.

For the existing revision model, keeping temporary move geometry in the interaction store and committing once at release is a reasonable starting policy. Preview selection already follows that approach. Handle an intervening MCP edit explicitly through revision checks, cancellation, or rebasing.

## 4. Subscribe where the state is rendered

tldraw stores records in an AtomMap, derives queries/caches reactively, and provides tracked React components. This permits narrow dependencies. Its shape component separates the outer container's transform, clipping, and bounds from the memoized inner shape content.

Sources: [Store](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/store/src/lib/Store.ts), [track](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/state-react/src/lib/track.ts), [Shape](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/components/Shape.tsx), [content equality](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/utils/areShapesContentEqual.ts).

MappingCanvas currently subscribes to the complete presentation, controls, geometry, and status stores and the whole document. Thus store separation still feeds a broad component, although memoized children and the isolated preview already avoid some work.

Extend the pattern in [SessionCodePanel](../../src/features/mapping/code-panel/SessionCodePanel.tsx):

- A pane body selects its own content by ID.
- A frame selects its position, dimensions, and expansion.
- A selection overlay selects preview state.
- A toolbar selects action availability.
- The explorer selects document metadata.
- The camera updates the transformed surface without subscribing every body.

Stable content references matter. If moving a pane reconstructs its content object, narrow subscriptions lose their benefit. A renderer adapter can expose stable per-node projections without immediately replacing all current storage structures.

Your DraggableDiagramCanvas already writes camera transforms directly to the surface. Preserve that success. Rendering isolation also does not eliminate browser painting/compositing costs; the existing performance report specifically distinguishes those costs from state propagation.

## 5. Separate records, geometry/behavior, and rendering

A tldraw shape is a serializable record. ShapeUtil defines geometry, capabilities, rendering, and transformation hooks for a shape type. BaseBoxShapeUtil supplies common rectangular behavior.

Sources: [ShapeUtil](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/shapes/ShapeUtil.ts), [BaseBoxShapeUtil](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/shapes/BaseBoxShapeUtil.tsx).

Apply that separation using the lightest mechanism that fits:

- Records identify content, ownership, and saved geometry intent.
- Geometry functions resolve bounds, anchors, and hit tests.
- Behavior functions specify movement/resizing/expansion policies.
- React components render the frame and body.

Do not require all these functions to become classes. A typed registry of renderers and capabilities may suffice; put React-dependent entries in the frontend rather than importing React into the domain.

Grid and Floating describe current layout/storage strategies. “Diagram,” “code panel,” and “conversation” describe objects users interact with. Keep those concepts distinguishable. A common rendered box contract can coexist with distinct content and placement policies.

Likewise, content-node identity, a canvas box, a retained selection, and a transient highlight are different concepts. One independently movable diagram can be one shape while line anchors remain internal semantic references.

## 6. Give layout and invariants one owner

tldraw runs binding and parent consistency work through store/editor lifecycle hooks, including operation-complete processing. Geometry and transforms have computed caches and explicit coordinate conversion methods.

Source: [Editor](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/Editor.ts), especially operation-complete side effects, shape geometry caches, and screen/page/shape transforms.

There is concrete duplicate layout ownership locally:

- MappingDocumentController.resolveFloatingGeometry calls `layoutFloatingSelections`; SelectionEffectsLayer calls it again through a layout effect.
- The controller lays out conversations; MappingCanvas also writes conversation layout from a layout effect.
- Pane ResizeObservers report measurements into display state, which can trigger another layout pass.

Consolidate layout into a session-owned service using pure layout functions. React should report observations, not independently enforce the same policy.

Make the flow explicit:

```text
content + saved placement/sizing intent + measured intrinsic size
                         |
                  layout/geometry service
                         |
             resolved frames and connector anchors
                         |
                      renderer
```

Keep a user-selected fixed width distinct from the last measured content width. The existing automatic/manual and content/fixed policies are a good basis. Do not remove saved geometry indiscriminately: manual positions and fixed sizes are intentional state.

Use explicit coordinate types/conversions for screen pixels, canvas pixels, diagram-local cells, and source line/column coordinates. Persist semantic connection anchors with revision identity; recompute their pixel endpoints. Your EndpointBounds type already correctly treats measurements as transient.

## 7. Make transaction, undo, and persistence boundaries independent

tldraw batches mutations, accumulates record diffs, and uses history marks to define undo boundaries. History filters sources and ignores ephemeral fields during replay. A single batch is not automatically the same thing as one user-visible undo step.

Source: [HistoryManager](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/managers/HistoryManager/HistoryManager.ts).

For a panel-open action, creation of the selection and panel should leave all references valid before subscribers react. One gesture should have a defined undo boundary; persisting the workspace should not create another edit. Measurements and transient controls should not accidentally advance document versions.

Keep your revision-aware DiagramService, cross-canvas transfer history, and proposal acceptance semantics. They solve domain problems beyond tldraw's ordinary shape history. If tldraw is integrated, explicitly choose which system owns committed changes and undo; avoid two competing history stacks and bidirectional whole-document effect synchronization.

CanvasSession's stores publish synchronously one after another. React may batch the rendering, but arbitrary synchronous store subscribers can observe intermediate publication. If introducing commands that read multiple stores from subscriptions, provide a coherent versioned snapshot or an explicit transaction-complete event.

## 8. Let sessions own lifetimes; let services own asynchronous work

tldraw's editor constructs managers and registers their disposal. UI components consume the stable editor rather than owning its entire runtime.

Source: [Editor](https://github.com/tldraw/tldraw/blob/fdd9b4dee0d968cb92b52db2b6e0d37ffc906d74/packages/editor/src/lib/editor/Editor.ts).

CanvasWorkspace already owns session creation, subscriptions, and disposal. Build on this. Chat request maps and network workflows currently live inside MappingCanvas. Move them into feature services with an explicit scope: document session, workspace, or request.

Capture target document, selection, and content revision when starting work. Define whether switching tabs merely hides a request or cancels it; do not let an incidental component unmount choose the product behavior. Deliver results through commands after checking that the target remains valid.

## An incremental organization

Keep the existing top-level domain/application/infrastructure/frontend separation. Add files only while extracting real responsibilities:

```text
domain/mapping/
  workspace/              document records, mutations, revisions
  geometry/               pure layout and coordinate calculations
  selection/              semantic selection rules
application/mapping/
  canvas/                 commands and interaction transitions
  chat/                   request orchestration and result application
src/features/mapping/
  workspace/              CanvasWorkspace, CanvasSession, store adapters
  canvas/
    CanvasSurface.tsx      composition and event adapter
    NodeFrame.tsx          placement, sizing, chrome
    overlays/              selection, handles, connection decorations
  code-panel/              panel content and its narrow subscriptions
  chat/                    conversation UI
infrastructure/mapping/
  persistence/            persistence adapters and codecs
```

Names are illustrative. CanvasSession can remain where it is until moving it establishes a real dependency boundary. Extracting ten hooks that still share a giant snapshot would retain the same coupling.

A suitable first vertical slice is “select content → open code panel”:

1. Extract `openCodePanel` into a session/application command.
2. Give selection one explicit start/update/complete/cancel lifecycle.
3. Render the selection overlay, frame, and panel body from narrow subscriptions.
4. Move the applicable layout policy to its single owner.
5. Define the history and persistence behavior for that action.

Then repeat for movement/resizing and conversations. If tldraw adoption is imminent, use its tools and ShapeUtils for canvas mechanics rather than building a replacement engine first.

Useful acceptance checks for those changes:

- Cancelled selection creates no panel or document-history entry.
- One completed move undoes in one step.
- Pan/move updates do not rebuild unaffected source content.
- MCP and UI commands enforce the same semantic invariants.
- Save captures current scroll/camera without turning them into document edits.
- Inactive/unmounted canvas behavior and asynchronous result targets are explicit.
- Layout converges after measurement without multiple competing writers.

These are recommendations for subsequent implementation; no refactor or new runtime verification was performed in this review.

