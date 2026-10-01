# CodePanel

Click a diagram node or Ctrl-drag a rectangle to select nodes. Selection shows
only its outline and Actions (A), Stacked/Chained, and remove controls. Selected
node labels keep the same cyan outline as hover. Choose **Actions (A) → open mapped
source** to open their combined resources; selection itself never opens a source pane.
Pressing A opens the actions menu; N opens mapped sources while that menu is open.
Outside clicks preserve selection; use Escape or remove to clear it. Clicks on diagram jump links
keep their navigation behavior; dragging still pans. Diagram-background double
clicks select whole diagrams. Ctrl-drag can also enclose whole diagrams or select
regions across diagrams. Enclosing a diagram replaces its selected regions; existing
panels retain their captured context. Shift-drag does not select.

The explicit `mappedResourceType` defaults to `source-range`. CodePanel resolves
structural `DiagramContentNode` identities in the current diagram revision, rather
than treating source mapping records as selectable nodes. Each node uses its own
mappings or the nearest ancestor with mappings of the requested type. All mappings
at that node are included. Missing mappings, file errors, and stale source are
separate states; a failed file read never causes ancestor fallback.

`handleNodeSelect(context, nodes, mappedResourceType)` returns `PanelContent`:
resource references, selected nodes, unmapped nodes, and mapping provenance. Domain
handlers in `domain/mapping/code-panel/codePanel.ts` perform indexing, resource
identity/deduplication, and presentation grouping. UI renderers are registered in
`src/features/mapping/code-panel/CodePanel.tsx`. A future resource type extends the
`MappedResource` union and supplies its domain handler and UI renderer.

Source files are grouped by project, repository, and path. Overlapping ranges share
rendered lines; original mappings and selected-node provenance are retained. Gaps
are expandable folds. Reopening a selection’s panel preserves its geometry, file order, and scroll.
Each retained selection owns its own panel.
Hovering a provenance label highlights its canvas nodes, and hovering a selected
canvas node highlights its provenance labels. The Actions button on the retained
selection provides mapped sources, prompt, copy, and ask actions.

`CodeRepoService` owns file loading, directory listings, and definition navigation.
The HTTP implementation connects existing backend endpoints; search and Git
operations remain unsupported. Mapped source coordinates are one-based inclusive
lines; definition positions remain zero-based UTF-16. Evidence stores captured
range text, so the panel checks its SHA-256 against the corresponding current file
slice. Changed ranges cause that file to display without mapping highlights or
folds, while other files remain usable. Browse source reuses the existing source
viewer, file explorer, and navigation history.

The call-tree-to-compaction runtime mapping traversal and compaction-parent source
opening requirement have been removed. Existing saved compaction panes retain their
presentation, and legacy source panes import explicit range/fold presentation once
at workspace decoding. Compaction artifact generation and validation remain
independent. CodePanel does not synthesize compaction artifacts to represent source
ranges.

Validation:

```sh
npm run build
npx vitest run domain/mapping/code-panel src/features/mapping/code-panel src/features/mapping/source-pane/__tests__ tests/architecture
CHROME_PATH=/path/to/chrome node tests/browser/mapping/browser-code-panel-check.mjs
```

The browser check creates a disposable repository and server. It does not edit the
running user's diagrams.

Node double-clicks select the node without opening sources, even when camera pointer capture
retargets the browser event to the viewport. Ctrl/Cmd-double-click still toggles whole
diagram selection. Escape closes the most recently opened or interacted-with CodePanel;
a second Escape removes its retained source selection. Other panels keep their state.
Mapped source hashes use UTF-8, including non-ASCII comments and strings; diagram artifact
hashing retains its existing ASCII restriction.
