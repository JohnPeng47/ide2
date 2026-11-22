## 1. Anchor tree

Source citations are annotations, not separate components. Fields folded into matched parent lines and repeated call-flow descriptions are not counted again. Relocated descendants are scored at their A location and excluded from unmatched nodes at their B location. Offsets measure additional nesting at the relevant match; inherited relocation penalties are not repeated.

- A 3–14 ↔ B 3–17 · same · offset 0 · s = 0.928125 · Workspace and sessions
  - A 4–5 ↔ B 4–6 · summarized · offset 0 · s = 0.9 · Application entry
  - A 6–8 ↔ B 7–11 · same · offset 0 · s = 0.75 · Drafts and registry
    - A 8 ↔ B 8 · same · offset 0 · s = 1 · Controller map
    - unmatched: B 10–11 (commit notifications and dirty-scene tracking)
  - A 9–12 ↔ B 12–17 · same · offset 0 · s = 0.875 · Session stores
    - A 10 ↔ B 13 · same · offset 0 · s = 1 · Store partitions
    - A 11 ↔ B 14 · same · offset 0 · s = 1 · Subscriptions
    - A 12 ↔ B 15 · same · offset 0 · s = 1 · Saved baseline
    - unmatched: B 16–17 (session-local disposal)
  - A 13–14 ↔ B 9 · same · offset 1 · s = 0.9 · Session replacement/removal
- A 16–30 ↔ B 19–42 · same · offset 0 · s = 0.95 · Revision-backed model
  - A 17–22 ↔ B 37–42 · same · offset 0 · s = 0.95 · Diagrams and revisions
    - A 18–19 ↔ B 39 · summarized · offset 0 · s = 0.9 · Structured content
    - A 20–21 ↔ B 41–42 · summarized · offset 0 · s = 0.9 · Revision creation/store wrappers
  - A 23–26 ↔ B 26–29 · same · offset 1 · s = 0.75 · Stored composition
    - A 24 + 25 ↔ B 27 · grouped · offset 0 · s = 1 · Composition and associated state
    - A 26 ↔ B 28 · same · offset 0 · s = 1 · Revision bindings
    - unmatched: B 29 (restoration/identity metadata)
  - A 27–29 ↔ B 33–36 · same · offset 0 · s = 1 · Resolved document
    - A 28 ↔ B 34 · same · offset 0 · s = 1 · Resolved scene contents
- A 32–51 ↔ B 44–63 · same · offset 0 · s = 0.8905 · Semantic controller
  - A 33–37 ↔ B 45–50 · same · offset 0 · s = 1 · Transactional updates
    - A 34 ↔ B 46 · same · offset 0 · s = 1 · Settlement/version checks
    - A 35 + 36 ↔ B 47 + 48 + 49 · grouped · offset 0 · s = 1 · Staged operations
    - A 37 ↔ B 50 · same · offset 0 · s = 1 · Reconciliation/publication
  - A 38–39 ↔ B 51–52 · same · offset 0 · s = 1 · Commit policy
    - A 39 ↔ B 52 · same · offset 0 · s = 1 · Checkpoint advancement
  - A 40–44 ↔ B 20–23 + 24–32 · grouped, relocated to B's history/model branch · offset 0 · s = 0.5 · History service and record
    - A 41 ↔ B 22–23 · same · offset 0 · s = 1 · Context ownership
    - A 42 ↔ B 25 + 30 · grouped · offset 0 · s = 1 · Navigation and retained revisions
    - A 43 + 44 ↔ B 21 · grouped · offset 0 · s = 1 · History API
  - A 45–47 ↔ B 31 · summarized, relocated to B's history/model branch · offset 1 · s = 0.405 · Canvas views
  - A 48–49 ↔ B 53–54 · same · offset 0 · s = 1 · Transfer navigation
    - A 49 ↔ B 54 · same · offset 0 · s = 1 · Workspace coordination
- A 53–69 ↔ B 65–83 · same · offset 0 · s = 0.7945 · Interaction/source inspection
  - A 54–59 ↔ B 56–63 · relocated to B's controller branch · offset 0 · s = 0.445 · tldraw adapter
    - A 55 ↔ B 58 · same · offset 0 · s = 1 · Shape projection
    - A 56–57 ↔ B 57 + 61 · grouped, summarized · offset 0 · s = 0.9 · Live editor state
    - A 58 ↔ B 59 · same · offset 0 · s = 1 · Gesture commits
    - A 59 ↔ B 60 · same · offset 0 · s = 1 · Checkpoint restoration
    - unmatched: B 62–63 (runtime disposal)
  - A 60–61 ↔ B 66–70 · same · offset 0 · s = 1 · Interaction-state partitions
    - A 61 ↔ B 67 + 68 + 69–70 · grouped · offset 0 · s = 1 · Selection/controls/display
  - A 62–65 ↔ B 75–77 · same · offset 0 · s = 0.875 · Source lookup
    - A 63 ↔ B 76–77 · same · offset 0 · s = 1 · Evidence mappings
    - A 65 ↔ B 40 · relocated to B's diagram model · offset 0 · s = 0.5 · Source binding
  - A 66–67 ↔ B 78–83 · same · offset 0 · s = 0.625 · Source/display panes
    - A 67 ↔ B 81 · same · offset 0 · s = 1 · File and definition navigation
    - unmatched: B 79 (pane variants), B 80 (display ownership/removal), B 82–83 (pane view state)
  - unmatched: B 71–74 (revision-pinned region selection)
- A 71–87 ↔ B 85–106 · same · offset 0 · s = 0.921875 · Agent editing
  - A 72–75 ↔ B 86–89 · same · offset 0 · s = 0.9833333333 · Prompt/generation requests
    - A 73 ↔ B 87 + 88–89 · grouped · offset 0 · s = 1 · Request capture/submission
    - A 74 ↔ B 91–92 · summarized · offset 0 · s = 0.9 · Generation
    - A 75 ↔ B 93 · same · offset 0 · s = 1 · Stale-target checks
  - A 76–79 ↔ B 90–96 · same · offset 0 · s = 0.725 · Run ownership/retry
    - A 77 + 79 ↔ B 94–96 · grouped, summarized · offset 0 · s = 0.9 · Run reuse and installation retry
    - unmatched: A 78 (cancellation)
  - A 80–82 ↔ B 97–101 · same · offset 0 · s = 0.6666666667 · Browser command bridge
    - A 81 ↔ B 98 + 99 · grouped · offset 0 · s = 1 · Commands/replies
    - unmatched: A 82 (LiveCanvasService), B 100–101 (bridge cleanup)
  - A 83–85 ↔ B 102–106 · same · offset 0 · s = 1 · Revision receiver
    - A 84 ↔ B 103 · same · offset 0 · s = 1 · Operation application
    - A 85 ↔ B 104 + 105–106 · grouped · offset 0 · s = 1 · Receipts/persistence retries
- A 89–104 ↔ B 108–129 · same · offset 0 · s = 0.9366666667 · Persistence/publication
  - A 90–93 ↔ B 109–113 · same · offset 0 · s = 0.9683333333 · Incremental persistence
    - A 91 ↔ B 110 · same · offset 0 · s = 1 · Cursors
    - A 92 ↔ B 111 · same · offset 0 · s = 1 · Record families
    - A 93 ↔ B 114–118 · summarized · offset 1 · s = 0.81 · Storage/worker transport
  - A 94–97 ↔ B 119–123 · same · offset 0 · s = 1 · Server record store
    - A 95 + 96 ↔ B 120 + 121 · grouped · offset 0 · s = 1 · Batch validation/receipts
    - A 97 ↔ B 122–123 · same · offset 0 · s = 1 · Atomic manifest storage
  - A 98–100 ↔ B 124–129 · same publication boundary · offset 0 · s = 0.625 · Explicit publication
    - A 100 ↔ B 126 · same · offset 0 · s = 1 · Publication operation
    - unmatched: A 99 (server checkpoint capture), B 125 (client synchronization), B 127–129 (acknowledged baseline updates)
  - A 101 ↔ B 112–113 · same lifecycle boundary · offset 1 · s = 0.9 · Persistence lifecycle

## 2. Score

Each child J uses the sum of its pair scores divided by anchored plus unmatched nodes. Each parent uses 0.9^offset × (0.5 + 0.5 × inner), halved for relocation.

Top-level scores:

- Workspace: inner 0.85625 → s = 0.928125.
- Revision model: inner 0.9 → s = 0.95.
- Controller: inner 0.781 → s = 0.8905.
- Interaction/source inspection: inner 0.589 → s = 0.7945.
- Agent editing: inner 0.84375 → s = 0.921875.
- Persistence/publication: inner 0.8733333333 → s = 0.9366666667.

J = (0.928125 + 0.95 + 0.8905 + 0.7945 + 0.921875 + 0.9366666667) / (6 + 0 + 0) = 5.4216666667 / 6 = **0.9036111111**.

## 3. Verdict

The trees identify substantially the same workspace, revision model, controller, editor/source tooling, agent editing and persistence boundaries. The largest structural differences are ownership placements: B places history and named views under its canonical-model branch, and the editor adapter under the controller. B also expands selection, display ownership and worker behavior; A separately identifies cancellation and LiveCanvasService. Publication shares an operation but exposes different internals: A emphasizes server capture, B client synchronization and acknowledgement. Grouped matches make explicit the implied parents for composition state, history service/records, staged operations and request-retry handling. Repository checks established the revision-wrapper and publication-operation connections; no correctness or completeness penalty was applied.
