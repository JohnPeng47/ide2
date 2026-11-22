## 1. Anchor tree

Source-only lines are annotations, not additional components. Inline descriptions are credited at their enclosing anchor: for example, B's draft metadata matches A's metadata on line 7, and A's diagram identities match B's line 17. Relocated descendants are counted only where assigned below, not again inside their enclosing B ranges. Offsets measure structural depth differences; relocation means a different top-level owner.

- A 3–17 ↔ B 3–14 · same · offset 0 · s = 0.952778 · Workspace/session ownership
  - A 4–6 ↔ B 4–5 · summarized · offset 0 · s = 0.9 · Application entry
  - A 7–11 ↔ B 6–8 + 13–14 · grouped · offset 0 · s = 0.816667 · Draft ownership and lifecycle
    - A 8 ↔ B 8 · same · offset 0 · s = 1 · Controller index
    - A 9 + 16–17 ↔ B 13–14 · grouped · offset 1 · s = 0.9 · Session lifecycle
    - unmatched: A 10–11 (commit/persistence notifications and dirty scenes)
  - A 12–17 ↔ B 9–12 · same · offset 0 · s = 1 · Session state
    - A 13 ↔ B 10 · same · offset 0 · s = 1 · Stores
    - A 14 ↔ B 11 · same · offset 0 · s = 1 · Notifications
    - A 15 ↔ B 12 · same · offset 0 · s = 1 · Baseline/dirty state
- A 19–42 ↔ B 16–30 · same · offset 0 · s = 0.856354 · Revision/checkpoint model
  - A 20–23 ↔ B 40–44 · relocated to controller · offset 0 · s = 0.5 · CanvasHistoryService
    - A 21 ↔ B 43 + 44 · grouped · offset 0 · s = 1 · History operations
    - A 22–23 ↔ B 41 · same · offset 0 · s = 1 · Context handles
  - A 24–32 ↔ B 23–26 · same · offset 0 · s = 0.800833 · Stored composition/checkpoints
    - A 25 + 30 ↔ B 42 · grouped, relocated to controller/history service · offset 0 · s = 0.5 · History header and revisions
    - A 26–29 ↔ B 24 + 25 + 26 · grouped, summarized · offset 0 · s = 0.9 · Snapshot composition/bindings
    - A 31–32 ↔ B 45–47 · summarized, relocated to controller · offset 1 · s = 0.405 · CanvasViews
  - A 33–36 ↔ B 27–29 · same · offset 0 · s = 0.666667 · Resolved document
    - A 34 ↔ B 28 · same · offset 0 · s = 1 · Scene contents
    - unmatched: A 35–36 (resolved presentation/review fields), B 29 (explicit consumer grouping)
  - A 37–42 ↔ B 17–22 · same · offset 0 · s = 0.883333 · Diagram content/revisions
    - A 39 ↔ B 18–19 · summarized · offset 0 · s = 0.9 · DiagramContent
    - A 40 ↔ B 65 · relocated to presentation/source inspection · offset 0 · s = 0.5 · Source binding
    - A 41–42 ↔ B 20–21 · summarized · offset 0 · s = 0.9 · Revision creation/retention
- A 44–63 ↔ B 32–51 · same · offset 0 · s = 0.930625 · Semantic controller
  - A 45–50 ↔ B 33–37 · same · offset 0 · s = 1 · Transactions
    - A 46 ↔ B 34 · same · offset 0 · s = 1 · Settlement/version guard
    - A 47 + 48 + 49 ↔ B 35 + 36 · grouped · offset 0 · s = 1 · Operation families
    - A 50 ↔ B 37 · same · offset 0 · s = 1 · Reconciliation/validation
  - A 51–52 ↔ B 38–39 · same · offset 0 · s = 1 · Controller updates
    - A 52 ↔ B 39 · same · offset 0 · s = 1 · Recorded/transient distinction
  - A 53–55 ↔ B 48–49 · same · offset 0 · s = 1 · Transfer navigation
    - A 54 ↔ B 49 · same · offset 0 · s = 1 · Coordinated undo
  - A 56–63 ↔ B 54–59 · relocated to presentation · offset 0 · s = 0.445 · Editor adapter
    - A 57 + 61 ↔ B 56–57 · grouped, summarized · offset 0 · s = 0.9 · Native editor ownership
    - A 58 ↔ B 55 · same · offset 0 · s = 1 · Shape projection
    - A 59 ↔ B 58 · same · offset 0 · s = 1 · Gesture settlement
    - A 60 ↔ B 59 · same · offset 0 · s = 1 · Checkpoint restoration
    - unmatched: A 62–63 (runtime disposal)
- A 65–83 ↔ B 53–69 · same · offset 0 · s = 0.804375 · Selection/presentation/source inspection
  - A 66–70 ↔ B 61 · summarized · offset 1 · s = 0.81 · MappingCanvasState
  - A 75–77 ↔ B 62–65 · same · offset 0 · s = 1 · Source mappings
    - A 76–77 ↔ B 63 + 64 · grouped · offset 0 · s = 1 · Evidence/range entries
  - A 78–83 ↔ B 66–67 · same · offset 0 · s = 0.625 · Source-pane presentation
    - A 81 ↔ B 67 · same · offset 0 · s = 1 · Repository access
    - unmatched: A 79 (pane variants), A 80 (display removal/edges), A 82–83 (SourcePaneViewState)
  - unmatched: A 71–74 (revision-pinned region selection)
- A 85–106 ↔ B 71–87 · same · offset 0 · s = 0.938333 · Agent editing
  - A 86–89 + 90–96 ↔ B 72–75 + 76–79 · grouped · offset 0 · s = 0.88 · Request/generation lifecycle
    - A 87 + 93 ↔ B 75 · grouped · offset 0 · s = 1 · Captured-version protection
    - A 88–89 ↔ B 77 · same · offset 0 · s = 1 · Request identity
    - A 91–92 ↔ B 73 + 74 · grouped, summarized · offset 0 · s = 0.9 · Generation inputs/results
    - A 94–96 ↔ B 79 · summarized · offset 0 · s = 0.9 · Installation acknowledgement
    - unmatched: B 78 (cancellation)
  - A 97–101 ↔ B 80–82 · same · offset 0 · s = 0.75 · Canvas bridge
    - A 98 + 99 + 100–101 ↔ B 81 · grouped · offset 0 · s = 1 · Browser command handling
    - unmatched: B 82 (LiveCanvasService)
  - A 102–106 ↔ B 83–85 · same · offset 0 · s = 1 · Revision receiver
    - A 103 ↔ B 84 · same · offset 0 · s = 1 · Controller application
    - A 104 + 105–106 ↔ B 85 · grouped · offset 0 · s = 1 · Receipt/flush retry
- A 108–129 ↔ B 89–104 · same · offset 0 · s = 0.927292 · Persistence/publication
  - A 109–113 ↔ B 90–93 · same · offset 0 · s = 0.983333 · WorkspacePersistence
    - A 110 ↔ B 91 · same · offset 0 · s = 1 · Cursors
    - A 111 ↔ B 92 · same · offset 0 · s = 1 · Record families
    - A 112–113 ↔ B 101 · same · offset 1 · s = 0.9 · Persistence lifecycle
  - A 114–118 ↔ B 93 · summarized · offset 1 · s = 0.81 · Storage worker
  - A 119–123 ↔ B 94–97 · same · offset 0 · s = 1 · WorkspaceRecordStore
    - A 120 + 121 ↔ B 95 + 96 · grouped · offset 0 · s = 1 · Batch validation/receipts
    - A 122–123 ↔ B 97 · same · offset 0 · s = 1 · Atomic manifest
  - A 124–129 ↔ B 98–100 · same · offset 0 · s = 0.625 · Checkpoint publication
    - A 126 ↔ B 100 · same · offset 0 · s = 1 · Pinned publication
    - unmatched: A 125 (client flush/version verification), A 127–129 (acknowledged baseline), B 99 (server capture)

## 2. Score

Each child level uses J = sum(s)/(k + uA + uB). Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner) × relocation factor. For example, CanvasViews scores 0.9 × 0.9 × 0.5 = 0.405. The editor adapter has inner J = (0.9 + 1 + 1 + 1)/5 = 0.78, hence s = (0.5 + 0.5 × 0.78) × 0.5 = 0.445.

Top-level scores:

| Anchor | Inner J | s |
|---|---:|---:|
| Workspace/session | 0.905555556 | 0.952777778 |
| Revision/checkpoint model | 0.712708333 | 0.856354167 |
| Controller | 0.861250000 | 0.930625000 |
| Selection/source inspection | 0.608750000 | 0.804375000 |
| Agent editing | 0.876666667 | 0.938333333 |
| Persistence/publication | 0.854583333 | 0.927291667 |

There are six top-level anchors and no unmatched top-level components:

J = (0.952777778 + 0.856354167 + 0.930625000 + 0.804375000 + 0.938333333 + 0.927291667)/(6 + 0 + 0) = 5.409756944/6 = **0.901626157**.

## 3. Verdict

The trees identify substantially the same workspace, revision model, controller, source-inspection, agent-editing and persistence components. Their largest structural differences are ownership choices: B places history services and CanvasViews under the controller, and the editor adapter under presentation. A gives selection, display ownership and client publication acknowledgement more detail; B separately identifies cancellation, LiveCanvasService and server checkpoint capture. Grouped matches expose implied parents for session lifecycle, staged operation families, snapshot composition and the prompt/generation lifecycle. These are representation differences, not judgments about repository correctness or completeness.
