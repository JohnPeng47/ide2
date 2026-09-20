# Node-aware text and diagram jumps

Both `AsciiSelectionGrid` (used by `DiagramView`) and `MappingPocSelectionCanvas`
render their text through `DiagramText`. The component outputs one `<pre>` with
inline label spans. The viewer shells still own selection, folding and gestures.
`diagramSceneText` uses the existing `composeScene` painting operation, carrying
original source coordinates and displayed instance identity into the text runs.

The rendering contract is unchanged text, glyph positions, line spacing, box
allocation, folded source-row projection and copy/selection results. Arrow
coordinates now use the actual rendered label and box borders, correcting drift
from rounded character-width estimates. Decorations use outlines, with no
padding or font changes.
Overlapping source mappings split runs without duplicating characters; the single
diagram viewer offers a source chooser when a clicked run has multiple mappings. Parsed
labels carry `data-content-node-id` and `data-display-node-id`; unknown, ambiguous
or stale labels retain coordinate metadata without a fabricated node ID. A source
mapping is associated with a node only when its entire original range is uniquely
contained by that node. Mapping IDs remain separate from node IDs.

## Parser and connections

The tree adapter now recognizes `|--` (and `|-->`) alongside existing markers.
Standalone vertical guides remain guides. New content uses `ascii-tree-2`;
`ascii-tree-1` remains readable and validates using its original grammar. Saved
structures are not silently rewritten.

`drawEdge` replaces `resolveConnection`: it returns anchor geometry and an SVG
path without changing the document or touching the DOM. Mapping supplies a
transient cache of measured endpoint rectangles; stored arrows are derived by
the controller and consumed by the React connection layer. See
[Diagram connections](diagram-connections.md) for measurement and routing behavior.
The shared React
`PanelConnector` draws both projection-panel connectors and diagram edges with a
thin stroke and open arrowhead. Edge anchors still support all four sides,
folded ancestor proxies, colors, dashed lines and independent hit targets.
The controller's internal `draw` transaction is now `diagram-create`; existing
public `nodes.draw` and `draw_diagram` APIs retain their names for compatibility.

## Jumps

A diagram's optional `jumps` array is a sibling of `content` and `sourceContext`.
Source-code associations stay in `sourceContext.mappings`. No jump changes ASCII
or creates an edge. The visible label, for example `[*] Rendering`, must already
be present in the text. The renderer makes its source range interactive.

Use `nodes.get` to read the current content and `nodes.setJumps` to replace the
jump list in an undoable transaction. This supports coordinate-only links when
no structural node was parsed. Empty `jumps` removes all links.

```js
const node = nodes.get({ nodeId: 'grid:overview' });
return nodes.setJumps({
  nodeId: node.id,
  jumps: [{
    id: 'rendering-details',
    source: {
      revisionId: node.content.revisionId,
      contentHash: node.content.asciiSha256,
      line: 3, startColumn: 9, endColumn: 21
      // contentNodeId is optional; if provided it must contain this whole range.
    },
    target: {
      representationId: 'saved-target-representation-id',
      displayNodeId: 'grid:overview'
      // contentNodeId optionally focuses a revision-scoped target label.
    }
  }]
});
```

Source columns are 1-based and inclusive. Targets use catalog representation IDs,
not ephemeral live canvas/session IDs. Opening a jump reuses an existing draft,
reveals a folded target and focuses its label or diagram. Missing labels fall
back to the target diagram with a message; missing canvases report an error.
Changing source text retains link metadata but disables stale links. Replacing
identical text rebases its source revision and parsed identity. Overlapping jumps
are rejected. Whole-canvas saves and workspace round trips preserve jumps; saving
an individual diagram rebases its outgoing source anchors to the exported copy.

Rendering and navigating never save a diagram. Save and Save workspace remain
explicit actions. Jump authoring is currently available through the canvas API.
The single-diagram viewer accepts optional jumps and an `onJump` navigation callback;
Mapping supplies its existing document navigation.

## Diagram documentation follow-up (not applied)

- Put [F] Node-aware canvas rendering on a separate canvas: category [3].
- Add `[*] Node-aware canvas rendering` under [B]'s DiagramContent branch and
  attach a jump to [F].
- Include the `|--` parser fix, shared React renderer, shared connector style,
  `drawEdge` name and diagram-local jump metadata in those diagrams.

No canvas diagram edits are part of this implementation.
