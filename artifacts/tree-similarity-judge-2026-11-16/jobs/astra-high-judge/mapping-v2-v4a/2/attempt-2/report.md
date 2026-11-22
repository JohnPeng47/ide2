## 1. Anchor tree

Source annotations and call-flow explanations are not separate components. Facts folded into a matched parent's declaration—such as workspace metadata, controller ownership and session readability—are credited there. Offsets are relative to the enclosing match. Cross-listed subtrees are allocated once; their enclosing ranges still cover their complete original nodes.

- A 3–14 + 16–28 ↔ B 3–17 · grouped · offset 0 · s = 0.977708 · application and live ownership
  - A 5–6 + 7–8 ↔ B 4–6 · grouped · offset 0 · s = 1 · entry and injection
    - A 6 + 8 ↔ B 5–6 · grouped · offset 0 · s = 1 · default surface and services
  - A 9–14 ↔ B 7–11 · same · offset 0 · s = 1 · CanvasWorkspace
    - A 11 + 14 ↔ B 9 · grouped · offset 0 · s = 1 · session lifecycle
    - A 13 ↔ B 10–11 · same · offset 0 · s = 1 · persistence notifications
  - A 16–28 ↔ B 12–17 · same · offset 1 · s = 0.86625 · CanvasSession
    - A 18 ↔ B 16–17 · same · offset 0 · s = 1 · cursor-copy state
    - A 20–24 ↔ B 13 · summarized · offset 0 · s = 0.9 · observable stores
    - A 25–26 ↔ B 14 · summarized · offset 0 · s = 0.9 · controller subscription
    - A 27–28 ↔ B 15 · summarized · offset 0 · s = 0.9 · dirty state and baseline
- A 30–55 ↔ B 65–83 · same · offset 0 · s = 0.671958 · document, interaction and source models
  - A 31–37 ↔ B 34 + 35–36 · grouped, summarized, relocated to history · offset 1 · s = 0.405 · MappingGridDocument
  - A 39–46 ↔ B 37–42 + 75–77 · grouped, relocated partly to history · offset 0 · s = 0.48125 · Diagram and source API
    - A 40 ↔ B 38 · same · offset 0 · s = 1 · identities
    - A 41–42 ↔ B 39 · summarized · offset 0 · s = 0.9 · content
    - A 43–44 ↔ B 40 · summarized · offset 0 · s = 0.9 · source context
    - A 45–46 ↔ B 75–77 · same · offset 1 · s = 0.9 · diagramSource
      - A 46 ↔ B 76–77 · same · offset 0 · s = 1 · evidence join
  - A 48–55 ↔ B 66–70 · same · offset 0 · s = 0.833333 · MappingCanvasState
    - A 49 ↔ B 67 + 68 · grouped · offset 0 · s = 1 · selection and controls
    - A 50 ↔ B 69–70 · same · offset 0 · s = 1 · presentation state
    - unmatched: A 51–55 (visible-scene projection and folding)
  - unmatched: B 71–74 (revision-pinned region selection), B 78–83 (pane ownership and source exploration)
- A 57–75 ↔ B 44–63 · same · offset 0 · s = 0.811111 · MappingDocumentController
  - A 59–60 + 61–72 ↔ B 45–50 · grouped · offset 0 · s = 0.966667 · command API and update pipeline
    - A 62 + 63 ↔ B 46 · grouped · offset 0 · s = 1 · settlement and version guard
    - A 64–67 ↔ B 47 + 48 + 49 · grouped, summarized · offset 0 · s = 0.9 · operation staging
    - A 68–72 ↔ B 50 · summarized · offset 0 · s = 0.9 · snapshot publication
  - A 73 ↔ B 51–52 · summarized · offset 0 · s = 0.9 · transient changes
  - unmatched: A 74–75 (derived read boundaries)
- A 77–95 ↔ B 19–42 · same · offset 0 · s = 0.878 · history archive
  - A 79–80 + 92 ↔ B 20–23 · grouped · offset 0 · s = 0.975 · contexts and operations
    - A 80 ↔ B 22–23 · same · offset 0 · s = 1 · isolated handles
    - A 92 ↔ B 21 · same · offset 1 · s = 0.9 · history operations
  - A 81–88 ↔ B 24–32 · same · offset 0 · s = 1 · CanvasHistoryRecord
    - A 82 ↔ B 25 · same · offset 0 · s = 1 · navigation
    - A 83–86 ↔ B 26–29 · same · offset 0 · s = 1 · stored snapshots
      - A 84 ↔ B 27 · same · offset 0 · s = 1 · composition
      - A 85 ↔ B 28 · same · offset 0 · s = 1 · revision bindings
      - A 86 ↔ B 29 · same · offset 0 · s = 1 · restoration metadata
    - A 87 ↔ B 30 · same · offset 0 · s = 1 · retained revisions
    - A 88 ↔ B 31–32 · same · offset 0 · s = 1 · named views
  - A 89 ↔ B 33–36 · summarized · offset 0 · s = 0.9 · document resolution; composition children allocated above
  - A 90–91 ↔ B 41–42 · summarized, relocated into B's Diagram model · offset 1 · s = 0.405 · revision store
  - A 93–95 ↔ B 53–54 · relocated to controller · offset 0 · s = 0.5 · transfer history
    - A 94–95 ↔ B 54 · same · offset 0 · s = 1 · coordinated undo
- A 97–109 ↔ B 56–63 · same, nested under B's controller · offset 1 · s = 0.864 · editor runtime
  - A 100–101 ↔ B 58 · summarized · offset 0 · s = 0.9 · native-shape projection
  - A 102–103 ↔ B 57 + 61 · grouped, summarized · offset 0 · s = 0.9 · native geometry ownership
  - A 104–105 ↔ B 59 · summarized · offset 0 · s = 0.9 · gesture settlement
  - A 106–108 ↔ B 60 · summarized · offset 0 · s = 0.9 · checkpoint undo
  - A 109 ↔ B 62–63 · same · offset 0 · s = 1 · disposal
- A 111–128 ↔ B 85–106 · same · offset 0 · s = 0.927604 · agent editing
  - A 112–116 ↔ B 86–89 · same · offset 0 · s = 0.975 · prompt coordinator
    - A 114 ↔ B 87 · same · offset 0 · s = 1 · captured revisions
    - A 115–116 ↔ B 88–89 · summarized · offset 0 · s = 0.9 · pinned requests
  - A 117–120 ↔ B 90–96 · same · offset 0 · s = 0.6125 · DiagramEditService
    - A 119 ↔ B 91–92 · summarized · offset 0 · s = 0.9 · generation context
    - unmatched: A 120 (canvas port), B 93 (service-side stale checks), B 94–96 (run states and uncertain retry)
  - A 121–123 ↔ B 97–101 · same · offset 0 · s = 0.833333 · canvas bridge
    - A 122 ↔ B 98 · same · offset 0 · s = 1 · browser command handling
    - A 123 ↔ B 100–101 · same · offset 0 · s = 1 · cleanup
    - unmatched: B 99 (backend pending replies and timeouts)
  - A 124–128 ↔ B 102–106 · same · offset 0 · s = 1 · revision receiver
    - A 126 ↔ B 103 · same · offset 0 · s = 1 · versioned application
    - A 127 ↔ B 104 · same · offset 0 · s = 1 · receipts
    - A 128 ↔ B 105–106 · same · offset 0 · s = 1 · persistence acknowledgement
- A 130–149 ↔ B 108–129 · same · offset 0 · s = 0.78 · persistence
  - A 134–138 ↔ B 109–113 · same · offset 0 · s = 0.816667 · WorkspacePersistence
    - A 136 ↔ B 110 · same · offset 0 · s = 1 · persistence cursors
    - A 137–138 ↔ B 111 · summarized · offset 0 · s = 0.9 · record composition
    - unmatched: B 112–113 (record deletion and subscription disposal)
  - A 139–144 ↔ B 114–118 · same · offset 0 · s = 1 · storage worker
    - A 141 + 142 ↔ B 115 · grouped · offset 0 · s = 1 · batching and retry identity
    - A 144 ↔ B 116 + 117–118 · grouped · offset 0 · s = 1 · flush and disposal
  - A 145–149 ↔ B 119–123 · same · offset 0 · s = 0.983333 · record store
    - A 146 ↔ B 120 · same · offset 0 · s = 1 · write serialization
    - A 147 ↔ B 121 · same · offset 0 · s = 1 · immutable-record validation
    - A 148–149 ↔ B 122–123 · summarized · offset 0 · s = 0.9 · atomic manifest
  - unmatched: A 131–133 (startup restoration), B 124–129 (explicit publication)

## 2. Score

Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner), additionally multiplied by 0.5 for relocation. Summarized inner = 0.8; leaf inner = 1. The nested JSON supplies every sibling denominator through its pairs and unmatched lists.

Top-level scores:

| Anchor | Inner J | s |
|---|---:|---:|
| Live ownership | 0.955416667 | 0.977708333 |
| Document/source models | 0.343916667 | 0.671958333 |
| Controller | 0.622222222 | 0.811111111 |
| History | 0.756 | 0.878 |
| Editor runtime | 0.92 | 0.864 |
| Agent editing | 0.855208333 | 0.927604167 |
| Persistence | 0.56 | 0.78 |

J = (0.977708333333 + 0.671958333333 + 0.811111111111 + 0.878 + 0.864 + 0.927604166667 + 0.78) / (7 + 0 + 0) = 5.910381944444 / 7 = **0.844340277778**.

## 3. Verdict

The trees identify substantially the same workspace, session, controller, history, editor, agent and persistence components. B groups entry/workspace/session under an explicit live-ownership parent and nests the editor beneath the controller. A keeps a unified semantic-model parent; B distributes its composition and Diagram pieces into history and its source API into exploration. Those are ownership/grouping differences, not missing components. A adds folding and startup-restoration detail; B adds region-selection, pane exploration, backend run states and explicit publication. The implied parents are live workspace ownership, the controller command pipeline, and Diagram content plus its source API.
