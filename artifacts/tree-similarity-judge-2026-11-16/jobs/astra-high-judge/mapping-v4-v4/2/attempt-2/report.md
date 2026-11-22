## 1. Anchor tree

Citation-only lines are included in ranges but are not separate components. Facts folded into a matched parent line are absorbed there. Extracted or relocated descendants are counted only at their listed match, not again inside overlapping ancestor ranges. Offsets describe additional nesting after the matched parent scopes are aligned.

- A 3–17 ↔ B 3–14 · same · offset 0 · s = 0.918750 · Workspace/session ownership
  - A 4–6 ↔ B 4–5 · summarized · offset 0 · s = 0.900000 · Application entry
  - A 7–11 ↔ B 6–8 + 13–14 · grouped · offset 0 · s = 0.737500 · Draft ownership/lifecycle
    - A 8 ↔ B 8 · same · offset 0 · s = 1 · Controller registry
    - A 9 ↔ B 13–14 · same · offset 1 · s = 0.9 · Session replacement/removal
    - unmatched: A 10–11 (commit notification/dirtyScenes), B 7 (metadata-field breakdown)
  - A 12–17 ↔ B 9–12 · same · offset 0 · s = 0.875000 · CanvasSession
    - A 13 ↔ B 10 · same · offset 0 · s = 1 · Readable stores
    - A 14 ↔ B 11 · same · offset 0 · s = 1 · Semantic notifications
    - A 15 ↔ B 12 · same · offset 0 · s = 1 · Dirty baseline
    - unmatched: A 16–17 (cursor-copy cleanup)
- A 19–42 ↔ B 16–30 · same · offset 0 · s = 0.814167 · Revision-backed model/history
  - A 20–23 ↔ B 40–44 · relocated to B's controller · offset 0 · s = 0.500000 · History service
    - A 21 ↔ B 43 + 44 · grouped · offset 0 · s = 1 · History operations/persistence
    - A 22–23 ↔ B 41 · same · offset 0 · s = 1 · Context handles
  - A 24–32 ↔ B 23–26 + 42 + 45–47 · grouped, partly relocated to B's controller · offset 0 · s = 0.463333 · Checkpoint representation
    - A 25 + 30 ↔ B 42 · grouped · offset 0 · s = 1 · History header/revisions
    - A 26–29 ↔ B 23–26 · same · offset 1 · s = 0.750000 · Stored composition/bindings
      - A 27 ↔ B 24 + 25 · grouped · offset 0 · s = 1 · CanvasDocument
      - A 28 ↔ B 26 · same · offset 0 · s = 1 · Revision bindings
      - unmatched: A 29 (restoration/identity metadata)
    - A 31–32 ↔ B 45–47 · summarized · offset 1 · s = 0.810000 · CanvasViews
  - A 33–36 ↔ B 27–29 · same · offset 0 · s = 0.666667 · Resolved projection
    - A 34 ↔ B 28 · same · offset 0 · s = 1 · Scene contents
    - unmatched: A 35–36 (resolved presentation/review fields), B 29 (consumer enumeration)
  - A 37–42 ↔ B 17–22 · same · offset 0 · s = 0.883333 · Diagram/revisions
    - A 39 ↔ B 18–19 · summarized · offset 0 · s = 0.9 · DiagramContent
    - A 40 ↔ B 65 · relocated to B's source-inspection branch · offset 0 · s = 0.5 · Source binding
    - A 41–42 ↔ B 20–21 · summarized · offset 0 · s = 0.9 · Revision construction
- A 44–63 ↔ B 32–51 · same · offset 0 · s = 0.915000 · Semantic controller
  - A 45–50 ↔ B 33–37 · same · offset 0 · s = 0.875000 · Versioned transactions
    - A 46 ↔ B 34 · same · offset 0 · s = 1 · Gesture settlement/version check
    - A 48 + 49 ↔ B 35 + 36 · grouped · offset 0 · s = 1 · Operation families
    - A 50 ↔ B 37 · same · offset 0 · s = 1 · Reconcile/validate/publish
    - unmatched: A 47 (cloned-state staging)
  - A 51–52 ↔ B 38–39 · same · offset 0 · s = 1 · Recorded/transient updates
    - A 52 ↔ B 39 · same · offset 0 · s = 1 · Checkpoint policy
  - A 53–54 ↔ B 48–49 · same · offset 0 · s = 1 · Transfer navigation
    - A 54 ↔ B 49 · same · offset 0 · s = 1 · Coordinated transfer undo
  - A 56–63 ↔ B 54–59 · relocated to B's presentation branch · offset 0 · s = 0.445000 · Editor adapter
    - A 57 + 61 ↔ B 56–57 · grouped, summarized · offset 0 · s = 0.9 · Editor-owned interaction
    - A 58 ↔ B 55 · same · offset 0 · s = 1 · Shape projection
    - A 59 ↔ B 58 · same · offset 0 · s = 1 · Gesture commit
    - A 60 ↔ B 59 · same · offset 0 · s = 1 · Checkpoint restoration
    - unmatched: A 62–63 (runtime disposal)
- A 65–83 ↔ B 53–69 · same · offset 0 · s = 0.804375 · Selection/source inspection
  - A 66–70 ↔ B 61 · summarized · offset 1 · s = 0.810000 · MappingCanvasState
  - A 75–77 ↔ B 62–65 · same · offset 0 · s = 1 · Source-evidence lookup
    - A 76–77 ↔ B 63 · same · offset 0 · s = 1 · Entity/range join
  - A 78–83 ↔ B 66–67 · same · offset 0 · s = 0.625000 · Source-linked panes
    - A 81 ↔ B 67 · same · offset 0 · s = 1 · Repository reads/definitions
    - unmatched: A 79 (display variants), A 80 (recursive removal), A 82–83 (pane view state)
  - unmatched: A 71–74 (revision-pinned region selection)
- A 85–106 ↔ B 71–87 · same · offset 0 · s = 0.938333 · Agent edits
  - A 86–89 + 90–96 ↔ B 72–75 + 76–79 · grouped · offset 0 · s = 0.880000 · Prompt/run orchestration
    - A 87 + 88–89 ↔ B 73 · grouped · offset 0 · s = 1 · Pinned request
    - A 91–92 ↔ B 74 · summarized · offset 0 · s = 0.9 · Generation
    - A 93 ↔ B 75 · same · offset 0 · s = 1 · Stale-target checks
    - A 94–96 ↔ B 79 · summarized · offset 0 · s = 0.9 · Uncertain installation/retry
    - unmatched: B 78 (cancellation)
  - A 97–101 ↔ B 80–82 · same · offset 0 · s = 0.750000 · Browser bridge
    - A 98 + 99 + 100–101 ↔ B 81 · grouped · offset 0 · s = 1 · Command/lifecycle handling
    - unmatched: B 82 (LiveCanvasService)
  - A 102–106 ↔ B 83–85 · same · offset 0 · s = 1 · Revision receiver
    - A 103 ↔ B 84 · same · offset 0 · s = 1 · Controller application
    - A 104 + 105–106 ↔ B 85 · grouped · offset 0 · s = 1 · Receipt and flush retry
- A 108–129 ↔ B 89–104 · same · offset 0 · s = 0.795278 · Persistence/publication boundaries
  - A 109–113 ↔ B 90–93 · same · offset 0 · s = 1 · WorkspacePersistence
    - A 110 ↔ B 91 · same · offset 0 · s = 1 · Cursors
    - A 111 ↔ B 92 · same · offset 0 · s = 1 · Record categories
  - A 114–118 ↔ B 93 · summarized · offset 1 · s = 0.81 · Storage transport
  - A 119–123 ↔ B 94–97 · same · offset 0 · s = 0.833333 · WorkspaceRecordStore
    - A 120 ↔ B 95 + 96 · grouped · offset 0 · s = 1 · Revision/receipt checks
    - A 122–123 ↔ B 97 · same · offset 0 · s = 1 · Atomic content-addressed storage
    - unmatched: A 121 (immutable-record validation)
  - A 112–113 + 117–118 ↔ B 101 · grouped · offset 1 · s = 0.9 · Persistence cleanup
  - unmatched: A 124–129 (browser save/capture/baseline owner), B 98–100 (server publication/capture owner)

## 2. Score

Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner) × relocation factor. Grouped unions count once. For example, checkpoint representation has inner = (1 + 0.75 + 0.81)/3 = 0.853333, giving s = (0.5 + 0.5 × 0.853333) × 0.5 = 0.463333.

Top-level contributions:

| Anchor | Inner J | s |
|---|---:|---:|
| Workspace/session | 0.837500 | 0.918750 |
| Revision model/history | 0.628333 | 0.814167 |
| Controller | 0.830000 | 0.915000 |
| Selection/source inspection | 0.608750 | 0.804375 |
| Agent edits | 0.876667 | 0.938333 |
| Persistence/publication | 0.590556 | 0.795278 |

J = (0.918750 + 0.814166667 + 0.915000 + 0.804375 + 0.938333333 + 0.795277778) / (6 + 0 + 0) = 5.185902778 / 6 = **0.864317130**. Calculations use unrounded values.

## 3. Verdict

The trees identify substantially the same workspace, revision model, controller, editor adapter, source inspection, agent-edit path and record persistence. Their principal structural differences are ownership placement: B puts history and named views under the controller, the editor adapter under presentation, and source binding under inspection. A gives more detail to region selection, display ownership, cleanup and storage retries; B adds cancellation and LiveCanvasService.

Grouping also differs. B leaves a unified checkpoint-representation parent implied across composition, history records and views; A leaves B's MappingCanvas presentation wrapper implied. Prompt/run orchestration and persistence lifecycle are shared groupings assembled from multiple nodes. Finally, the explicit-save branches name different code owners: A describes browser capture and acknowledged baseline updates, while B describes server publication and persisted checkpoint capture. Their connection is not treated as code identity.
