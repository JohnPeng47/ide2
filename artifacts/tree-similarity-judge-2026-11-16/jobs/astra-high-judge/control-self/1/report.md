## 1. Anchor tree

The common Surface root (A 1–97 ↔ B 1–97) provides the scope; its eight component branches are the scoring top level.

- A 3–11 ↔ B 3–11 · same · offset 0 · s = 1 · Runtime boundary
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 1 · Surface event interface
    - A 5 ↔ B 5 · same · offset 0 · s = 1 · Native events and Surface-owned interaction state
  - A 6–7 ↔ B 6–7 · same · offset 0 · s = 1 · Platform runtime integration
    - A 7 ↔ B 7 · same · offset 0 · s = 1 · Native UI delegation
  - A 8–11 ↔ B 8–11 · same · offset 0 · s = 1 · Application coordination
    - A 9 ↔ B 9 · same · offset 0 · s = 1 · Surface registration, focus and routing
    - A 10 ↔ B 10 · same · offset 0 · s = 1 · Shared font and device resources
    - A 11 ↔ B 11 · same · offset 0 · s = 1 · Application mailbox dispatch
- A 13–20 ↔ B 13–20 · same · offset 0 · s = 1 · Session assembly and workers
  - A 14 ↔ B 14 · same · offset 0 · s = 1 · Termio session IO
  - A 15 ↔ B 15 · same · offset 0 · s = 1 · Renderer and renderer worker
  - A 16–17 ↔ B 16–17 · same · offset 0 · s = 1 · Shared renderer state
    - A 17 ↔ B 17 · same · offset 0 · s = 1 · Shared-state mutex
  - A 18 ↔ B 18 · same · offset 0 · s = 1 · IO event-loop worker
  - A 19–20 ↔ B 19–20 · same · offset 0 · s = 1 · Exec subprocess and reader startup
    - A 20 ↔ B 20 · same · offset 0 · s = 1 · Backend-owned reader lifetime
- A 22–34 ↔ B 22–34 · same · offset 0 · s = 1 · Input handling and child writes
  - A 23–26 ↔ B 23–26 · same · offset 0 · s = 1 · Keyboard handling
    - A 24 ↔ B 24 · same · offset 0 · s = 1 · Binding actions
    - A 25–26 ↔ B 25–26 · same · offset 0 · s = 1 · Key encoding
      - A 26 ↔ B 26 · same · offset 0 · s = 1 · Terminal keyboard protocol modes
  - A 27–28 ↔ B 27–28 · same · offset 0 · s = 1 · Mouse callbacks
    - A 28 ↔ B 28 · same · offset 0 · s = 1 · Local mouse interaction and protocol reporting
  - A 29–30 ↔ B 29–30 · same · offset 0 · s = 1 · Clipboard paste handling
    - A 30 ↔ B 30 · same · offset 0 · s = 1 · Terminal-dependent paste encoding
  - A 31–34 ↔ B 31–34 · same · offset 0 · s = 1 · IO message queue
    - A 32 ↔ B 32 · same · offset 0 · s = 1 · Readonly write filtering
    - A 33–34 ↔ B 33–34 · same · offset 0 · s = 1 · Write request variants and backend queue
      - A 34 ↔ B 34 · same · offset 0 · s = 1 · PTY writes and buffer ownership
- A 36–47 ↔ B 36–47 · same · offset 0 · s = 1 · Child output and protocol interpretation
  - A 37–39 ↔ B 37–39 · same · offset 0 · s = 1 · Termio output processing
    - A 38 ↔ B 38 · same · offset 0 · s = 1 · Locked output processing
    - A 39 ↔ B 39 · same · offset 0 · s = 1 · Render notification and stream ingestion
  - A 40–42 ↔ B 40–42 · same · offset 0 · s = 1 · Terminal stream handler
    - A 41–42 ↔ B 41–42 · same · offset 0 · s = 1 · VT action handling
      - A 42 ↔ B 42 · same · offset 0 · s = 1 · Persistent parser and handler state
  - A 43–47 ↔ B 43–47 · same · offset 0 · s = 1 · Stream-handler external effects
    - A 44 ↔ B 44 · same · offset 0 · s = 1 · Protocol response mailbox
    - A 45 ↔ B 45 · same · offset 0 · s = 1 · Renderer mailbox and wakeup
    - A 46–47 ↔ B 46–47 · same · offset 0 · s = 1 · Surface UI mailbox
      - A 47 ↔ B 47 · same · offset 0 · s = 1 · Title, clipboard and surface effects
- A 49–62 ↔ B 49–62 · same · offset 0 · s = 1 · Terminal session model
  - A 50–53 ↔ B 50–53 · same · offset 0 · s = 1 · Terminal
    - A 51 ↔ B 51 · same · offset 0 · s = 1 · Text placement and scrolling state
    - A 52 ↔ B 52 · same · offset 0 · s = 1 · Terminal protocol state
    - A 53 ↔ B 53 · same · offset 0 · s = 1 · Session metadata
  - A 54–62 ↔ B 54–62 · same · offset 0 · s = 1 · ScreenSet
    - A 55 ↔ B 55 · same · offset 0 · s = 1 · Primary and alternate screen selection
    - A 56–62 ↔ B 56–62 · same · offset 0 · s = 1 · Screen
      - A 57 ↔ B 57 · same · offset 0 · s = 1 · Per-screen editing state
      - A 58 ↔ B 58 · same · offset 0 · s = 1 · Extended protocol state
      - A 59–62 ↔ B 59–62 · same · offset 0 · s = 1 · PageList screen storage
        - A 60 ↔ B 60 · same · offset 0 · s = 1 · Page backing storage
        - A 61–62 ↔ B 61–62 · same · offset 0 · s = 1 · Tracked position pins
          - A 62 ↔ B 62 · same · offset 0 · s = 1 · Screen-internal storage and tracking
- A 64–76 ↔ B 64–76 · same · offset 0 · s = 1 · Frame preparation and GPU presentation
  - A 65–66 ↔ B 65–66 · same · offset 0 · s = 1 · Renderer worker callbacks
    - A 66 ↔ B 66 · same · offset 0 · s = 1 · Independent render scheduling
  - A 67–73 ↔ B 67–73 · same · offset 0 · s = 1 · Renderer frame update
    - A 68–70 ↔ B 68–70 · same · offset 0 · s = 1 · Locked terminal snapshot update
      - A 69 ↔ B 69 · same · offset 0 · s = 1 · Viewport snapshot
      - A 70 ↔ B 70 · same · offset 0 · s = 1 · Synchronized-output deferral
    - A 71–72 ↔ B 71–72 · same · offset 0 · s = 1 · Snapshot and interaction overlays
      - A 72 ↔ B 72 · same · offset 0 · s = 1 · GPU cell rebuilding and dirty state
    - A 73 ↔ B 73 · same · offset 0 · s = 1 · Font shaping and rasterization
  - A 74 ↔ B 74 · same · offset 0 · s = 1 · Draw-frame render-data locking
  - A 75–76 ↔ B 75–76 · same · offset 0 · s = 1 · Generic renderer graphics backends
    - A 76 ↔ B 76 · same · offset 0 · s = 1 · Application device and Surface presentation ownership
- A 78–87 ↔ B 78–87 · same · offset 0 · s = 1 · Geometry and configuration
  - A 79–80 ↔ B 79–80 · same · offset 0 · s = 1 · Initial font and cell metrics
    - A 80 ↔ B 80 · same · offset 0 · s = 1 · Grid geometry calculation
  - A 81–83 ↔ B 81–83 · same · offset 0 · s = 1 · Surface resize handling
    - A 82–83 ↔ B 82–83 · same · offset 0 · s = 1 · Locked backend and terminal resize
      - A 83 ↔ B 83 · same · offset 0 · s = 1 · Resize and output dimension consistency
  - A 84–87 ↔ B 84–87 · same · offset 0 · s = 1 · Owned configuration updates
    - A 85 ↔ B 85 · same · offset 0 · s = 1 · Derived config, font and binding refresh
    - A 86–87 ↔ B 86–87 · same · offset 0 · s = 1 · Worker configuration transfer
      - A 87 ↔ B 87 · same · offset 0 · s = 1 · Configuration lifetime independence
- A 89–97 ↔ B 89–97 · same · offset 0 · s = 1 · Session shutdown
  - A 90 ↔ B 90 · same · offset 0 · s = 1 · Child-exit hold and close behavior
  - A 91 ↔ B 91 · same · offset 0 · s = 1 · Runtime-managed Surface closure
  - A 92–97 ↔ B 92–97 · same · offset 0 · s = 1 · Surface deinitialization
    - A 93–94 ↔ B 93–94 · same · offset 0 · s = 1 · Search and worker shutdown
      - A 94 ↔ B 94 · same · offset 0 · s = 1 · Exec subprocess and reader teardown
    - A 95 ↔ B 95 · same · offset 0 · s = 1 · Renderer and renderer-thread teardown ordering
    - A 96 ↔ B 96 · same · offset 0 · s = 1 · IO and terminal-state release
    - A 97 ↔ B 97 · same · offset 0 · s = 1 · Font and Surface-owned resource release

## 2. Score

Every leaf pair has inner = 1 and s = 0.9^0 × (0.5 + 0.5 × 1) = 1. Every compared sibling level has no unmatched nodes, so J = k/k = 1; consequently every parent pair also has s = 1.

Top-level scores: runtime boundary 1; session assembly 1; input 1; child output 1; terminal model 1; rendering 1; geometry/configuration 1; shutdown 1.

J = (1 + 1 + 1 + 1 + 1 + 1 + 1 + 1) / (8 + 0 + 0) = **1**.

## 3. Verdict

The trees identify identical components and identical recursive breakdowns beneath Surface: runtime integration, session workers, input, output interpretation, terminal storage, rendering, configuration/geometry and shutdown. There are no differences in detail, grouping, depth or ownership, and no summarized, relocated or unmatched components. No additional implied parents are needed.
