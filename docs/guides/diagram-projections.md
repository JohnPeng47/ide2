# Diagram projections

A projection relates evidence entities in one saved project representation to branch roots in another saved tree representation. Links use **any-source** semantics: `{b,c} -> a1` matches a selection containing either `b` or `c`. Target branches are unioned, expanded to descendants, and connected through their ancestors. Unrelated siblings are excluded. Displayed rows retain their original target node IDs in the projection result; output connectors are regenerated.

## Using the viewer

Open the source diagram in Mapping, Ctrl-drag across mapped labels, then press **N** or choose **open call tree**. The projected pane displays only related branches, with linked-entity coverage. Choosing the action retains the selection rectangle and projection; Escape does not dismiss them. Use the selection's remove control or a pane's close control to remove content explicitly.

**Open compaction** creates a child pane containing compacted source trees grouped by file.
The default **Stacked** mode displays one active projection path per selection; **Back** returns
to the call tree without deleting the child. **Chained** mode displays the panes together on a
shared horizontal connector axis. Ctrl-drag within a call tree and choose **Project selected rows**
to project a subset. Join controls collapse/expand descendants. Multiple retained selections
can coexist. See [Mapping workspace state](../architecture/mapping-workspace.md) for persistence and ownership.

Original-diagram selections open the call tree first. Projections with compaction mappings
are preferred by default; older projections remain available and show a disabled compaction
action when unmapped.

Choose **Open source** on a compaction file to create a retained source-code child pane. `DisplayPane` owns its frame, geometry, and collapse/close controls; `SourceCodePane` renders the file selector, mapped-range navigation, and the shared Studio/Shiki source viewer with inline compaction folds. The **Compact source** toggle replaces mapped source ranges with Studio-style line-count comments and `[+]` controls. Expand an entire section or reveal the exact source for one graph node. Overlapping mappings share a section while retaining their individual node ranges. Only selected compaction rows contribute highlights and folds; context-only ancestors and unrelated source gaps remain visible as ordinary source.

The ownership chain is selection -> call tree -> compaction -> source code. In **Stacked** mode, **Back** and **Forward** navigate without deleting panes. **Chained** mode shows the source beside its compaction parent. Reopening source reuses its retained child. File choice, compaction mode, mapped-range position, and scroll position survive navigation, collapse/expand, and workspace save/reload.

Source bytes are fetched from the current project when the pane opens. If the file hash differs from the pinned compaction snapshot, the pane displays current source with a mismatch message and disables range highlights and compaction folds. Missing files offer **Retry**. Workspace exports store the compaction evidence and view state, not a copy of the current source file.

Unlinked selections and diagrams without a projection explain why the action is unavailable. Unsaved scene changes in either open diagram block projection. Saved revisions that differ from the pinned source or target require an updated projection. Historical revisions and their old projection links remain stored.

The selection menu also offers **Copy ASCII + code refs** (**C** or **Ctrl/Cmd+C**). It copies the exact selected rectangle followed by labeled `path:start-end` locations, using the same format as Studio’s reference clipboard. Native text selections and input fields keep their normal copy behavior.

## Stored model

`ProjectRepresentationCatalogRecord.projections` is an optional collection for compatibility with older catalogs. Each `ProjectProjectionRecord` pins both representation IDs and revision IDs, and stores source evidence IDs and target tree node IDs. Tree node IDs are scoped to target revision ID, ASCII hash, and ancestry. They are not shared entity IDs, labels, or mutable row numbers. The target is an ordinary settled project representation (`viewKind: call-graph`, `representationKind: tree`); it appears independently in the explorer. Creating it does not change active-by-kind preferences.

Rendering uses the conventional ASCII tree grammar: an unindented root, `+--` / `\\--` (or backtick) child branches, and optional `|` spacer lines. Put source annotations and descriptions on child branches so they stay with their parent when filtering. Legacy arrow-style branches continue to be supported.

### Call tree -> compaction -> source

An optional `compactionProjection` stores immutable file-tree snapshots (ASCII/hash, source path/hash, and each tree row's source ranges) plus links from pinned call-tree node IDs to exact compaction rows. The second hop uses **matched subtree nodes**, not ancestors inserted solely as display context. It unions exact target rows, preserves original file/tree order, and adds only necessary ancestors. Unlike the first hop, selecting a compaction parent does **not** implicitly include its children.

The displayed file headers identify captured source hashes. These views are pinned snapshots, not claims about currently edited source files. Source ranges remain in the mapping data and are not printed in the ASCII. Import validates snapshot hashes, complete semantic-row source coverage, call-tree node identity, and target row existence before the atomic catalog write.

## Importing generated trees

The generated artifact is `docs/projections/prompt-reference-call-tree.json`. It contains the complete call tree for **Prompt, Reference, Lineage, and Portability**, its source revision identity, and links from source evidence IDs to one-based target label rows. These rows are an import format only: persistence resolves them to revision-scoped tree node IDs.

`node scripts/diagrams/generate-prompt-call-tree.mjs` builds the curated, intermediate-density tree and its second-hop mappings from the seven checked-in compactions. It verifies source hashes and resolves explicit compaction selectors (rejecting missing or ambiguous selectors). It performs no LLM calls and does not import the result automatically. The root and other display-only ancestors do not expand unrelated file content.

```sh
npx tsx scripts/diagrams/import-projection.ts .diagrams-parent-architecture docs/projections/prompt-reference-call-tree.json
```

Alternatively, `POST /api/core/project/projections` accepts that JSON for the server's current project. The server validates all links and writes the target representation, immutable revision, and projection atomically. Reimporting the same artifact is idempotent. Old catalogs load without a migration. New source revisions need a regenerated artifact with the new source revision ID; stale imports are rejected.

For regeneration, `targetRepresentationId` plus `expectedTargetRevisionId` explicitly append a revision to the existing projected tree. The generator uses the existing relationship to fill these fields. Concurrent target changes are rejected; old revisions and projection records remain intact. The original diagram's current revision and active-view preferences are unchanged.

Generated call labels were reviewed against repository source; they are not a static-analysis proof of all possible calls. Data, control conditions, results, and independent entry points are labeled to avoid presenting architectural associations as calls. Selection filtering requires no LLM calls.

## Checks

```sh
npx vitest run domain/core/diagrams/__tests__/diagramProjection.test.ts domain/core/representations/__tests__/compactionProjection.test.ts domain/core/diagrams/__tests__/asciiTree.test.ts domain/core/representations/__tests__/representationIndex.test.ts server/core/diagrams/__tests__/projectProjection.test.ts
npm run build
node tests/browser/mapping/browser-projection-check.mjs
```

The browser check uses a disposable project and actual pointer/keyboard events, not the user's active project.
