# File Explorer Proposal: Live Repository with a Current-Diagram Filter

## Goal

Add a read-only `Files` panel on the left side of the workspace. The standalone
panel uses the existing ASCII-tree visual language and provides the toggle
requested in [a]:

- `ALL FILES`, the default, shows the live contents of the active DiagramSet's
  `sourceCheckoutRoot`.
- `DIAGRAM FILES` filters that same live tree to files referenced by
  CodeEntities declared on the current Diagram. The same behavior naturally
  applies to a selected DiagramComponent because both artifact records expose
  `codeEntityIds`.

This proposal is intentionally limited to discovery and filtering. Opening or
editing a file, source-range highlighting, search, Git decorations, file
creation, rename, and delete are follow-up work.

## Existing Seams

The feature can fit the current architecture without changing persisted
Diagram or CodeEntity records:

- `src/App.tsx` already resolves the active Diagram/DiagramComponent, its
  DiagramSet, and one resolution collection containing both the active
  CodeEntitiesSet and immutable dependencies carried by mapped global imports.
- `DiagramRecord.codeEntityIds` and `DiagramComponentRecord.codeEntityIds`
  identify the relevant entities.
- Every `CodeEntityRecord` has a global id, explicit project/DiagramSet/
  CodeEntitiesSet origin, and one or more globally identified `sourceRanges`.
  Each range's repository-relative `path` is a filter candidate only when its
  CodeEntity belongs to the active project. `DiagramCodeEntityMapRecord` is not
  needed because it maps diagram text spans, not artifact membership.
- The pane engine in `src/panes/` supports nested splits, so `Files` can occupy
  a persistent left pane while the primary Diagram/Generate pane remains in the
  center and `Code Entities`, `Diagrams`, and conditional `Operations` remain
  in the right context pane.
- `src/components/DiagramLineagePanel.tsx` and the `.diagram-tree-*` styles
  establish the ASCII connectors, monospace typography, expansion controls,
  current-row treatment, and scrolling behavior to reuse.
- The server already treats `DiagramSet.sourceCheckoutRoot` as the authoritative
  checkout and validates source paths against it in
  `DiagramApplication.sourceSnippet`.

## Proposed UX

Add a persistent, standalone `Files` pane at the far left of the workspace.
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

1. Default to `ALL FILES`, because this is a repository explorer first. If the
   selected artifact has no applicable CodeEntities, `DIAGRAM FILES` renders a
   clear no-matches state without changing the complete tree.
   When no Diagram or DiagramComponent is active, keep the repository visible
   and disable `DIAGRAM FILES` until an artifact is opened.
2. Switching modes must not change the selected artifact or any Diagram data.
3. Keep one live-directory cache and one user-controlled expanded-directory
   set. Filter mode may reveal matching ancestors without changing the tree
   shape restored by `ALL FILES`.
4. A directory row toggles with pointer, Enter, Space, ArrowLeft, and
   ArrowRight. Up/Down/Home/End move among visible rows. Use `role="tree"`,
   `role="treeitem"`, `aria-level`, `aria-expanded`, and a roving `tabIndex`.
5. File rows are display-only in [a]. Their full repository-relative path is
   available through accessible text/title when the visible name is clipped.
6. Directories sort before files; each group sorts case-insensitively by name
   with the original path as a deterministic tie-breaker.
7. Show loading and per-directory retry states. A failed folder must not blank
   already loaded siblings or valid matches from other directories.
8. Prefix every live file associated with the active artifact with `[n]`, where
   `n` is the number of distinct applicable CodeEntities that reference that
   path. Clicking `[n]` expands or collapses those entities beneath the file.
9. Clicking an associated filename reveals its first CodeEntity in the
   right-hand `Code Entities` pane. Clicking an expanded `@entity/handle` row
   reveals that specific entity and the first source range associated with that
   file. This must activate and focus the Code Entities pane even when another
   context or call-graph-focus tab is currently open.

The file tree should share the lineage tree's colors and ASCII connector
grammar, but it should not render the lineage tree's separate 8px bridge rows.
Connectors belong within each compact file row so density remains predictable.

## Full-Screen Density Contract

The supplied 290x901 VS Code reference contains **34 visible nodes** (folders
and files both count as nodes). Treat that number as an acceptance criterion,
not merely a styling suggestion.

The repository's browser check already runs at 1440x900. At that viewport the
standalone file pane has:

```text
900px viewport
- 58px studio header
- 36px Files pane tab
- 42px explorer mode bar
- 10px tree padding (5px top + 5px bottom)
= 754px for rows

754px / 22px per row = 34 fully visible nodes, with 6px remaining
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

## Deriving the `DIAGRAM FILES` Filter

Make the transformation a pure helper so it is testable without React:

```ts
diagramFileFilter(artifact, resolutionEntities, activeProjectId): DiagramFileFilter
buildFileTree(paths): FileTreeNode[]
```

Algorithm:

1. Create a set from `artifact.codeEntityIds` and resolve it against the active
   set's entities plus `WorkspaceSnapshot.importedCodeEntities`.
2. Retain entities whose `origin.projectId` equals the active DiagramSet's
   `projectId`. A mapped import from another DiagramSet in the same project may
   filter the current checkout; a foreign-project path must not match an
   identically named local file.
3. Flatten the applicable `sourceRanges[].path` values. Normalize separators to
   `/`, reject paths that are not repository-relative, dedupe by complete path,
   and sort deterministically.
   Preserve a path-to-CodeEntity association list in artifact `codeEntityIds`
   order. Deduplicate repeated ranges from the same entity and path, retaining
   the first matching `sourceRangeIndex` for reveal navigation.
4. Intersect those candidates with immediate live directory listings from the
   active `sourceCheckoutRoot`. Group candidates by parent directory so each
   parent is requested once and shares the normal explorer cache.
5. Build a trie only from confirmed live files, materialize their required
   ancestors, and reveal those ancestors while the filter is active.
6. Report unresolved entity ids, foreign-project dependencies, invalid paths,
   and candidate paths absent from the active checkout as unavailable. Do not
   render historical snapshots as members of the live repository tree.

## Implementation Steps

### 1. Define the read model and pure tree helpers

- Add `RepositoryEntry` and `RepositoryDirectoryListing` to `src/domain.ts`,
  since both server and client compile against that module.
- Add `src/fileTree.ts` with path normalization, project-aware filter
  derivation, directory trie construction, sorting, and visible-row flattening.
- Keep this data transient; no schema version or persistence migration is
  required.

### 2. Add the repository-listing endpoint

- Add `DiagramApplication.listRepositoryDirectory` in
  `server/application.ts` with checkout-boundary and symlink protections.
- Add the set-scoped GET route in `server/http.ts`.
- Add `fetchRepositoryDirectory(setId, path)` in `src/api.ts`.

### 3. Build the explorer component

- Add `src/components/FileExplorerPanel.tsx`.
- Give it `activeSetId`, `activeProjectId`, the unified resolution entities,
  and the active Diagram or DiagramComponent.
- Keep mode, one shared expansion state, loaded child listings, focus, loading,
  and error state local to the panel. Both modes consume the same listing cache.
- Keep a separate expanded-file set for CodeEntity children. File and entity
  rows participate in the same roving keyboard order; Enter reveals a file's
  first entity, Space toggles children, and expanded entity rows can be
  activated directly.
- Abort or ignore stale requests when the set changes or a directory is
  collapsed while loading.
- Render one flattened list of currently visible nodes; this simplifies
  roving focus, keyboard movement, connector calculation, and the 34-row
  density assertion.

### 4. Integrate as a standalone workspace pane

- Add a dedicated `files` pane to the left of the primary pane in `src/App.tsx`.
  Keep the primary pane in the center and the existing context pane on the
  right.
- Migrate persisted two-pane layouts by removing the legacy `Files` context tab
  and inserting the dedicated left pane without discarding the saved primary/
  context split ratio.
- Keep the panel mounted while moving between Generation, Diagram,
  DiagramComponent, and edit-operation states. Pass the active artifact when
  one is on screen; otherwise leave `ALL FILES` available and disable the
  artifact-specific filter.
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
- Add `src/fileTree.test.ts` for multiple ranges per entity, global identity
  resolution, same-project imported entities, foreign-project exclusion,
  duplicate paths, ancestor materialization, directory pruning, path
  normalization, missing entity ids, and empty/imported artifacts.
- Extend `browser-check.mjs` with more than 34 fixture nodes. Verify:
  - `Files` is a standalone pane to the left of the primary and context panes;
  - it remains an `ALL FILES` repository explorer when no artifact is active;
  - `ALL FILES` is the default and includes unrelated live repository files;
  - `DIAGRAM FILES` filters that tree to the fake entity's `fixture.ts` path;
  - `fixture.ts` has a clickable `[1]` prefix;
  - clicking the filename or its expanded entity activates the right-hand Code
    Entities pane and reveals the expected entity;
  - `ALL FILES` loads root entries and expands folders lazily;
  - the `ALL FILES` expansion state survives filter toggling;
  - keyboard expansion and navigation update ARIA state/focus;
  - at the existing 1440x900 viewport, exactly 34 file rows are fully visible
    without scrolling, and the next row requires scrolling.
- Run `npm test`, `npm run typecheck`, `npm run build`, and
  `npm run check:browser`.

## Acceptance Criteria for [a]

- A standalone `Files` pane appears at the far left of the workspace with
  `DIAGRAM FILES` and `ALL FILES` modes.
- `ALL FILES` remains usable across workspace screens; `DIAGRAM FILES` is
  enabled only while a Diagram/DiagramComponent is current.
- `DIAGRAM FILES` is exactly the intersection of the active live checkout and
  the normalized source-range paths from resolved, active-project CodeEntities,
  with only required ancestor folders.
- `ALL FILES` lazily represents the live checkout, includes dotfiles, and does
  not expose or traverse Git/Diagram metadata or paths outside the checkout.
- Both modes use the same ASCII-tree vocabulary and theme as the Diagram
  lineage view.
- Associated files display a clickable `[n]` count, can expand all distinct
  CodeEntities for that path, and link both filenames and entity rows to the
  correct right-hand source context.
- Toggling modes is immediate after a directory has loaded and preserves each
  mode's expansion state.
- The tree is keyboard-accessible and reports its hierarchy/expansion through
  ARIA.
- Exactly 34 rows are fully visible in the full-screen browser acceptance
  viewport before vertical scrolling, matching the supplied reference count.
- No Diagram schema, persisted artifact, generation behavior, or source file
  is modified by using the explorer.
