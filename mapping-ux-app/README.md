# Mapping UX app

Standalone copy of **Mapping screen architecture**, including its implementation
call tree, projected compactions, and source-file windows, from
`http://127.0.0.1:5177/mapping?diagram=representation-9044402993fccf94debfaa08a438e767`.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5187/mapping?diagram=representation-9044402993fccf94debfaa08a438e767.
`npm run build` checks types and creates a production build; `npm run preview` serves it.

Use **Copy ASCII + code refs** in the selection menu (**C** or **Ctrl/Cmd+C**)
to copy the selected rectangle with its labeled source locations.

Select mapped text and press **N** to open the implementation tree, then choose
**Open compaction** and **Open source**. The source window uses Shiki, highlights
exact projected ranges, and displays compaction overlays above those ranges.
File selection, range navigation, pane breadcrumbs, and Escape work locally.
The source window stays aligned with the underlying stack at a 24-pixel offset.
Hold the middle mouse button and drag anywhere over the canvas or its open panes
to pan the main canvas; ordinary clicks and source scrolling still operate the panes.

The explorer includes the selected diagram and its linked implementation tree.
Selection, pan/zoom, grouping, collapse, movement, undo/redo, conversation layouts,
verbosity, and New/Save use the latest Mapping components. Studio and Experiments
remain disabled. Chat and prompt/edit/generation provide labeled deterministic
demo responses; no LLM or original server is contacted.

The bundle contains two representations, three revisions, one projection, and
nine full source snapshots, including all compaction mappings and evidence.
The selection-canvas snapshot was recovered from the version preceding the
source-window edits and verified against its original SHA-256. All nine files
match the projection's captured hashes, so source highlights stay correctly aligned.
The source snapshots describe the captured implementation; the running UI includes
the newer source-window feature.

Saved revisions live in this origin's localStorage under
`mapping-ux-app:project:v2:<diagram-id>:<seed-revision-id>`. Earlier v1 saves remain
untouched. Chats, undo history, and viewport state are temporary.

- `data/project-snapshot.json`: the scoped project, representations, revisions, evidence, and projections.
- `data/source-files.json`: complete source files with original line numbers and hashes.
- `data/extraction.json`: source URL, diagram IDs, and source-snapshot provenance.
- `data/original-file-hashes.json`: hashes of the main app modules copied for this update.

```sh
npm run check:data
npm run build
npm run check:browser
```

The data check verifies snapshot hashes and every source range. The browser check
uses a disposable browser profile and server to exercise projections, source
highlighting, stacked navigation, demo chat, editing, and save/reload. It asserts
that the standalone app makes no API calls or requests to the original server.
Set `COMPARE_ORIGINAL=1` to additionally compare appearance and the first projection
with the source URL while that server is running.
