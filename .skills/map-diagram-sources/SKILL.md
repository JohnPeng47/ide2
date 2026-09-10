---
name: map-diagram-sources
description: Import an ASCII diagram into this app's Mapping canvas with selective code-entity mappings, generate current per-file source compactions, and connect a derived implementation tree through revision-pinned projections.
---

# Map a diagram to source

Use this workflow for a request such as: “Import this tree into Mapping, map some nodes to code, generate the referenced source compactions, and let me project selections into them.” Preserve the supplied ASCII and choose a useful subset of implemented nodes. Do not invent source evidence for conceptual, obsolete, or unmapped labels.

## Inspect and prepare

1. Identify the intended running project's URL and repository using `GET /api/core/project/representations`. Do not infer the project from whichever server responds first.
2. Read the relevant implementation and sample existing compactions in `docs/compactions/`. Inspect `src/core/diagramProjection.ts`, `src/core/compactionProjection.ts`, and `docs/diagram-projections.md` for current projection semantics.
3. Map selected labels to precise, one-based inclusive source ranges. Verify the region implements what the diagram node describes: a UI wrapper belongs to its rendered JSX, not a similarly named calculation. Conceptual labels need not be standalone component symbols. Keep every unselected label in the ASCII. Mapping currently creates selectable overlays only for mapped labels; unmapped text has no evidence-backed selection.
4. Generate one ASCII compaction plus a JSON source map per referenced file. Include its source path, SHA-256 of the exact source bytes, and exactly one mapping for every semantic tree row, including the root. Coordinates belong in JSON, outside the tree. Validate coverage, source bounds, printable ASCII, and fresh hashes. Prefer meaningful structural/behavioral summaries; identify automatically generated declaration outlines as such.
5. Build a derived tree and two explicit link sets: source evidence to derived tree rows, then derived tree rows to exact compaction rows. Use a structural implementation tree when relationships are containment or handler ownership; do not imply a verified runtime call graph.

The reproducible example is `docs/mapping-screen/prepare.ts`, with the supplied tree in `diagram.txt`. It generates declaration compactions enriched with selected behavior summaries. Adapt its selection list and summaries for another diagram; do not silently overwrite this example.

## Persist using the existing APIs

When the user requests import, perform it without an extra permission round. If they request preparation only, stop at the reviewable bundle.

- `POST /api/studio/diagram-sets` with `creationMode: "materialized"`, repository `path`, named `codeEntities`, and the ASCII `diagrams`. Mapping entries use `entityKey`, `sourceRangeKey`, `line`, `startColumn`, and `endColumn`. Parse the NDJSON `result` event and retain its IDs.
- `POST /api/studio/project/representations/promote` with `diagramSetId`, `diagramId`, and `makeActive: false`. Find the new project revision by its provenance.
- `POST /api/mapping/diagrams` with that `representationId`, `expectedRevisionId`, `projectId`, `name`, and `sceneFromRevision(revision)`. This stores an editable Mapping canvas while preserving source evidence. Plain new-canvas creation cannot introduce arbitrary evidence records.
- Resolve entity handles to **the saved project revision's evidence IDs**. Then `POST /api/core/project/projections` with `sourceRepresentationId`, `sourceRevisionId`, `name`, `ascii`, and `links: [{sourceEvidenceIds, targetLines}]`. Include `compactionProjection: {files, links: [{callTreeLine, file, treeLines}]}`. Each file contains `sourceFile`, `sourceSha256`, `ascii`, `asciiSha256`, and `mappings: [{treeLine, sourceRanges: [{startLine, endLine}]}]`.

Save the canvas before generating its projection. Source and target revisions are pinned: later edits require regenerating the projection. Target row numbers are resolved into immutable node IDs at import. First-hop links match any selected evidence ID and expand target subtrees; the second hop includes exact linked rows plus necessary ancestors, not all descendants. Display-only ancestors must not add unrelated compactions.

For an explicit correction to the Mapping screen example, `docs/mapping-screen/refresh.ts` promotes fresh evidence into the existing representation with `expectedRevisionId`, preserves its canvas layout, and rebuilds the existing projection target. It retains historical revisions and journals mutations separately. Existing chats retain frozen source context; a new conversation is needed to use the corrected mapping.

Keep a receipt after each successful mutation so an interrupted import can resume. If an outcome is ambiguous, inspect the catalog/provenance before retrying creation. Use the HTTP API against a running store; do not bypass its catalog write queue with direct file writes. Projection snapshots are distinct from the separate Core corpus-compaction catalog; do not overwrite its active records merely to attach projection snapshots.

## Verify and report

Verify that saved ASCII still matches the supplied text, only intended labels have mappings, evidence ranges match current files, and each mapping resolves to the intended compaction rows. In a real browser, select a mapped label, press **N**, open **compaction**, close, and reload. Use read-only interactions for an actual import; use disposable projects for destructive tests. Report the Mapping URL, mapped-node/file counts, generated artifacts, and any preserved obsolete labels.

Example preparation and import (the explicit URL chooses the project):

```sh
npx tsx docs/mapping-screen/prepare.ts
npx tsx docs/mapping-screen/import.ts http://127.0.0.1:5177
```
