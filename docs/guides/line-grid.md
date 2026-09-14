# Line-grid canvas

`domain/core/diagrams/lineGrid.ts` owns the rendering model. New persistent canvas content should
be represented by a `GridBox`, rather than positioning independent diagram DOM
elements or modifying the whitespace of another diagram's source.

```text
DraggableDiagramCanvas (pixel pan / zoom)
  LineGridScene
    contents[id] -> CanvasDiagram (ASCII, revision, local mappings)
    root -> GridBox container
      children -> diagram boxes or nested containers
        position -> cells relative to parent
        minimumSize -> optional reserved expanded space
        collapsedContentId -> compact representation
  resolveScene -> absolute bounds
  composeScene -> one shared ASCII pre
```

## Coordinate and content contracts

- Grid positions are nonnegative integer columns and rows, starting at zero.
- Right and bottom bounds are exclusive. Touching edges do not overlap.
- Existing source mappings retain one-based, inclusive local spans.
- Content is printable ASCII and LF newlines. Tabs and variable-width Unicode
  need normalization before entering this model.
- Every character's scene position is its local position plus all ancestor
  positions. Several boxes may contribute to one shared output row.
- The compositor adds whitespace between fragments. It never stores that
  whitespace back into diagram content. The composed output is not an edit target.
- A box reserves its whole rectangle, including blank cells. Containers contain
  their children; collision checks apply between siblings.

## Transactions and layout

Measure content to derive occupied size, with an optional minimum reservation.
Container size derives from child extents. Collapsed content determines collapsed
size; expanded child positions and minimum size remain stored.

After an insertion, edit, move, grouping, or expansion, call
`layoutScene(scene, changedBoxId)`. It anchors the changed subtree at each
ancestor. Other siblings settle in stable spatial order, moving only right to
clear occupied rectangles and the container's gap. Settled boxes are obstacles;
this makes displacement chains deterministic and finite. Parent growth is
resolved recursively up to the root. Shrinking does not pack neighbors back.

The returned scene includes all displaced positions. Commit content, metadata,
and this scene together. If validation or layout fails, retain the previous
document. Undo restores the whole document, not just one box. The implementation
limits extents and composed cell count before allocating the output.

## Mappings page integration

`domain/mapping/workspace/mappingGrid.ts` and `domain/core/diagrams/projectDiagramCanvas.ts` adapt project representation
revisions and their saved source evidence to the grid. A revision contains either
legacy ASCII or a `mapping-canvas` scene. Save appends an immutable revision with
the complete scene and composed ASCII; reloading restores its content, positions,
groups, and collapsed state. The project catalog owns diagrams, and each diagram
owns its boxes. Boxes are not independent project representations.

Each open diagram retains 50 undo snapshots and supports redo. Switching diagrams
preserves these drafts and directs pending prompt results to their originating
diagram. Undo history, pan/zoom, and local chat are session-local. Saving uses the
expected project revision to reject concurrent stale writes.

Select mapped text, choose **Generate sub-diagram**, enter an instruction, then
drag a region. The selection supplies source evidence; the region supplies
placement and a minimum size. Generation creates separate content with local
source mappings. Box controls move, group, collapse, and expand content. A
diagram inside a group generates siblings inside that group when placed at
coordinates within or beyond that group's origin; placement above or left of
the group falls back to the root.

Pointer coordinates pass through the inverse viewport transform, then hit testing
returns a box ID and local cell. Edits send only that box's ASCII, revision, and
mappings. Each request uses an independent agent session identity so undo can
restore earlier content without conflicting with a server-side edit session.
Source evidence is resolved from the saved project revision on the server, using
its original source snapshots even when the working files have changed. Generation
accepts mappings only for evidence intersecting the source selection.

Existing temporary mapped previews and local chat remain interaction overlays;
generated canvas diagrams use the shared compositor.

## Validation

```sh
npx vitest run domain/core/diagrams/__tests__/lineGrid.test.ts infrastructure/mapping/agents/selection/__tests__/mappingGridPrompt.test.ts infrastructure/mapping/__tests__/mappingProject.test.ts
npm run build
node tests/browser/mapping/browser-project-mapping-check.mjs
node tests/browser/mapping/browser-line-grid-check.mjs
```

The browser check uses the front-end skill's headless browser harness, an isolated
preview server, a disposable project, and the fake generation runtime. It drives
public pointer and keyboard interactions. Live model output is validated by the
same generation-result and mapping contracts.
