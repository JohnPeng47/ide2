## 1. Anchor tree

Source citations and call-flow annotations are not separate components. Facts folded into a matched parent are counted there. Offsets measure additional nesting relative to the enclosing match. Enclosing ranges retain their full subtrees, but extracted or relocated components are scored only once. In particular, B's document models, revision-store API, transfer navigation and editor runtime are excluded from their enclosing comparisons when matched separately below.

- A 3–14 + 16–28 ↔ B 3–17 · grouped · offset 0 · s = 0.958958333 · Application and live workspace ownership
  - A 5–6 + 7–8 ↔ B 4–6 · grouped · offset 0 · s = 1 · Entry and service injection
    - A 6 + 8 ↔ B 5–6 · grouped · offset 0 · s = 1 · Default surface and services
  - A 9–14 ↔ B 7–11 · same · offset 0 · s = 1 · CanvasWorkspace
    - A 11 + 14 ↔ B 9 · grouped · offset 0 · s = 1 · Session lifecycle
    - A 13 ↔ B 10–11 · same · offset 0 · s = 1 · Persistence notifications
  - A 16–28 ↔ B 12–17 · same · offset 1 · s = 0.75375 · CanvasSession
    - A 18 + 25–26 ↔ B 14 · grouped, summarized · offset 0 · s = 0.9 · Controller subscription
    - A 20–24 ↔ B 13 · summarized · offset 0 · s = 0.9 · Observable stores
    - A 27–28 ↔ B 15 · summarized · offset 0 · s = 0.9 · Saved baseline
    - unmatched: B 16–17 (session-internal disposal)
- A 30–55 ↔ B 65–83 · same · offset 0 · s = 0.724305556 · Document, interaction and source models
  - A 31–37 ↔ B 33–36 · relocated to B history · offset 0 · s = 0.475 · MappingGridDocument
    - A 32–34 ↔ B 34 · summarized · offset 0 · s = 0.9 · Scene composition
    - A 35 + 36–37 ↔ B 35–36 · grouped, summarized · offset 0 · s = 0.9 · Connections and revision choices
  - A 39–46 ↔ B 37–42 · relocated to B history · offset 0 · s = 0.483333333 · Diagram
    - A 40 ↔ B 38 · same · offset 0 · s = 1 · Identities
    - A 41–42 ↔ B 39 · summarized · offset 0 · s = 0.9 · Parsed content
    - A 43–44 ↔ B 40 · summarized · offset 0 · s = 0.9 · Source context
  - A 48–55 ↔ B 66–70 · same · offset 0 · s = 0.833333333 · MappingCanvasState
    - A 49 ↔ B 67 + 68 · grouped · offset 0 · s = 1 · Selection and controls
    - A 50 ↔ B 69–70 · same · offset 0 · s = 1 · Display state
    - unmatched: A 51–55 (visible-scene projection and folding)
  - A 45–46 ↔ B 75–77 · same · offset 1 · s = 0.9 · Diagram source queries
    - A 46 ↔ B 76–77 · same · offset 0 · s = 1 · Evidence joins
  - unmatched: B 71–74 (revision-pinned region selections), B 78–83 (pane ownership and source-code exploration)
- A 57–75 ↔ B 44–63 · same · offset 0 · s = 0.811111111 · MappingDocumentController
  - A 61–72 ↔ B 45–50 · same · offset 0 · s = 0.966666667 · Versioned updates
    - A 62 + 63 ↔ B 46 · grouped · offset 0 · s = 1 · Settlement and version guard
    - A 64–67 ↔ B 47 + 48 + 49 · grouped, summarized · offset 0 · s = 0.9 · Operation staging
    - A 68–72 ↔ B 50 · summarized · offset 0 · s = 0.9 · Snapshot commit
  - A 73 ↔ B 51–52 · summarized · offset 0 · s = 0.9 · Transient updates
  - unmatched: A 74–75 (derived read boundaries)
- A 77–95 ↔ B 19–42 · same · offset 0 · s = 0.8805 · CanvasHistoryService
  - A 79–80 ↔ B 20–23 · same · offset 0 · s = 1 · Editing contexts
    - A 80 ↔ B 22–23 · same · offset 0 · s = 1 · Viewer isolation
  - A 81–88 ↔ B 24–32 · same · offset 0 · s = 1 · CanvasHistoryRecord
    - A 82 ↔ B 25 · same · offset 0 · s = 1 · Navigation state
    - A 83–86 ↔ B 26–29 · same · offset 0 · s = 1 · StoredCanvasSnapshot
      - A 84 ↔ B 27 · same · offset 0 · s = 1 · Document composition
      - A 85 ↔ B 28 · same · offset 0 · s = 1 · Revision bindings
      - A 86 ↔ B 29 · same · offset 0 · s = 1 · Restoration metadata
    - A 87 ↔ B 30 · same · offset 0 · s = 1 · Retained revisions
    - A 88 ↔ B 31–32 · same · offset 0 · s = 1 · Named views
  - A 90–91 ↔ B 41–42 · relocated under B Diagram, summarized · offset 1 · s = 0.405 · Revision storage
  - A 89 + 92 ↔ B 21 · grouped · offset 1 · s = 0.9 · Resolution and navigation API
  - A 93–95 ↔ B 53–54 · relocated to B controller · offset 0 · s = 0.5 · Transfer navigation
    - A 94–95 ↔ B 54 · same · offset 0 · s = 1 · Linked workspace undo
- A 97–109 ↔ B 56–63 · same, nested under B controller · offset 1 · s = 0.864 · Editor runtime
  - A 100–101 ↔ B 58 · summarized · offset 0 · s = 0.9 · Shape projection
  - A 102–103 ↔ B 57 + 61 · grouped, summarized · offset 0 · s = 0.9 · Native interaction ownership
  - A 104–105 ↔ B 59 · summarized · offset 0 · s = 0.9 · Gesture settlement
  - A 106–108 ↔ B 60 · summarized · offset 0 · s = 0.9 · Checkpoint restoration
  - A 109 ↔ B 62–63 · same · offset 0 · s = 1 · Disposal
- A 111–128 ↔ B 85–106 · same · offset 0 · s = 0.941666667 · Agent-assisted editing
  - A 112–116 ↔ B 86–89 · same · offset 0 · s = 0.975 · PromptComposerCoordinator
    - A 114 ↔ B 87 · same · offset 0 · s = 1 · Captured target
    - A 115–116 ↔ B 88–89 · summarized · offset 0 · s = 0.9 · Pinned request lifecycle
  - A 117–120 ↔ B 90–96 · same · offset 0 · s = 0.725 · DiagramEditService
    - A 118 ↔ B 94–96 · summarized · offset 0 · s = 0.9 · Run installation and outcomes
    - A 119 ↔ B 91–92 · summarized · offset 0 · s = 0.9 · Generation inputs
    - unmatched: A 120 (canvas port), B 93 (service-side stale-target validation)
  - A 121–123 ↔ B 97–101 · same · offset 0 · s = 0.833333333 · Command bridge
    - A 122 ↔ B 98 · same · offset 0 · s = 1 · Browser command handling
    - A 123 ↔ B 100–101 · same · offset 0 · s = 1 · Polling cleanup
    - unmatched: B 99 (backend pending replies and timeout)
  - A 124–128 ↔ B 102–106 · same · offset 0 · s = 1 · DiagramRevisionReceiver
    - A 126 ↔ B 103 · same · offset 0 · s = 1 · Versioned application
    - A 127 ↔ B 104 · same · offset 0 · s = 1 · Request receipts
    - A 128 ↔ B 105–106 · same · offset 0 · s = 1 · Persistence acknowledgement
- A 130–149 ↔ B 108–129 · same · offset 0 · s = 0.770833333 · Workspace persistence
  - A 134–138 ↔ B 109–113 · same · offset 0 · s = 0.725 · WorkspacePersistence
    - A 136 + 137–138 ↔ B 110 + 111 · grouped, summarized · offset 0 · s = 0.9 · Record deltas
    - unmatched: B 112–113 (record removal and subscription disposal)
  - A 139–144 ↔ B 114–118 · same · offset 0 · s = 1 · Storage worker
    - A 141 + 142 ↔ B 115 · grouped · offset 0 · s = 1 · Optimistic batches
    - A 144 ↔ B 116 + 117–118 · grouped · offset 0 · s = 1 · Flush and disposal
  - A 145–149 ↔ B 119–123 · same · offset 0 · s = 0.983333333 · WorkspaceRecordStore
    - A 146 ↔ B 120 · same · offset 0 · s = 1 · Receipt and revision checks
    - A 147 ↔ B 121 · same · offset 0 · s = 1 · Immutable-record validation
    - A 148–149 ↔ B 122–123 · summarized · offset 0 · s = 0.9 · Atomic manifest publication
  - unmatched: A 131–133 (startup restoration), B 124–129 (explicit catalog publication)

## 2. Score

Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner), additionally multiplied by 0.5 for relocation. For example, CanvasSession has inner = 2.7 / 4 = 0.675, giving s = 0.9 × 0.8375 = 0.75375. MappingGridDocument has inner = 0.9 and relocation, giving s = 0.95 × 0.5 = 0.475.

Top-level scores: live ownership 0.958958333; document models 0.724305556; controller 0.811111111; history 0.8805; editor runtime 0.864; agents 0.941666667; persistence 0.770833333.

J = (0.958958333 + 0.724305556 + 0.811111111 + 0.8805 + 0.864 + 0.941666667 + 0.770833333) / (7 + 0 + 0) = 5.951375 / 7 = **0.850196429**. Calculations use unrounded intermediate values.

## 3. Verdict

The trees identify substantially the same workspace, session, controller, history, editor, agent and persistence components. B makes the live-workspace ownership parent explicit where A separates application lifetime and CanvasSession; it also nests the editor under the controller. The main ownership differences are B placing document/content models under history, revision storage under Diagram, and transfer navigation under the controller. Most internal differences are summarization or grouping. A separately expands folding and startup restoration; B expands pinned selections, source panes, backend bridge handling and explicit publication. These differences concern the trees' breakdowns, not repository correctness.
