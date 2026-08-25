# File Explorer Proposal: Full Repository vs. Current-Diagram Files

## Goal

Add a read-only `Files` view to the diagram context pane. The view uses the
existing ASCII-tree visual language and provides the toggle requested in [a]:

- `ALL FILES` shows the live contents of the active DiagramSet's
  `sourceCheckoutRoot`.
- `DIAGRAM FILES` shows only files referenced by CodeEntities declared on the
  current Diagram. The same behavior naturally applies to a selected
  DiagramComponent because both artifact records expose `codeEntityIds`.

This proposal is intentionally limited to discovery and filtering. Opening or
editing a file, source-range highlighting, search, Git decorations, file
creation, rename, and delete are follow-up work.

## Existing Seams

The feature can fit the current architecture without changing persisted
Diagram or CodeEntity records:

- `src/App.tsx` already resolves the active Diagram/DiagramComponent, its
  DiagramSet, and the immutable CodeEntitiesSet.
- `DiagramRecord.codeEntityIds` and `DiagramComponentRecord.codeEntityIds`
  identify the relevant entities.
- Every `CodeEntityRecord` has one or more `sourceRanges`, and each range has a
  repository-relative `path`. These paths are the source of truth for
  `DIAGRAM FILES`; `DiagramCodeEntityMapRecord` is not needed because it maps
  diagram text spans, not artifact membership.
- `src/components/DiagramContextPanel.tsx` already hosts the `Code Entities`,
  `Diagrams`, and conditional `Operations` tabs. `Files` belongs beside these
  tabs rather than becoming a new application screen.
- `src/components/DiagramLineagePanel.tsx` and the `.diagram-tree-*` styles
  establish the ASCII connectors, monospace typography, expansion controls,
  current-row treatment, and scrolling behavior to reuse.
- The server already treats `DiagramSet.sourceCheckoutRoot` as the authoritative
  checkout and validates source paths against it in
  `DiagramApplication.sourceSnippet`.

## Proposed UX

Add a `Files` context tab whenever a Diagram or DiagramComponent is active.
Inside it, place one compact, 42px-high mode bar above the tree:

```text
+-----------------------------------------------------------+
| [ DIAGRAM FILES ]  [ ALL FILES ]                          |
+-----------------------------------------------------------+
| [-] src                                                   |
|  |                                                        |
|  +-- [-] csim                                             |
|  |    +-- observation.h                                   |
|  |    `-- sim_engine.c                                    |
|  `-- [+] training                                         |
+-----------------------------------------------------------+
```

Behavior:

1. Default to `DIAGRAM FILES`, because the view's primary question is which
   files support the current artifact. If the selected artifact has no
   CodeEntities, render a clear empty state and leave `ALL FILES` available.
2. Switching modes must not change the selected artifact or any Diagram data.
3. Keep independent expanded-directory sets for the two modes during the
   session, so switching back restores the user's previous tree shape.
4. A directory row toggles with pointer, Enter, Space, ArrowLeft, and
   ArrowRight. Up/Down/Home/End move among visible rows. Use `role="tree"`,
   `role="treeitem"`, `aria-level`, `aria-expanded`, and a roving `tabIndex`.
5. File rows are display-only in [a]. Their full repository-relative path is
   available through accessible text/title when the visible name is clipped.
6. Directories sort before files; each group sorts case-insensitively by name
   with the original path as a deterministic tie-breaker.
7. Show loading and per-directory retry states in `ALL FILES`. A failed folder
   must not blank already loaded siblings.

The file tree should share the lineage tree's colors and ASCII connector
grammar, but it should not render the lineage tree's separate 8px bridge rows.
Connectors belong within each compact file row so density remains predictable.

## Full-Screen Density Contract

The supplied 290x901 VS Code reference contains **34 visible nodes** (folders
and files both count as nodes). Treat that number as an acceptance criterion,
not merely a styling suggestion.

The repository's browser check already runs at 1440x900. At that viewport the
right context pane has:

```text
900px viewport
- 58px studio header
- 42px context tabs
- 42px explorer mode bar
- 10px tree padding (5px top + 5px bottom)
= 748px for rows

748px / 22px per row = 34 fully visible nodes
```

Add explorer-specific tokens rather than tightening the existing lineage tree:

```css
--file-tree-row-height: 22px;
```

Each `.file-tree-row` has an exact 22px block size and line height, no vertical
margin, and no separate connector row. The 35th node is reached by scrolling.
Horizontal overflow scrolls instead of wrapping or increasing row height.

The browser acceptance check should calculate row and scroll-container bounds
and assert that exactly 34 rows are fully visible before scrolling. This avoids
font-rendering or selector-count false positives.

## Data Contract and Server Boundary

Do not put a recursive repository snapshot in `WorkspaceSnapshot`; it changes
independently from Diagram persistence and could be large. Add a lazy,
read-only endpoint for one directory at a time:

```http
GET /api/diagram-sets/:setId/files?path=src/csim
```

```ts
export interface RepositoryDirectoryListing {
  directory: string; // "" means sourceCheckoutRoot
  entries: RepositoryEntry[];
}

export interface RepositoryEntry {
  path: string;      // normalized repository-relative POSIX path
  name: string;
  kind: "directory" | "file";
}
```

Implementation boundary:

1. `server/http.ts` parses the set-scoped route and query.
2. `DiagramApplication.listRepositoryDirectory(setId, relativeDirectory)`
   loads the set, resolves its `sourceCheckoutRoot`, validates the requested
   directory, and returns its immediate children.
3. Use `readdir(..., { withFileTypes: true })`; do not recursively enumerate
   the repository for a root request.
4. Include dotfiles such as `.gitignore` and `.plan.toml`. Exclude only Git's
   private metadata directory and the active Diagram store when it lives under
   the checkout root. Do not silently apply `.gitignore`: `ALL FILES` means the
   live directory, including ignored build/dependency directories if present.
5. Display symbolic links as leaf file nodes and never traverse them. This
   prevents cycles and avoids crossing the checkout boundary.
6. Reject absolute paths, `..` traversal, NULs, and paths whose resolved parent
   escapes the real checkout root. Return only relative paths; never expose an
   absolute server path.
7. Fetch with `cache: "no-store"`. Cache successful directory listings only in
   the mounted panel; remounting or changing DiagramSets reads the live tree
   again.

This lazy contract keeps initial work proportional to the visible tree and
lets a large `node_modules` directory remain cheap until explicitly expanded.

## Deriving `DIAGRAM FILES`

Make the transformation a pure helper so it is testable without React:

```ts
diagramFilePaths(artifact, codeEntities): string[]
buildFileTree(paths): FileTreeNode[]
```

Algorithm:

1. Create a set from `artifact.codeEntityIds`.
2. Select only CodeEntities whose ids are in that set.
3. Flatten all of their `sourceRanges[].path` values. A CodeEntity may span
   multiple files, and several entities may share a file.
4. Normalize separators to `/`, validate that paths remain relative, dedupe by
   complete path, then sort deterministically.
5. Build a trie from the file paths and materialize every ancestor directory.
6. Prune directories that contain no related descendant file.

This mode does not need a server request and continues to show the immutable
source path recorded for the Diagram even if the live file has since moved or
been deleted. A later file-opening feature can add a missing-file status; [a]
should not silently drop historical CodeEntity evidence.

Imported artifacts with no CodeEntities produce the empty state. Archived or
unavailable entity ids are ignored rather than causing the entire tree to
fail.

## Implementation Steps

### 1. Define the read model and pure tree helpers

- Add `RepositoryEntry` and `RepositoryDirectoryListing` to `src/domain.ts`,
  since both server and client compile against that module.
- Add `src/fileTree.ts` with path normalization, related-file derivation,
  directory trie construction, sorting, and visible-row flattening.
- Keep this data transient; no schema version or persistence migration is
  required.

### 2. Add the repository-listing endpoint

- Add `DiagramApplication.listRepositoryDirectory` in
  `server/application.ts` with checkout-boundary and symlink protections.
- Add the set-scoped GET route in `server/http.ts`.
- Add `fetchRepositoryDirectory(setId, path)` in `src/api.ts`.

### 3. Build the explorer component

- Add `src/components/FileExplorerPanel.tsx`.
- Give it `setId`, `codeEntities`, and the active Diagram or
  DiagramComponent.
- Keep mode, expansion, loaded child listings, focus, loading, and error state
  local to the panel.
- Abort or ignore stale requests when the set changes or a directory is
  collapsed while loading.
- Render one flattened list of currently visible nodes; this simplifies
  roving focus, keyboard movement, connector calculation, and the 34-row
  density assertion.

### 4. Integrate with diagram context

- Extend `ContextTab` in `src/components/DiagramContextPanel.tsx` with
  `"files"`, add the tab/tabpanel relationship, and pass the active artifact
  into `FileExplorerPanel`.
- In `src/App.tsx`, preserve a valid context tab when moving between
  Generation, Diagram, DiagramComponent, and edit-operation states. If `Files`
  is no longer available, fall back to `Code Entities` instead of rendering a
  mismatched panel.
- Do not add repository data to the top-level workspace load.

### 5. Add explorer-specific styling

- Add `.file-explorer-*` and `.file-tree-*` rules in `src/styles.css`.
- Reuse existing theme variables, monospace font, hover/current colors, and
  ASCII connector colors.
- Enforce the 42px mode bar, 5px tree padding, and exact 22px non-wrapping
  rows. Keep vertical and horizontal overflow inside the tree scroller.

### 6. Verify behavior and density

- Extend `server/application.test.ts` with a temporary checkout containing
  nested directories, dotfiles, ignored files, `.git`, the Diagram store, and
  a symlink. Verify listing, sorting, exclusions, no symlink traversal, unknown
  sets, non-directory paths, and traversal rejection.
- Add `src/fileTree.test.ts` for multiple ranges per entity, shared files,
  duplicate paths, ancestor materialization, directory pruning, path
  normalization, missing entity ids, and empty/imported artifacts.
- Extend `browser-check.mjs` with more than 34 fixture nodes. Verify:
  - `Files` appears for the active Diagram;
  - `DIAGRAM FILES` contains only the fake entity's `fixture.ts` path;
  - `ALL FILES` loads root entries and expands folders lazily;
  - mode-specific expansion state survives toggling;
  - keyboard expansion and navigation update ARIA state/focus;
  - at the existing 1440x900 viewport, exactly 34 file rows are fully visible
    without scrolling, and the next row requires scrolling.
- Run `npm test`, `npm run typecheck`, `npm run build`, and
  `npm run check:browser`.

## Acceptance Criteria for [a]

- A current Diagram/DiagramComponent exposes a `Files` tab with
  `DIAGRAM FILES` and `ALL FILES` modes.
- `DIAGRAM FILES` is exactly the deduplicated union of source-range files for
  the artifact's declared CodeEntities, with only required ancestor folders.
- `ALL FILES` lazily represents the live checkout, includes dotfiles, and does
  not expose or traverse Git/Diagram metadata or paths outside the checkout.
- Both modes use the same ASCII-tree vocabulary and theme as the Diagram
  lineage view.
- Toggling modes is immediate after a directory has loaded and preserves each
  mode's expansion state.
- The tree is keyboard-accessible and reports its hierarchy/expansion through
  ARIA.
- Exactly 34 rows are fully visible in the full-screen browser acceptance
  viewport before vertical scrolling, matching the supplied reference count.
- No Diagram schema, persisted artifact, generation behavior, or source file
  is modified by using the explorer.

