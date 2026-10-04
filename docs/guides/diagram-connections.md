# Diagram connections

Open **Connections** in the canvas toolbar, then **New connection**. Pick a source
content node and a destination node or box. The highlighted labels and box borders
are clickable; the endpoint dropdowns also list hidden nodes. Set an optional
label, color, line style, and endpoint sides, then choose **Create connection**.
Position along side runs from 0 to 1: top to bottom on vertical sides, left to
right on horizontal sides. The default is the midpoint (0.5).

Click an arrow or its entry in the Connections panel to change its appearance,
reattach it, or delete it. Escape closes the panel. Undo and redo include connection
changes. Save persists connections with the document; Save workspace also retains
unsaved connections and the saved baseline used for dirty detection.

## Data and geometry

`MappingGridDocument.edges` is the authoritative `DiagramConnection[]`. It is
independent of `DisplayNode.childIds`, which continues to express ownership.
Connections can form cycles and do not establish parent/child ownership.

The source must be a `ContentNodeAnchor`. The target can be a content-node anchor
or a `GridBoxAnchor`. Both identify the displayed instance with `displayNodeId`.
A content-node anchor also includes `contentNodeId` and `revisionId`. This
distinguishes repeated labels and multiple GridBoxes displaying the same content.

The agent API exposes `content.structure.nodes` on diagram nodes. Trees use
their existing node index; unstructured diagrams use a derived interpreter index.
Building that index does not modify ASCII, stored structure, or source mappings.

Each connection produces a `FloatingBoxArrow` with resolved canvas pixel endpoints,
an orthogonal SVG path, and selection bounds. Arrows are derived views, not entries
in the persisted floating-pane store. They have no resize or collapse behavior and
do not occupy grid layout space. Moving an endpoint's GridBox recomputes the arrow.

The browser registers each label span and GridBox element, measures its border,
and converts it through the SVG's inverse screen transform into canvas pixels.
Measurements retain fractional precision. The transient `endpointBounds` cache
is keyed by displayed instance, content node and revision; it does not enter
document history, edit versions, saved revisions or workspace persistence.
Layout changes clear old measurements until the next DOM layout pass.

`controller.nodes()` calls `canvasDisplayNodes()` and derives stored arrows via
`drawEdge()` once per controller snapshot. `DiagramConnections` consumes those
arrows and renders `PanelConnector`; only an unsaved preview calls `drawEdge()`
directly. Live agent reads receive the same measured bounds. Headless callers
without a DOM use cell estimates, explicitly marked `geometrySource: estimated`.

Routes leave and enter perpendicular to the chosen sides, avoiding the interiors
of the two endpoint rectangles. This is endpoint routing, not general obstacle
avoidance for other diagrams. Missing DOM bounds produce `pending`; impossible
routes through overlapping endpoint boxes produce `blocked`. Neither draws a
misleading path. Invalid semantic references remain `stale`.

When folding hides a content node, its endpoint moves to the nearest visible tree
ancestor or enclosing GridBox. The semantic attachment stays unchanged. The arrow
is dashed and marked as a folded attachment until expanded.

Replacing content with identical ASCII and structure allows exact positional
correspondence across revisions. Other replacements conservatively retain the
old endpoint as stale. The panel shows **needs reattachment** and suppresses the
arrow until repaired. Labels alone never establish correspondence. Deleting a
GridBox removes incident connections in the same undoable operation.

Existing documents and workspaces without connections load with an empty array.
Saved mapping-canvas revisions carry `edges` alongside `scene`. Workspace
`savedEdges` records the saved baseline independently of live `document.edges`.

## Agent API

`canvas-api-search` documents `edges.list`, `edges.create`, `edges.update`, and
`edges.remove`. These run inside `exec` with the same session, expected-version,
request deduplication, and immediate per-edit commit rules as node operations.
A later script failure leaves earlier successful edits in place.

For example, with a bound session and its current `expectedVersion`:

```js
const a = nodes.get({ nodeId: 'grid:overview' });
const b = nodes.get({ nodeId: 'grid:details' });
return edges.create({
  source: {
    kind: 'content-node',
    displayNodeId: a.id,
    contentNodeId: Object.values(a.content.structure.nodes)[0].id,
    revisionId: a.content.revisionId,
    side: 'right'
  },
  target: { kind: 'box', displayNodeId: b.id, side: 'left' },
  appearance: {
    label: { text: 'Details', position: { x: 400, y: 180 } },
    color: '#7dd3fc', lineStyle: 'solid'
  }
});
```

`edges.update` accepts the complete connection, including its ID. Unchanged stale
endpoints may be retained while editing appearance or repairing the other end.
`appearance.label` accepts `{text, position?: {x, y}}`. Position is in absolute,
unscaled canvas pixels: `x` is the horizontal center and `y` is the text baseline.
The label pans and zooms with the canvas; an explicit position stays fixed in
canvas coordinates when endpoints move. There are no width, height, or spacing
parameters. Omit `position` to use the existing automatic endpoint-midpoint
placement. String labels remain compatible with saved documents and older callers.
Editing label text in the Connections panel preserves an explicit position.
Label positions participate in connection undo/redo and persistence, and render
the same way in live canvases and change-session previews.
`nodes.remove` on a derived arrow removes its connection. Moving or collapsing an
arrow is rejected; use `edges.update` to change its anchors.
