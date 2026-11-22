## 1. Anchor tree

Ranges include complete subtrees. Path-only annotations and call-flow explanations are not independent components. Enclosing ranges can contain separately assigned anchors; those parts are scored only at their explicit assignment. Offsets measure additional nesting, without repeatedly charging an inherited offset. B's presentation heading is a grouping parent: its runtime is anchored below, its model-related parts are relocated, and its source panels remain unmatched.

- A 3–14 + 16–28 ↔ B 3–14 · grouped · offset 0 · s = 0.828593750 · Application, workspace and session lifetime
  - A 5–6 ↔ B 4–5 · summarized · offset 0 · s = 0.900000000 · Application entry
  - A 9–14 ↔ B 6–8 + 13–14 · grouped · offset 0 · s = 0.975000000 · Draft registry and session lifetime
    - A 12 ↔ B 7 · same · offset 0 · s = 1 · Draft metadata
    - A 11 + 14 ↔ B 13–14 · grouped · offset 1 · s = 0.9 · Session creation and disposal
  - A 16–28 ↔ B 9–12 · same · offset 1 · s = 0.753750000 · CanvasSession
    - A 20–24 ↔ B 10 · summarized · offset 0 · s = 0.9 · Partitioned observable stores
    - A 25–26 ↔ B 11 · summarized · offset 0 · s = 0.9 · Controller notifications
    - A 27–28 ↔ B 12 · summarized · offset 0 · s = 0.9 · Baseline and dirty state
    - unmatched: A 18 (CanvasCursorCopy ownership)
  - unmatched: A 7–8 (service construction and context)
- A 30–55 ↔ B 16–30 · same · offset 0 · s = 0.844131944 · Semantic document model
  - A 31–37 ↔ B 23–26 + 27–29 · grouped · offset 0 · s = 0.95 · Canvas composition and resolved contents
    - A 32–34 ↔ B 24 + 28 · grouped, summarized · offset 0 · s = 0.9 · Scene root and contents
    - A 35 + 36–37 ↔ B 25 · grouped, summarized · offset 0 · s = 0.9 · Connections, reviews and contexts
  - A 39–46 ↔ B 17–22 · same · offset 0 · s = 0.739791667 · Diagram
    - A 41–42 ↔ B 18–19 · same · offset 0 · s = 1 · DiagramContent
      - A 42 ↔ B 19 · same · offset 0 · s = 1 · Construction and selectable nodes
    - A 43–44 + 45–46 ↔ B 62–65 · grouped, relocated to presentation/source inspection · offset 1 · s = 0.43875 · Source evidence and access
      - A 44 ↔ B 63 · same · offset 0 · s = 1 · Entity/source-range join
      - A 45–46 ↔ B 64 · summarized · offset 0 · s = 0.9 · Read-only source inspection
    - unmatched: B 20–21 (immutable DiagramRevision construction)
  - A 48–55 ↔ B 60–61 · relocated to presentation · offset 0 · s = 0.375 · Canvas interaction state
    - A 49 + 50 ↔ B 61 · grouped · offset 0 · s = 1 · Selection, display and controls
    - unmatched: A 51–55 (presentation resolution and folding)
- A 57–75 + 77–95 ↔ B 32–51 · grouped · offset 0 · s = 0.942509167 · Semantic commands and checkpoint history
  - A 59–60 + 61–72 ↔ B 33–37 · grouped · offset 0 · s = 0.966666667 · Versioned command application
    - A 62 + 63 ↔ B 34 · grouped · offset 0 · s = 1 · Gesture settlement and version guard
    - A 64–67 ↔ B 35 + 36 · grouped, summarized · offset 0 · s = 0.9 · Staged operations
    - A 68–72 ↔ B 37 · summarized · offset 0 · s = 0.9 · Reconciliation and publication
  - A 73 ↔ B 38–39 · summarized · offset 0 · s = 0.9 · Recorded versus transient updates
  - A 74–75 ↔ B 44 · summarized · offset 1 · s = 0.81 · Persistence read boundary
  - A 77–95 ↔ B 40–44 · same · offset 1 · s = 0.748425 · CanvasHistoryService
    - A 79–80 ↔ B 41 · summarized · offset 0 · s = 0.9 · Context ownership
    - A 81–88 ↔ B 42 · summarized · offset 0 · s = 0.9 · Checkpoint archive
    - A 92 ↔ B 43 · same · offset 0 · s = 1 · Append and navigation
    - A 88 ↔ B 45–47 · summarized · offset 2 · s = 0.729 · Named canvas views
    - A 85 ↔ B 26 · relocated to document model · offset 1 · s = 0.45 · Exact revision bindings
    - unmatched: A 90–91 (stored revision API and registry)
  - A 93–95 ↔ B 48–49 · same · offset 0 · s = 1 · Cross-canvas transfer history
    - A 94–95 ↔ B 49 · same · offset 0 · s = 1 · Linked undo boundaries
- A 97–109 ↔ B 54–59 · same · offset 1 · s = 0.783 · Native editor runtime
  - A 100–101 ↔ B 55 · summarized · offset 0 · s = 0.9 · Shape projection
  - A 102–103 ↔ B 56–57 · same · offset 0 · s = 1 · Native geometry and undo ownership
    - A 103 ↔ B 57 · same · offset 0 · s = 1 · Pointer/camera isolation
  - A 104–105 ↔ B 58 · summarized · offset 0 · s = 0.9 · Gesture settlement
  - A 106–108 ↔ B 59 · summarized · offset 0 · s = 0.9 · Checkpoint restoration
  - unmatched: A 109 (runtime disposal)
- A 111–128 ↔ B 71–87 · same · offset 0 · s = 0.900694444 · Agent-assisted editing
  - A 112–116 + 117–120 ↔ B 72–75 + 76–79 · grouped · offset 0 · s = 0.7375 · Prompt coordination and generation
    - A 114 + 119 ↔ B 73 + 74 · grouped · offset 0 · s = 1 · Pinned generation inputs
    - A 118 ↔ B 76–79 · summarized · offset 0 · s = 0.9 · Edit-service run ownership
    - unmatched: A 113 (composer state and timers), A 115–116 (composer polling, retry and lifetime)
  - A 121–123 ↔ B 80–82 · same · offset 0 · s = 0.666666667 · Browser canvas bridge
    - A 122 ↔ B 81 · same · offset 0 · s = 1 · Registration and polling
    - unmatched: A 123 (bridge cleanup), B 82 (LiveCanvasService)
  - A 124–128 ↔ B 83–85 · same · offset 0 · s = 1 · DiagramRevisionReceiver
    - A 126 ↔ B 84 · same · offset 0 · s = 1 · Versioned installation
    - A 127 + 128 ↔ B 85 · grouped · offset 0 · s = 1 · Receipts and persistence acknowledgement
- A 130–149 ↔ B 89–104 · same · offset 0 · s = 0.875 · Workspace persistence
  - A 131–133 ↔ B 101 · summarized · offset 0 · s = 0.9 · Reload
  - A 134–138 ↔ B 90–93 · same · offset 0 · s = 0.975 · WorkspacePersistence
    - A 136 ↔ B 91 · same · offset 0 · s = 1 · Per-session cursors
    - A 137–138 ↔ B 92 · summarized · offset 0 · s = 0.9 · Persisted records
  - A 139–144 ↔ B 93 · summarized · offset 0 · s = 0.9 · Storage worker transport
  - A 145–149 ↔ B 94–97 · same · offset 0 · s = 0.975 · WorkspaceRecordStore
    - A 146 + 147 ↔ B 95 + 96 · grouped · offset 0 · s = 1 · Validated, idempotent writes
    - A 148–149 ↔ B 97 · summarized · offset 0 · s = 0.9 · Atomic manifest publication
  - unmatched: B 98–100 (project checkpoint publication)
- unmatched: B 66–67 (source inspection panels and CodeRepoService)

## 2. Score

For each pair, s = 0.9^offset × (0.5 + 0.5 × inner) × relocation factor. The JSON records every child-level J. For example, CanvasSession has inner = (0.9 + 0.9 + 0.9) / 4 = 0.675, giving s = 0.9 × 0.8375 = 0.75375.

Top-level scores:

| Anchor | s |
|---|---:|
| Application/workspace/session | 0.828593750 |
| Document model | 0.844131944 |
| Commands/history | 0.942509167 |
| Native runtime | 0.783000000 |
| Agent editing | 0.900694444 |
| Persistence | 0.875000000 |

There are k = 6 anchored groups, uA = 0 and uB = 1. Using unrounded values:

J = 5.173929305556 / (6 + 0 + 1) = **0.739132758**.

## 3. Verdict

The trees share the principal workspace, session, document, controller, history, native-editor, agent-editing and persistence components. Their command/history and persistence internals agree especially closely.

B groups sessions under workspace lifetime and history under the controller; A exposes them separately. The corresponding implied parents are application/workspace lifetime and semantic commands/history. B also introduces a presentation/source-inspection parent, relocating source evidence and canvas interaction state from A's document model. Most runtime and storage differences are summarization. A adds folding, registry and lifecycle detail; B adds source panels, LiveCanvasService, immutable revision construction and explicit project publication. The stored-revision registry and immutable revision constructors are related through calls but represent distinct responsibilities, rather than an exact component match.
