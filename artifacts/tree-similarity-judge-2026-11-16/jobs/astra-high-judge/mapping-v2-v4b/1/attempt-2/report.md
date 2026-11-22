## 1. Anchor tree

Ranges include enclosing subtrees. Explicitly extracted matches are counted at their listed location, not again as enclosing-node detail. File annotations, call-flow descriptions and facts folded into a matched parent's label are not separate unmatched components. Offsets below enclosing matches are incremental.

- A 3–14 + 16–28 ↔ B 3–14 · grouped · offset 0 · s = 0.806927 · Application/workspace/session lifetime
  - A 5–6 ↔ B 4–5 · summarized · offset 0 · s = 0.9 · Application entry
  - A 9–14 ↔ B 6–8 + 13–14 · grouped · offset 0 · s = 0.801667 · Workspace registry
    - A 12 ↔ B 7 · same · offset 0 · s = 1 · Metadata
    - A 11 + 14 ↔ B 13–14 · grouped, summarized · offset 1 · s = 0.81 · Session lifecycle
    - unmatched: A 13 (affected-document notifications)
  - A 16–28 ↔ B 9–12 · same · offset 1 · s = 0.75375 · CanvasSession
    - A 19 + 20–24 ↔ B 10 · grouped, summarized · offset 0 · s = 0.9 · Read-only stores
    - A 25–26 ↔ B 11 · summarized · offset 0 · s = 0.9 · Notifications
    - A 27–28 ↔ B 12 · summarized · offset 0 · s = 0.9 · Dirty state
    - unmatched: A 18 (owned controller/cursor-copy helper)
  - unmatched: A 7–8 (service creation/context)
- A 30–55 ↔ B 16–30 · same · offset 0 · s = 0.864583 · Semantic model
  - A 31–37 ↔ B 23–26 + 27–29 · grouped · offset 0 · s = 0.95 · Composition/resolved document
    - A 32–34 ↔ B 24 + 28 · grouped, summarized · offset 0 · s = 0.9 · Scene and contents
    - A 35 + 36–37 ↔ B 25 · grouped, summarized · offset 0 · s = 0.9 · Connections and context
  - A 39–46 ↔ B 17–22 · same · offset 0 · s = 0.8625 · Diagram
    - A 41–42 ↔ B 18–19 · same · offset 0 · s = 1 · Content
      - A 42 ↔ B 19 · same · offset 0 · s = 1 · Construction/structure
    - A 43–44 + 45–46 ↔ B 62–65 · grouped, relocated to presentation/source inspection · offset 1 · s = 0.45 · Source context
      - A 44 ↔ B 63 · same · offset 0 · s = 1 · Evidence mapping
      - A 46 ↔ B 64 · same · offset 0 · s = 1 · Source joins
  - A 48–55 ↔ B 60–61 · relocated to presentation · offset 0 · s = 0.375 · Canvas state
    - A 49 + 50 ↔ B 61 · grouped · offset 0 · s = 1 · Selection/display/controls
    - unmatched: A 51–55 (presentation resolution and folding)
- A 57–75 + 77–95 ↔ B 32–51 · grouped · offset 0 · s = 0.893518 · Commands/history
  - A 57–75 ↔ B 33–37 + 38–39 · grouped · offset 1 · s = 0.79075 · Controller commands
    - A 61–72 ↔ B 33–37 · same · offset 0 · s = 0.966667 · applyUpdate
      - A 62 + 63 ↔ B 34 · grouped · offset 0 · s = 1 · Settlement/version guard
      - A 64–67 ↔ B 35 + 36 · grouped, summarized · offset 0 · s = 0.9 · Operations
      - A 68–72 ↔ B 37 · summarized · offset 0 · s = 0.9 · Reconciliation/publication
    - A 73 ↔ B 38–39 · summarized · offset 0 · s = 0.9 · Transient updates
    - A 74–75 ↔ B 44 · relocated under history · summarized · offset 1 · s = 0.405 · Persistence read boundary
  - A 77–95 ↔ B 40–44 + 45–47 + 48–49 · grouped · offset 1 · s = 0.783321 · History service
    - A 79–80 ↔ B 41 · summarized · offset 0 · s = 0.9 · Context ownership
    - A 81–88 ↔ B 42 · summarized · offset 0 · s = 0.9 · Archive records, excluding separately matched bindings/views
    - A 89 + 92 ↔ B 43 · grouped · offset 0 · s = 1 · Materialization/navigation
    - A 90–91 ↔ B 20–21 · relocated to diagram model · offset 1 · s = 0.225 · Revision construction/retention
      - unmatched: A 91 (registry), B 21 (immutable factories)
    - A 88 ↔ B 45–47 · summarized · offset 1 · s = 0.81 · Canvas views
    - A 93–95 ↔ B 48–49 · same · offset 1 · s = 0.9 · Transfers
      - A 94–95 ↔ B 49 · same · offset 0 · s = 1 · Coordinated undo
    - A 85 ↔ B 26 · relocated to canvas model · offset 1 · s = 0.45 · Revision bindings
- A 97–109 ↔ B 53–69 · same presentation boundary, broader in B · offset 0 · s = 0.737857
  - A 100–101 ↔ B 55 · summarized · offset 1 · s = 0.81 · Shape projection
  - A 102–103 ↔ B 56–57 · same · offset 1 · s = 0.9 · Live geometry
    - A 103 ↔ B 57 · same · offset 0 · s = 1 · Native frames
  - A 104–105 ↔ B 58 · summarized · offset 1 · s = 0.81 · Gesture settlement
  - A 106–108 ↔ B 59 · summarized · offset 1 · s = 0.81 · Checkpoint restoration
  - unmatched: A 99 (mount/driver attachment), A 109 (disposal), B 66–67 (source panels/repository reads)
  - B 60–65 is matched under A's semantic model, not unmatched here.
- A 111–128 ↔ B 71–87 · same · offset 0 · s = 0.892778 · Agent editing
  - A 112–116 + 117–120 ↔ B 72–75 + 76–79 · grouped · offset 0 · s = 0.69 · Prompt/edit production
    - A 114 + 119 ↔ B 73 · grouped · offset 0 · s = 1 · Captured generation inputs
    - A 118 ↔ B 74 + 76–79 · grouped, summarized · offset 0 · s = 0.9 · Runs/deduplication
    - unmatched: A 113 (composer state), A 115–116 (composer client/lifetime), A 120 (canvas port)
  - A 121–123 ↔ B 80–82 · same · offset 0 · s = 0.666667 · Browser bridge
    - A 122 ↔ B 81 · same · offset 0 · s = 1 · Polling/replies
    - unmatched: A 123 (cleanup), B 82 (LiveCanvasService)
  - A 124–128 ↔ B 83–85 · same · offset 0 · s = 1 · Revision receiver
    - A 126 ↔ B 75 + 84 · grouped · offset 0 · s = 1 · Guarded installation
    - A 127 + 128 ↔ B 85 · grouped · offset 0 · s = 1 · Receipts/flush retries
- A 130–149 ↔ B 89–104 · same · offset 0 · s = 0.850167 · Persistence
  - A 131–133 ↔ B 101 · summarized · offset 0 · s = 0.9 · Reload
  - A 134–138 ↔ B 90–93 · same · offset 0 · s = 0.975 · Record production
    - A 136 ↔ B 91 · same · offset 0 · s = 1 · Cursors
    - A 137–138 ↔ B 92 · summarized · offset 0 · s = 0.9 · Record contents
  - A 139–144 ↔ B 93 · summarized · offset 1 · s = 0.81 · Worker transport
  - A 145–149 ↔ B 94–97 · same · offset 0 · s = 0.816667 · Server store
    - A 146 ↔ B 95 + 96 · grouped · offset 0 · s = 1 · Receipts/concurrency
    - A 148–149 ↔ B 97 · summarized · offset 0 · s = 0.9 · Atomic publication
    - unmatched: A 147 (immutability validation)
  - unmatched: B 98–100 (explicit project publication)

## 2. Score

Each level uses J = sum(s)/(k + uA + uB). Pair scores use the specified depth, summary and relocation factors. For example, CanvasSession has inner J = 2.7/4 = 0.675, giving s = 0.9 × (0.5 + 0.5 × 0.675) = 0.75375.

Top-level scores: lifetime 0.8069270833; model 0.8645833333; commands/history 0.8935178571; presentation 0.7378571429; agents 0.8927777778; persistence 0.8501666667.

J = 5.0458298611 / (6 + 0 + 0) = **0.8409716435**.

## 3. Verdict

The trees identify substantially the same workspace, session, diagram model, controller, history, editor runtime, agent-editing and persistence components. B groups sessions under workspace lifetime and history under the controller; the corresponding implied parents in A are application/workspace lifetime and semantic commands/history. A supplies more session, runtime and transport detail. B adds source-reading panels, live-canvas transport and explicit project publication. The main ownership differences are source inspection and canvas state moving into B's presentation branch, and revision construction/bindings moving into B's model branch. These are representation differences, not judgments about implementation correctness.
