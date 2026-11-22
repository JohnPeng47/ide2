## 1. Anchor tree

Ranges include whole source subtrees. Where a counterpart is folded into a parent line, separately matched descendants are extracted before comparing the remaining summary; overlapping enclosing ranges do not charge those descendants again. Offsets within an already aligned grouped match are relative to that alignment. The common diagram title is not an additional scored component.

- A 3–14 ↔ B 3–12 · same · offset 0 · s = 0.983333 · Surface integration boundary
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 1 · Surface event interface
    - A 5 ↔ B 5 · same · offset 0 · s = 1 · Platform-independent terminal interaction
  - A 6–8 ↔ B 6–8 · same · offset 0 · s = 1 · Runtime boundary
    - A 7 ↔ B 7 · same · offset 0 · s = 1 · Runtime responsibilities
    - A 8 ↔ B 8 · same · offset 0 · s = 1 · Native action delegation
  - A 9–14 ↔ B 9–12 · same · offset 0 · s = 0.9 · App coordination
    - A 10 ↔ B 10 · same · offset 0 · s = 1 · Registration and focus
    - A 11–12 ↔ B {11, 12} · grouped, summarized · offset 0 · s = 0.9 · Shared rendering resources
    - A 13–14 ↔ B 54–55 · relocated to process-output handling · offset 0 · s = 0.5 · App dispatch
      - A 14 ↔ B 55 · same · offset 0 · s = 1 · App-mediated worker messages
- A 16–25 ↔ B 14–25 · same · offset 0 · s = 0.941667 · Session assembly
  - A {17, 18} ↔ B {16, 17, 18} · grouped · offset 1 · s = 0.9 · I/O, renderer and workers
  - A 19–21 ↔ B 22–25 · same · offset 0 · s = 0.833333 · Shared State
    - A 20 ↔ B 23 · same · offset 0 · s = 1 · Terminal reference
    - A 21 ↔ B 24 · same · offset 0 · s = 1 · Shared mutex
    - unmatched: B 25 (demand-lock starvation control)
  - A 22–23 ↔ B 19 · summarized · offset 0 · s = 0.9 · Interaction state
  - A 24–25 ↔ B 20–21 · summarized · offset 0 · s = 0.9 · Owned configuration; B 21 is scored separately under configuration propagation
- A 27–40 ↔ B 27–38 · same · offset 0 · s = 0.970139 · User input
  - A 28–32 ↔ B 28–31 · same · offset 0 · s = 0.9875 · Key handling
    - A 29 ↔ B 29 · same · offset 0 · s = 1 · Binding actions
    - A 30–32 ↔ B 30–31 · same · offset 0 · s = 0.95 · Key encoder
      - A 31–32 ↔ B 31 · summarized · offset 0 · s = 0.9 · Encoding options and modes
  - A 33–36 ↔ B 32–34 · same · offset 0 · s = 0.833333 · Mouse and paste
    - A 34 ↔ B 33 · same · offset 0 · s = 1 · Mouse encoder
    - A 36 ↔ B 34 · same · offset 0 · s = 1 · Paste encoder
    - unmatched: A 35 (local selection operation)
  - A 37–40 ↔ B 35–38 · same · offset 0 · s = 1 · Queued writes
    - A 38 ↔ B 36 · same · offset 0 · s = 1 · Readonly filtering
    - A 39–40 ↔ B 37–38 · same · offset 0 · s = 1 · Mailbox write dispatch
      - A 40 ↔ B 38 · same · offset 0 · s = 1 · Exec PTY writes
- A 42–58 ↔ B 40–55 · same · offset 0 · s = 0.956944 · Process output
  - A 43–49 ↔ B 41–44 · same · offset 0 · s = 0.8 · Exec session
    - A {44, 45–49} ↔ B 42 · grouped, summarized · offset 0 · s = 0.9 · Configured startup, excluding separately matched reader and watcher
    - A 47–49 ↔ B {43, 44} · grouped · offset 1 · s = 0.9 · PTY readers
      - A 48 ↔ B 43 · same · offset 0 · s = 1 · POSIX readers
      - A 49 ↔ B 44 · same · offset 0 · s = 1 · Windows reader
    - unmatched: A 46 (process watcher)
  - A 50–54 ↔ B 45–51 · same · offset 0 · s = 0.975 · Locked parsing
    - A 51–54 ↔ B 46–51 · same · offset 0 · s = 0.95 · Incremental stream
      - A {52, 53–54} ↔ B {47–48, 49} · grouped, summarized · offset 0 · s = 0.9 · Handler and terminal mutation
  - A 55–58 ↔ B 52–55 · same · offset 0 · s = 0.966667 · External effects
    - A 56 ↔ B 50 · same component, different internal nesting · offset 1 · s = 0.9 · Replies
    - A 57 ↔ B 53 · same · offset 0 · s = 1 · UI messages
    - A 58 ↔ B 51 · same component, different internal nesting · offset 1 · s = 0.9 · Renderer notification
- A 60–73 ↔ B 57–70 · same · offset 0 · s = 0.949583 · Terminal model
  - A 61–62 ↔ B 58–60 · summarized · offset 0 · s = 0.9 · Terminal operations, with state fields extracted below
  - A 72–73 ↔ B {59, 60} · grouped, summarized · offset 1 · s = 0.81 · Geometry and protocol fields
  - A 63–71 ↔ B {61–63, 64–70} · grouped · offset 0 · s = 0.9875 · ScreenSet and Screen
    - A 64 ↔ B 62 · same · offset 0 · s = 1 · Screen allocation
    - A 65–71 ↔ B {63, 64–70} · grouped · offset 0 · s = 0.95 · Active Screen ownership
      - A 66 ↔ B 65 · same · offset 1 · s = 0.9 · Cursor, selection and keyboard state
      - A 67 ↔ B 66 · same · offset 1 · s = 0.9 · Graphics and prompt state
      - A 68–71 ↔ B 67–70 · same · offset 1 · s = 0.9 · PageList
        - A 69 ↔ B 68 · same · offset 0 · s = 1 · Ordered history and screen pages
        - A 70 ↔ B 69 · same · offset 0 · s = 1 · Rows and cells
        - A 71 ↔ B 70 · same · offset 0 · s = 1 · Tracked pins
- A 75–88 ↔ B 72–83 · same · offset 0 · s = 0.9055 · Rendering
  - A 76 ↔ B 73–74 · summarized · offset 0 · s = 0.9 · Renderer scheduling
  - A 77–78 ↔ B 82 · summarized · offset 1 · s = 0.81 · Graphics implementation
  - A 79–83 ↔ B 75–80 · same · offset 0 · s = 0.785 · Frame extraction
    - A 80–82 ↔ B {76, 80} · grouped, summarized · offset 0 · s = 0.9 · RenderState and presentation inputs
    - A 79–83 ↔ B 77–78 · summarized from A's parent line · offset 1 · s = 0.81 · Demand-locked snapshot
    - unmatched: A 83 (synchronized-output deferral)
  - A 84–85 ↔ B 79 · summarized · offset 1 · s = 0.81 · Shaping and glyph preparation
  - A 86–88 ↔ B 81–83 · same · offset 0 · s = 0.75 · Drawing
    - A 88 ↔ B 83 · same · offset 0 · s = 1 · Surface-requested drawing
    - unmatched: A 87 (visibility and vsync scheduling)
- A 90–99 ↔ B 85–91 · same · offset 0 · s = 0.848125 · Geometry and configuration
  - A 91–97 ↔ B {86–87, 88–91} · grouped · offset 0 · s = 0.9875 · Resize
    - A 92 ↔ B 87 · same · offset 0 · s = 1 · Pixel-to-grid geometry
    - A 93–97 ↔ B 88–91 · same · offset 0 · s = 0.95 · Resize handling
      - A 94–97 ↔ B {89–90, 91} · grouped · offset 1 · s = 0.9 · Termio coordination
        - A 95–96 ↔ B 89–90 · same · offset 0 · s = 1 · Locked resize
          - A 96 ↔ B 90 · same · offset 0 · s = 1 · Consistent redraw dimensions
        - A 97 ↔ B 91 · same · offset 0 · s = 1 · Renderer notification
  - A 98–99 ↔ B 21 · relocated to session ownership, summarized · offset 1 · s = 0.405 · Configuration propagation
- A 101–109 ↔ B 93–103 · same · offset 0 · s = 0.8525 · Teardown
  - A 102 ↔ B 96–97 · summarized · offset 0 · s = 0.9 · Runtime close
  - A 103–104 ↔ B {99, 100} · grouped, summarized · offset 1 · s = 0.81 · Worker shutdown
  - A 105–106 ↔ B 101 · summarized · offset 1 · s = 0.81 · Resource destruction
  - A 107 ↔ B 102 · same · offset 1 · s = 0.9 · Allocation and font release
  - A 108–109 ↔ B 103 · summarized · offset 1 · s = 0.81 · App resource lifetime
  - unmatched: B 94–95 (child-exit reporting and hold-open policy)

## 2. Score

Each level uses J = Σs / (k + uA + uB). Summarized matches have inner = 0.8; leaf matches have inner = 1. Each pair applies the depth multiplier and, where indicated, the relocation multiplier.

Top-level scores:

| Anchor | s |
|---|---:|
| Surface boundary | 0.9833333333 |
| Session assembly | 0.9416666667 |
| Input | 0.9701388889 |
| Process output | 0.9569444444 |
| Terminal model | 0.9495833333 |
| Rendering | 0.9055000000 |
| Geometry/configuration | 0.8481250000 |
| Teardown | 0.8525000000 |

There are eight top-level matches and no unmatched top-level components:

J = 7.4077916667 / (8 + 0 + 0) = **0.9259739583**.

For example, shared State has inner = (1 + 1) / (2 + 0 + 1) = 2/3, giving s = 0.8333333333. Configuration propagation has s = 0.9 × (0.5 + 0.5 × 0.8) × 0.5 = 0.405.

## 3. Verdict

The trees identify essentially the same eight major components and closely agree on input encoding, queued writes, terminal storage, resize coordination and resource lifetimes. Most differences are detail or grouping: B makes initialization and deinitialization explicit parents, separates shared font/device resources, and lifts Screen ownership out of the active-screen branch. The implied groupings are shared rendering resources, platform-specific PTY readers, active Screen ownership and Termio resize coordination. App dispatch moves into B's process-output branch, while configuration propagation moves into session ownership; these are presentation-owner changes, not different code. Smaller unmatched details include A's selection operation, process watcher and rendering controls, and B's starvation control and child-exit policy.
