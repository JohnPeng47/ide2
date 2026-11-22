## Anchor tree
- A 3–11 ↔ B 3–14 · same · offset 0 · s = 0.869444 · Surface/runtime boundary
  - A 4–5 ↔ B 4–5, 22–23 · grouped, relocated · offset 0 · s = 0.500000 · Callbacks and interaction state
    - A 5 ↔ B 5, 23 · grouped · offset 0 · s = 1 · Native events and local state
  - A 6–7 ↔ B 6–8 · same · offset 0 · s = 0.750000 · Platform runtime
    - A 7 ↔ B 8 · same · offset 0 · s = 1 · Native UI delegation
    - unmatched: B 7 (runtime selection variants)
  - A 8–11 ↔ B 9–14 · same · offset 0 · s = 0.966667 · Application coordination
    - A 9 ↔ B 10 · same · offset 0 · s = 1 · Registry and focus
    - A 10 ↔ B 11–12 · summarized · offset 0 · s = 0.9 · Shared fonts and device
    - A 11 ↔ B 13–14 · summarized · offset 0 · s = 0.9 · Mailbox dispatch
- A 13–20 ↔ B 16–25 · same · offset 0 · s = 0.920313 · Session assembly
  - A 14, 18 ↔ B 17 · grouped · offset 0 · s = 1 · Termio and IO thread
  - A 15 ↔ B 18 · same · offset 0 · s = 1 · Renderer and render thread
  - A 16–17 ↔ B 19–21 · same · offset 0 · s = 1 · Shared renderer state
    - A 17 ↔ B 20, 21 · grouped · offset 0 · s = 1 · Terminal reference and mutex
  - A 19–20 ↔ B 43–49 · relocated · offset 0 · s = 0.362500 · Exec backend and workers
    - A 20 ↔ B 45–49 · summarized · offset 0 · s = 0.9 · Backend worker lifetime
    - unmatched: B 44 (command/environment/shell setup)
- A 22–34 ↔ B 27–40 · same · offset 0 · s = 0.997917 · Input and child writes
  - A 23–26 ↔ B 28–32 · same · offset 0 · s = 0.987500 · Keybindings and encoding
    - A 24 ↔ B 29 · same · offset 0 · s = 1 · Binding actions
    - A 25–26 ↔ B 30–32 · same · offset 0 · s = 0.950000 · Key encoder
      - A 26 ↔ B 31–32 · summarized · offset 0 · s = 0.9 · Keyboard protocol options
  - A 27–28, 29–30 ↔ B 33–36 · grouped · offset 0 · s = 1 · Mouse, selection, and paste
    - A 28 ↔ B 34, 35 · grouped · offset 0 · s = 1 · Reporting and local selection
    - A 30 ↔ B 36 · same · offset 0 · s = 1 · Paste encoder
  - A 31–34 ↔ B 37–40 · same · offset 0 · s = 1 · IO mailbox and writes
    - A 32 ↔ B 38 · same · offset 0 · s = 1 · Read-only gate
    - A 33–34 ↔ B 39–40 · same · offset 0 · s = 1 · Write dispatch
      - A 34 ↔ B 40 · same · offset 0 · s = 1 · Backend PTY writes
- A 36–47 ↔ B 42–58 · same · offset 0 · s = 0.995833 · Output interpretation
  - A 37–39, 40–42 ↔ B 50–54 · grouped · offset 0 · s = 1 · Locked output and VT parsing
    - A 38, 39, 41–42 ↔ B 51–54 · grouped · offset 0 · s = 1 · Stream advancement and VT dispatch
      - A 42 ↔ B 52 · same · offset 0 · s = 1 · Persistent parser/handler state
  - A 43–47 ↔ B 55–58 · same · offset 0 · s = 0.983333 · Non-grid effects
    - A 44 ↔ B 56 · same · offset 0 · s = 1 · Protocol replies
    - A 45 ↔ B 58 · same · offset 0 · s = 1 · Renderer messages
    - A 46–47 ↔ B 57 · summarized · offset 0 · s = 0.9 · Native UI effects
- A 49–62 ↔ B 60–73 · same · offset 0 · s = 0.999740 · Terminal model
  - A 50–53 ↔ B 61–62, 72–73 · grouped · offset 0 · s = 1 · Terminal operations and state
    - A 51, 52, 53 ↔ B 62, 73 · grouped · offset 0 · s = 1 · Renderer-independent protocol state
  - A 54–62 ↔ B 63–71 · same · offset 0 · s = 0.998958 · ScreenSet
    - A 55 ↔ B 64 · same · offset 0 · s = 1 · Primary and alternate screens
    - A 56–62 ↔ B 65–71 · same · offset 0 · s = 0.995833 · Active Screen
      - A 57 ↔ B 66 · same · offset 0 · s = 1 · Cursor and editing state
      - A 58 ↔ B 67 · same · offset 0 · s = 1 · Extended protocols
      - A 59–62 ↔ B 68–71 · same · offset 0 · s = 0.975000 · PageList
        - A 60 ↔ B 69, 70 · grouped · offset 0 · s = 1 · Ordered pages and cells
        - A 61–62 ↔ B 71 · summarized · offset 0 · s = 0.9 · Tracked pins
- A 64–76 ↔ B 75–88 · same · offset 0 · s = 0.968958 · Rendering
  - A 65–66 ↔ B 76 · summarized · offset 0 · s = 0.9 · Render-thread scheduling
  - A 67–73 ↔ B 79–83 · same · offset 0 · s = 0.951667 · Frame update
    - A 68–70 ↔ B 80, 83 · grouped, summarized · offset 0 · s = 0.9 · Snapshot and synchronization gate
    - A 71–72 ↔ B 81–82 · same · offset 0 · s = 1 · Frame inputs
      - A 72 ↔ B 82 · same · offset 0 · s = 1 · Constructed cell rendering data
    - A 73 ↔ B 84–85 · summarized · offset 1 · s = 0.81 · Fonts and shaping
  - A 74 ↔ B 86–88 · summarized · offset 0 · s = 0.9 · Drawing and presentation
  - A 75–76 ↔ B 77–78 · same · offset 0 · s = 1 · GenericRenderer/backend
    - A 76 ↔ B 78 · same · offset 0 · s = 1 · Graphics backend/device context
- A 78–87 ↔ B 90–99 · same · offset 0 · s = 0.931458 · Geometry and configuration
  - A 79–80 ↔ B 92 · summarized · offset 1 · s = 0.81 · Cell metrics and grid geometry
  - A 81–83 ↔ B 91–97 · same · offset 0 · s = 0.952500 · Resize
    - A 82–83 ↔ B 93–97 · same · offset 0 · s = 0.905000 · Backend/emulator resize
      - A 83 ↔ B 94–97 · summarized · offset 1 · s = 0.81 · Locked resize
  - A 84–87 ↔ B 98–99 · same · offset 0 · s = 0.826250 · Configuration propagation
    - A 85 ↔ B 24–25 · relocated, summarized · offset 1 · s = 0.405 · Surface-derived configuration
    - A 86–87 ↔ B 99 · summarized · offset 0 · s = 0.9 · Worker configuration snapshots
- A 89–97 ↔ B 101–109 · same · offset 0 · s = 0.741875 · Teardown
  - A 91 ↔ B 102 · same · offset 0 · s = 1 · Runtime-managed close
  - A 92–97 ↔ B 103–104, 105–106, 107 · grouped · offset 0 · s = 0.935000 · Surface destruction
    - A 93–94 ↔ B 103–104 · same · offset 1 · s = 0.9 · Stop/join workers
      - A 94 ↔ B 104 · same · offset 0 · s = 1 · Exec shutdown
    - A 95, 96 ↔ B 105–106 · grouped, summarized · offset 1 · s = 0.81 · Renderer/IO destruction ordering
    - A 97 ↔ B 107 · same · offset 1 · s = 0.9 · Release session allocations
  - unmatched: A 90 (child-exit hold/close handling)
  - unmatched: B 108–109 (application shared-resource shutdown)

## Score
Top-level k = 8, uA = 0, uB = 0.

J = (0.869444444 + 0.920312500 + 0.997916667 + 0.995833333 + 0.999739583 + 0.968958333 + 0.931458333 + 0.741875000) / 8 = 0.928192274.

Each nested J uses Σs/(k + uA + uB). A summarized match contributes 0.9 before offset and relocation penalties; a leaf match contributes 1. For example, Exec's inner J is 0.9/2 = 0.45, giving s = (0.5 + 0.5 × 0.45) × 0.5 = 0.3625. Teardown's inner J is (1 + 0.935)/4 = 0.48375, giving s = 0.741875. The common root captions are not an additional scoring level.

## Verdict
The trees share all eight major components and closely agree on input, terminal storage, output handling, and rendering. Differences chiefly concern detail and grouping. Implied parents include IO workers, locked parsing stages, terminal protocol state, and ordered resource destruction. B places interaction state under assembly, Exec startup under output, and Surface-derived configuration under assembly; these relocations are charged under their A anchors, not counted again as unmatched. The callback grouping includes its relocated state portion, so its whole grouped match receives the relocation multiplier. B adds explicit runtime variants, process setup, and application shutdown; A separately identifies child-exit policy. These are representation differences, not judgments of correctness.
