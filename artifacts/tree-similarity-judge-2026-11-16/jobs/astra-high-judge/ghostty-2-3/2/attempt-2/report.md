## 1. Anchor tree

Ranges include complete source subtrees. Where a parent folds in a component named separately by the other tree, its label is compared separately from descendants already assigned elsewhere. Such descendants are not counted twice. In particular, B 21, B 47–51, B 54–55, B 59–60, B 79 and B 82 are assigned to the specific anchors below. Grouped unions supply implied parents rather than additional components. Call-flow wording is not scored.

- A 3–14 ↔ B 3–12 · same · offset 0 · s = 0.920833 · Surface integration boundary
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 1 · event interface
    - A 5 ↔ B 5 · same · offset 0 · s = 1 · terminal interaction
  - A 6–8 ↔ B 6–8 · same · offset 0 · s = 0.666667 · runtime boundary
    - A 8 ↔ B 8 · same · offset 0 · s = 1 · native action delegation
    - unmatched: A 7 (runtime selection), B 7 (window/tab/split placement)
  - A 9–14 ↔ B 9–12 · same · offset 0 · s = 0.858333 · App coordination
    - A 10 ↔ B 10 · same · offset 0 · s = 1 · registration and focus
    - A 11–12 ↔ B 11 + 12 · grouped, summarized · offset 0 · s = 0.9 · shared rendering resources
    - A 13–14 ↔ B 54–55 · relocated to child-output handling · offset 0 · s = 0.25 · message dispatch
      - unmatched: A 14 (thread-affinity detail), B 55 (existence-check detail)
- A 16–25 ↔ B 14–25 · same · offset 0 · s = 0.941667 · session assembly
  - A 17 + 18 ↔ B 15–18 · grouped, summarized · offset 0 · s = 0.9 · I/O, renderer and workers
  - A 19–21 ↔ B 22–25 · same · offset 0 · s = 0.833333 · shared renderer state
    - A 20 ↔ B 23 · same · offset 0 · s = 1 · terminal reference
    - A 21 ↔ B 24 · same · offset 0 · s = 1 · mutex
    - unmatched: B 25 (starvation-control API)
  - A 22–23 ↔ B 19 · summarized · offset 0 · s = 0.9 · session fields
  - A 24–25 ↔ B 20–21 · summarized after extracting B 21 below · offset 0 · s = 0.9 · owned configuration
- A 27–40 ↔ B 27–38 · same · offset 0 · s = 0.970139 · user input
  - A 28–32 ↔ B 28–31 · same · offset 0 · s = 0.9875 · keyboard handling
    - A 29 ↔ B 29 · same · offset 0 · s = 1 · binding actions
    - A 30–32 ↔ B 30–31 · same · offset 0 · s = 0.95 · encoding
      - A 31–32 ↔ B 31 · summarized · offset 0 · s = 0.9 · protocol options
  - A 33–36 ↔ B 32–34 · same · offset 0 · s = 0.833333 · mouse and paste
    - A 34 ↔ B 33 · same · offset 0 · s = 1 · mouse encoding
    - A 36 ↔ B 34 · same · offset 0 · s = 1 · paste encoding
    - unmatched: A 35 (local Screen.select operation)
  - A 37–40 ↔ B 35–38 · same · offset 0 · s = 1 · queued writes
    - A 38 ↔ B 36 · same · offset 0 · s = 1 · readonly filtering
    - A 39–40 ↔ B 37–38 · same · offset 0 · s = 1 · Termio write handling
      - A 40 ↔ B 38 · same · offset 0 · s = 1 · Exec PTY writes
- A 42–58 ↔ B 40–55 · same · offset 0 · s = 0.944444 · child output
  - A 43–49 ↔ B 41–44 · same · offset 0 · s = 0.725 · Exec session
    - A 45–49 ↔ B 42 + 43 + 44 · grouped, summarized · offset 0 · s = 0.9 · startup and readers
    - unmatched: A 44 (process-configuration inputs)
  - A 50–54 ↔ B 45–51 · same · offset 0 · s = 0.975 · locked processing
    - A 51–54 ↔ B 46–51 · same · offset 0 · s = 0.95 · VT interpretation
      - A 52 ↔ B 46–51 · folded parent label; descendants assigned separately · offset 1 · s = 0.9 · terminal.Stream
      - A 53–54 ↔ B 49 · summarized · offset 0 · s = 0.9 · terminal mutations
  - A 55–58 ↔ B 47–48 + 50 + 51 + 53 · grouped · offset 0 · s = 0.966667 · StreamHandler session services
    - A 56 ↔ B 50 · same · offset 1 · s = 0.9 · protocol replies
    - A 57 ↔ B 53 · same · offset 0 · s = 1 · surface mailbox
    - A 58 ↔ B 51 · same · offset 1 · s = 0.9 · render notification
- A 60–73 ↔ B 57–70 · same · offset 0 · s = 0.949583 · terminal model
  - A 61–62 ↔ B 58–60 · summarized after extracting B 59–60 · offset 0 · s = 0.9 · Terminal operations
  - A 63–71 ↔ B 61–63 + 64–70 · grouped · offset 0 · s = 0.9875 · ScreenSet and screens
    - A 64 ↔ B 62 · same · offset 0 · s = 1 · primary/alternate allocation
    - A 65–71 ↔ B 63 + 64–70 · grouped · offset 0 · s = 0.95 · active Screen
      - A 66 ↔ B 65 · same · offset 1 · s = 0.9 · cursor, selection and keyboard state
      - A 67 ↔ B 66 · same · offset 1 · s = 0.9 · image and prompt state
      - A 68–71 ↔ B 67–70 · same · offset 1 · s = 0.9 · PageList
        - A 69 ↔ B 68 · same · offset 0 · s = 1 · page ordering
        - A 70 ↔ B 69 · same · offset 0 · s = 1 · rows and cells
        - A 71 ↔ B 70 · same · offset 0 · s = 1 · tracked pins
  - A 72–73 ↔ B 59 + 60 · grouped, summarized · offset 1 · s = 0.81 · geometry and protocol fields
- A 75–88 ↔ B 72–83 · same · offset 0 · s = 0.908667 · rendering
  - A 76 ↔ B 73–74 · summarized · offset 0 · s = 0.9 · renderer thread
  - A 77–78 ↔ B 82 · summarized · offset 1 · s = 0.81 · graphics API selection
  - A 79–83 ↔ B 75–80 · same; locking folded into parent · offset 0 · s = 0.816667 · state extraction
    - A 80 ↔ B 76 · same · offset 0 · s = 1 · RenderState
    - A 81–82 ↔ B 80 · summarized · offset 0 · s = 0.9 · visible inputs
    - unmatched: A 83 (synchronized-output deferral)
  - A 84–85 ↔ B 79 · summarized · offset 1 · s = 0.81 · shaping
  - A 86–88 ↔ B 81–83 · same · offset 0 · s = 0.75 · presentation
    - A 88 ↔ B 83 · same · offset 0 · s = 1 · Surface drawing
    - unmatched: A 87 (visibility/vsync detail)
- A 90–99 ↔ B 85–91 · same · offset 0 · s = 0.842188 · geometry/configuration coordination
  - A 91–97 ↔ B 86–87 + 88–91 · grouped · offset 0 · s = 0.96375 · session resize
    - A 92 ↔ B 87 · same · offset 0 · s = 1 · grid geometry
    - A 93–97 ↔ B 88–91 · same · offset 1 · s = 0.855 · queued resize
      - A 95–96 ↔ B 89–90 · same · offset 1 · s = 0.9 · locked resize
        - A 96 ↔ B 90 · same · offset 0 · s = 1 · dimension consistency
      - A 97 ↔ B 91 · same · offset 1 · s = 0.9 · renderer notification
  - A 98–99 ↔ B 21 · relocated to session assembly, summarized · offset 1 · s = 0.405 · configuration propagation
- A 101–109 ↔ B 93–103 · same · offset 0 · s = 0.875833 · teardown
  - A 102 ↔ B 96–97 · summarized · offset 0 · s = 0.9 · runtime close
  - A 103–104 ↔ B 99 + 100 · grouped, summarized · offset 0 · s = 0.9 · worker shutdown
  - A 105–106 ↔ B 101 · summarized · offset 0 · s = 0.9 · object destruction
  - A 107 ↔ B 102 · same · offset 0 · s = 1 · allocation/reference release
  - A 108–109 ↔ B 103 · summarized · offset 1 · s = 0.81 · App resource destruction
  - unmatched: B 94–95 (child-exit reporting and hold-open policy)

## 2. Score

Each level uses J = Σs / (k + uA + uB). Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner), additionally multiplied by 0.5 for relocation. Summaries use inner = 0.8; leaves use inner = 1.

Top-level contributions:

| Anchor | Inner J | s |
|---|---:|---:|
| Surface integration | 0.841666667 | 0.920833333 |
| Session assembly | 0.883333333 | 0.941666667 |
| User input | 0.940277778 | 0.970138889 |
| Child output | 0.888888889 | 0.944444444 |
| Terminal model | 0.899166667 | 0.949583333 |
| Rendering | 0.817333333 | 0.908666667 |
| Geometry/configuration | 0.684375000 | 0.842187500 |
| Teardown | 0.751666667 | 0.875833333 |

J = (0.920833333 + 0.941666667 + 0.970138889 + 0.944444444 + 0.949583333 + 0.908666667 + 0.842187500 + 0.875833333) / (8 + 0 + 0) = 7.353354167 / 8 = **0.919169271**. Calculations use unrounded values.

## 3. Verdict

The trees identify the same eight major components and closely agree on their internals: Surface/App integration, session resources, input, Exec/Termio output, Terminal/Screen/PageList state, rendering, resizing and teardown. Most differences are detail or grouping. Implied parents include shared rendering resources, startup/readers, StreamHandler session services, ScreenSet-owned screens and coordinated resize. B places App message dispatch under output and configuration propagation under assembly; these are presentation-owner changes, not different code. A adds selection and rendering details, while B separately identifies starvation control and child-exit policy.
