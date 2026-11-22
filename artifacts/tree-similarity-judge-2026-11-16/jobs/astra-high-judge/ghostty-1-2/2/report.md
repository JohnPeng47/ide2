## 1. Anchor tree

The common session root is implicit; its eight component branches form the scored top level. Descriptions already expressed in matched parent lines are folded into those anchors rather than treated as extra components. Offsets measure additional nesting relative to the enclosing match. Relocated parts are recorded under their A location, not again as unmatched B nodes.

- A 3–11 ↔ B 3–14 · same · offset 0 · s = 0.911111 · runtime boundary
  - A 4–5 ↔ B 4–5, 22–23 · grouped, relocated · offset 0 · s = 0.5 · callbacks and interaction state; B places the state under assembly
    - A 5 ↔ B 5, 23 · grouped · offset 0 · s = 1 · native events and session ownership
  - A 6–7 ↔ B 6–8 · same · offset 0 · s = 1 · apprt integration
    - A 7 ↔ B 8 · same · offset 0 · s = 1 · UI delegation
  - A 8–11 ↔ B 9–14 · same · offset 0 · s = 0.966667 · App coordination
    - A 9 ↔ B 10 · same · offset 0 · s = 1 · registry and focus
    - A 10 ↔ B 11–12 · summarized · offset 0 · s = 0.9 · shared resource declarations
    - A 11 ↔ B 13–14 · summarized · offset 0 · s = 0.9 · mailbox dispatch
- A 13–20 ↔ B 16–25 · same · offset 0 · s = 0.917641 · session assembly
  - A 14, 18 ↔ B 17 · grouped · offset 0 · s = 1 · Termio and worker
  - A 15 ↔ B 18 · same · offset 0 · s = 1 · renderer and worker
  - A 16–17 ↔ B 19–21 · same · offset 0 · s = 1 · renderer.State
    - A 17 ↔ B 20, 21 · grouped · offset 0 · s = 1 · protected shared references
  - A 19–20 ↔ B 43–49 · relocated to output · offset 0 · s = 0.341125 · Exec lifecycle
    - A 20 ↔ B 47–49 · summarized · offset 2 · s = 0.729 · output reader
    - unmatched: B 44 (launch configuration)
- A 22–34 ↔ B 27–40 · same · offset 0 · s = 0.997917 · input
  - A 23–26 ↔ B 28–32 · same · offset 0 · s = 0.9875 · keyboard
    - A 24 ↔ B 29 · same · offset 0 · s = 1 · bindings
    - A 25–26 ↔ B 30–32 · same · offset 0 · s = 0.95 · key encoding
      - A 26 ↔ B 31–32 · summarized · offset 0 · s = 0.9 · protocol inputs
  - A 27–28, 29–30 ↔ B 33–36 · grouped · offset 0 · s = 1 · mouse, selection, and paste
    - A 28 ↔ B 34, 35 · grouped · offset 0 · s = 1 · reporting and selection
    - A 30 ↔ B 36 · same · offset 0 · s = 1 · paste encoding
  - A 31–34 ↔ B 37–40 · same · offset 0 · s = 1 · queued writes
    - A 32 ↔ B 38 · same · offset 0 · s = 1 · read-only filtering
    - A 33–34 ↔ B 39–40 · same · offset 0 · s = 1 · write dispatch
      - A 34 ↔ B 40 · same · offset 0 · s = 1 · Exec writing
- A 36–47 ↔ B 42–58 · same · offset 0 · s = 0.983333 · output interpretation
  - A 37–39, 40–42 ↔ B 50–54 · grouped · offset 0 · s = 0.95 · processing and parser
    - A 38, 39 ↔ B 51–54 · grouped, summarized · offset 0 · s = 0.9 · locked stream consumption; parser details are folded into this processing group
  - A 43–47 ↔ B 55–58 · same · offset 0 · s = 0.983333 · external effects
    - A 44 ↔ B 56 · same · offset 0 · s = 1 · replies
    - A 45 ↔ B 58 · same · offset 0 · s = 1 · renderer notifications
    - A 46–47 ↔ B 57 · summarized · offset 0 · s = 0.9 · native UI effects
- A 49–62 ↔ B 60–73 · same · offset 0 · s = 0.801406 · terminal model
  - A 51, 52, 53 ↔ B 72–73 · grouped, summarized · offset 1 · s = 0.81 · terminal fields
  - A 54–62 ↔ B 63–71 · same · offset 0 · s = 0.998438 · ScreenSet
    - A 55 ↔ B 64 · same · offset 0 · s = 1 · primary and alternate screens
    - A 56–62 ↔ B 65–71 · same · offset 0 · s = 0.99375 · active Screen
      - A 57, 58 ↔ B 66, 67 · grouped · offset 0 · s = 1 · per-screen state
      - A 59–62 ↔ B 68–71 · same · offset 0 · s = 0.975 · PageList
        - A 60 ↔ B 69, 70 · grouped · offset 0 · s = 1 · pages and cells
        - A 61–62 ↔ B 71 · summarized · offset 0 · s = 0.9 · tracked positions
  - unmatched: B 61–62 (explicit Terminal manipulation API)
- A 64–76 ↔ B 75–88 · same · offset 0 · s = 0.934583 · rendering
  - A 65–66 ↔ B 76 · summarized · offset 0 · s = 0.9 · scheduling
  - A 67–73 ↔ B 79–83, 84–85 · grouped · offset 0 · s = 0.951667 · frame construction
    - A 68–70 ↔ B 80, 83 · grouped, summarized · offset 0 · s = 0.9 · snapshot and synchronized output
    - A 71–72 ↔ B 81–82 · same · offset 0 · s = 1 · extracted rendering inputs
      - A 72 ↔ B 82 · same · offset 0 · s = 1 · cell rendering preparation
    - A 73 ↔ B 84–85 · summarized · offset 1 · s = 0.81 · font shaping
  - A 74 ↔ B 86–88 · summarized · offset 0 · s = 0.9 · drawing
  - A 75–76 ↔ B 77–78 · same · offset 0 · s = 0.725 · graphics implementation
    - A 76 ↔ B 12 · relocated to App resources · offset 1 · s = 0.45 · device ownership; this matches the borrowing relationship, separately from the resource declarations above
- A 78–87 ↔ B 90–99 · same · offset 0 · s = 0.927292 · geometry and configuration
  - A 79–80 ↔ B 92 · summarized · offset 1 · s = 0.81 · grid metrics
  - A 81–83 ↔ B 91–97 · same · offset 0 · s = 0.9275 · resize
    - A 82–83 ↔ B 94–97 · same · offset 1 · s = 0.855 · backend and terminal resize
      - A 83 ↔ B 95–96 · summarized · offset 0 · s = 0.9 · resize exclusion
  - A 84–87 ↔ B 98–99 · same · offset 0 · s = 0.82625 · configuration updates
    - A 85 ↔ B 24–25 · summarized, relocated to assembly · offset 1 · s = 0.405 · Surface derived configuration
    - A 86–87 ↔ B 99 · summarized · offset 0 · s = 0.9 · worker configuration
- A 89–97 ↔ B 101–109 · same · offset 0 · s = 0.741875 · shutdown
  - A 91 ↔ B 102 · same · offset 0 · s = 1 · runtime closure
  - A 92–97 ↔ B 103–104, 105–106, 107 · grouped · offset 0 · s = 0.935 · Surface.deinit
    - A 93–94 ↔ B 103–104 · same · offset 1 · s = 0.9 · stop workers
      - A 94 ↔ B 104 · same · offset 0 · s = 1 · Exec shutdown
    - A 95, 96 ↔ B 105–106 · grouped, summarized · offset 1 · s = 0.81 · destroy renderer and terminal resources
    - A 97 ↔ B 107 · same · offset 1 · s = 0.9 · remaining allocations
  - unmatched: A 90 (child-exit hold/close handling), B 108–109 (App-wide destruction)

## 2. Score

At the top level, k = 8 and uA = uB = 0.

J = (0.9111111111 + 0.9176406250 + 0.9979166667 + 0.9833333333 + 0.8014062500 + 0.9345833333 + 0.9272916667 + 0.7418750000) / 8 = **0.9018947483**.

Each nested J uses the same sum-over-pairs-and-unmatched formula. For example, the relocated Exec anchor has inner = 0.729 / (1 + 1) = 0.3645, giving s = 0.5 × (0.5 + 0.5 × 0.3645) = 0.341125. Shutdown has inner = (1 + 0.935) / (2 + 1 + 1) = 0.48375, giving s = 0.741875. Calculations use unrounded values.

## 3. Verdict

The trees identify the same eight major components and closely agree on input handling, output interpretation, screen storage, and rendering. Most differences are additional detail or grouping. Implied parents include the Termio/worker bundle, non-keyboard input, the locked parsing pipeline, frame construction, and Surface.deinit. B relocates Exec startup to output, interaction state and derived configuration to assembly, and device borrowing to App. These are presentation-owner changes, not evidence of different implementations. The clearest unmatched breakdowns are B's explicit Terminal API and App destruction, and A's child-exit handling.
