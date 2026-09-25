# Diagram search

Use **Ctrl/Cmd+F** to find text in the active canvas, or **Ctrl/Cmd+Shift+F** to
search the entire loaded project. The **Search** button opens the same panel.
Use the scope selector to switch between them. Searches are literal substrings;
**Match case** enables case-sensitive matching. Arrow keys select a result,
Enter opens it, and Escape closes the panel.

Results contain full diagram lines with matching columns highlighted, grouped by
canvas and diagram. Clicking a result opens its canvas, expands containing groups
and folded ancestors, and centers the matching line. The result's revision and
content hash must still match before navigation; stale results never target a
different line silently.

Global search covers current saved canvases already available in the in-memory
project catalog. Open canvases override their saved copies with live content,
including unsaved edits. Local search covers every diagram placement in the
active canvas, including collapsed content. When reviewing a ChangeSession, local
search covers that proposed canvas; global search continues to cover original
project canvases. Historical revisions, other proposals, source files, and chat
text are excluded.

`DiagramSearchService` sends current `DiagramContent` revisions and their canvas
placements to a dedicated browser Web Worker. It does not transfer editing history,
source evidence, or rendering state. Identical content is sent once and shared
across placements. Changes replace affected content, including undo, redo, deletion,
and acceptance; camera and selection changes do not update the worker index.

The worker derives line-to-node mappings using `diagramContentNodes()`. Each result
includes canvas and display-node identities, revision ID, content hash, raw 1-based
line number, inclusive match columns, and `DiagramContentNode` records. Text with
no content node remains searchable with an empty node list. Repeated placements
produce separate navigable results.

Queries yield between batches so newer requests can cancel older work. Query IDs
and index generations prevent stale responses from appearing. Results are capped
at 1,000 matching lines, with an explicit prompt to refine the search if more exist.
Nothing is persisted by search itself; revealing a collapsed diagram uses the
existing canvas expansion behavior.

Validation: `npm run check:diagram-search` builds the app and runs a disposable
browser fixture covering shortcuts, worker execution, folded navigation, match
highlighting, unopened canvases, unsaved edits, undo/redo, reload, and proposal
isolation. Set `CHROME_PATH` to the test browser when required.
