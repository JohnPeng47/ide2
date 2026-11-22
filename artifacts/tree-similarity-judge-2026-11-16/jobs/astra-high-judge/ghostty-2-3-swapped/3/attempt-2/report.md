## 1. Anchor tree

Ranges include complete subtrees. Grouped comparisons use an implied shared parent; folded explanations are not counted again as independent components. Offsets describe additional nesting relative to the matched context. Same-top-level regrouping is not relocation.

- A 3–12 ↔ B 3–14 · same · offset 0 · s = 0.940278 · Surface and host integration
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 1 · Surface event interface
    - A 5 ↔ B 5 · same · offset 0 · s = 1 · Platform-independent interaction
  - A 6–8 ↔ B 6–8 · same · offset 0 · s = 0.666667 · Runtime boundary
    - A 8 ↔ B 8 · same · offset 0 · s = 1 · Runtime UI actions
    - unmatched: A 7 (host placement), B 7 (runtime selection)
  - A 9–12 ↔ B 9–14 · same · offset 0 · s = 0.975 · App coordination
    - A 10 ↔ B 10 · same · offset 0 · s = 1 · Registration and focus
    - A 11 + 12 ↔ B 11–12 · grouped, summarized · offset 0 · s = 0.9 · Shared resources
- A 14–25 ↔ B 16–25 · same · offset 0 · s = 0.916979 · Session resources
  - A 15–18 ↔ B 17 + 18 · grouped, summarized · offset 0 · s = 0.9 · I/O, renderer and workers
  - A 19 ↔ B 22–23 · summarized · offset 0 · s = 0.9 · Interaction state
  - A 20–21 ↔ B 24–25 · same · offset 0 · s = 0.7025 · Derived configuration
    - A 21 ↔ B 98–99 · relocated, summarized · offset 1 · s = 0.405 · Configuration propagation
  - A 22–25 ↔ B 19–21 · same · offset 0 · s = 0.833333 · Shared renderer state
    - A 23 ↔ B 20 · same · offset 0 · s = 1 · Terminal reference
    - A 24 ↔ B 21 · same · offset 0 · s = 1 · Mutex
    - unmatched: A 25 (fairness/yield policy, beyond the shared snapshot-lock mechanism)
- A 27–38 ↔ B 27–40 · same · offset 0 · s = 0.970139 · User input
  - A 28–31 ↔ B 28–32 · same · offset 0 · s = 0.9875 · Keyboard handling
    - A 29 ↔ B 29 · same · offset 0 · s = 1 · Binding actions
    - A 30–31 ↔ B 30–32 · same · offset 0 · s = 0.95 · Key encoding
      - A 31 ↔ B 31–32 · summarized · offset 0 · s = 0.9 · Protocol options
  - A 32–34 ↔ B 33–36 · same · offset 0 · s = 0.833333 · Mouse and paste
    - A 33 ↔ B 34 · same · offset 0 · s = 1 · Mouse encoding
    - A 34 ↔ B 36 · same · offset 0 · s = 1 · Paste encoding
    - unmatched: B 35 (local selection operation)
  - A 35–38 ↔ B 37–40 · same · offset 0 · s = 1 · Queued writes
    - A 36 ↔ B 38 · same · offset 0 · s = 1 · Readonly filtering
    - A 37–38 ↔ B 39–40 · same · offset 0 · s = 1 · Mailbox dispatch
      - A 38 ↔ B 40 · same · offset 0 · s = 1 · PTY writes
- A 40–55 ↔ B 42–58 · same · offset 0 · s = 0.857847 · Child output
  - A 41–44 ↔ B 43–49 · same · offset 0 · s = 0.725 · Exec session
    - A 42 + 43 + 44 ↔ B 45–49 · grouped, summarized · offset 0 · s = 0.9 · Startup and readers
    - unmatched: B 44 (launch configuration)
  - A 45–51 ↔ B 50–54 · same · offset 0 · s = 0.983333 · Locked processing
    - A 46–51 ↔ B 51–54 · same · offset 0 · s = 0.966667 · Stream and handler
      - A 47–48 + 49 ↔ B 53–54 · grouped · offset 0 · s = 1 · Terminal operations
        - A 48 ↔ B 54 · same · offset 0 · s = 1 · Handler implementation
      - A 50 ↔ B 56 · same · offset 1 · s = 0.9 · Protocol replies
      - A 51 ↔ B 58 · same · offset 1 · s = 0.9 · Renderer notifications
  - A 52–55 ↔ B 13–14 + 57 · grouped, relocated · offset 1 · s = 0.43875 · UI messages
    - A 53 + 54–55 ↔ B 14 · grouped, summarized · offset 0 · s = 0.9 · Mailbox and App dispatch
- A 57–70 ↔ B 60–73 · same · offset 0 · s = 0.97625 · Terminal model
  - A 58–60 ↔ B 61–62 · same · offset 0 · s = 0.905 · Operations and state
    - A 59 + 60 ↔ B 72–73 · grouped, summarized · offset 1 · s = 0.81 · Geometry and protocol fields
  - A 61–63 + 64–70 ↔ B 63–71 · grouped · offset 0 · s = 1 · Screen ownership
    - A 62 ↔ B 64 · same · offset 0 · s = 1 · Screen initialization
    - A 63 + 64–70 ↔ B 65–71 · grouped · offset 0 · s = 1 · Active Screen contents
      - A 65 ↔ B 66 · same · offset 0 · s = 1 · Cursor, selection and keyboard state
      - A 66 ↔ B 67 · same · offset 0 · s = 1 · Images and prompt state
      - A 67–70 ↔ B 68–71 · same · offset 0 · s = 1 · PageList
        - A 68 ↔ B 69 · same · offset 0 · s = 1 · Page ordering
        - A 69 ↔ B 70 · same · offset 0 · s = 1 · Rows and cells
        - A 70 ↔ B 71 · same · offset 0 · s = 1 · Tracked pins
- A 72–83 ↔ B 75–88 · same · offset 0 · s = 0.946458 · Rendering
  - A 73–74 ↔ B 76 + 87 · grouped, summarized · offset 0 · s = 0.9 · Scheduling
  - A 75–80 ↔ B 79–83 · same · offset 0 · s = 0.82625 · Frame preparation
    - A 76 + 77–78 ↔ B 80 · grouped, summarized · offset 0 · s = 0.9 · RenderState snapshot
    - A 79 ↔ B 84–85 · summarized · offset 1 · s = 0.81 · Font shaping
    - A 80 ↔ B 81–82 · summarized · offset 0 · s = 0.9 · Presentation inputs
    - unmatched: B 83 (synchronized-output deferral)
  - A 81–83 ↔ B 86–88 · same · offset 0 · s = 0.9525 · Presentation
    - A 82 ↔ B 77–78 · summarized · offset 1 · s = 0.81 · Graphics API
    - A 83 ↔ B 88 · same · offset 0 · s = 1 · Synchronous drawing
- A 85–91 ↔ B 90–99 · same · offset 0 · s = 0.9525 · Geometry coordination
  - A 86–87 ↔ B 91–97 · same · offset 0 · s = 1 · Surface sizing
    - A 87 ↔ B 92 · same · offset 0 · s = 1 · Pixel-to-grid conversion
  - A 88–91 ↔ B 94–97 · same · offset 2 · s = 0.81 · I/O resize
    - A 89–90 ↔ B 95–96 · same · offset 0 · s = 1 · Locked resizing
      - A 90 ↔ B 96 · same · offset 0 · s = 1 · Dimension consistency
    - A 91 ↔ B 97 · same · offset 0 · s = 1 · Renderer notification
- A 93–103 ↔ B 101–109 · same · offset 0 · s = 0.810417 · Close and teardown
  - A 96–97 ↔ B 102 · summarized · offset 0 · s = 0.9 · Runtime close
  - A 98–103 ↔ B 103–104 + 105–106 + 107 + 108–109 · grouped · offset 0 · s = 0.9625 · Deinitialization
    - A 99 + 100 ↔ B 103–104 · grouped, summarized · offset 0 · s = 0.9 · Worker shutdown
    - A 101 ↔ B 105–106 · summarized · offset 0 · s = 0.9 · Resource destruction
    - A 102 ↔ B 107 · same · offset 0 · s = 1 · Allocation and font-reference release
    - A 103 ↔ B 108–109 · summarized · offset 0 · s = 0.9 · App resource destruction
  - unmatched: A 94–95 (child-exit reporting and hold-open policy)

## 2. Score

Each nested J is recorded in the anchor data. Summarized pairs have base s = 0.9; offsets multiply by 0.9^offset, and relocation multiplies by 0.5. For example, configuration propagation scores 0.9 × 0.9 × 0.5 = 0.405. UI messaging scores 0.9 × (0.5 + 0.5 × 0.9) × 0.5 = 0.43875.

Top-level s values:

| Anchor | s |
|---|---:|
| Surface/host integration | 0.940277778 |
| Session resources | 0.916979167 |
| User input | 0.970138889 |
| Child output | 0.857847222 |
| Terminal model | 0.976250000 |
| Rendering | 0.946458333 |
| Geometry | 0.952500000 |
| Teardown | 0.810416667 |

J = Σs / (k + uA + uB) = 7.3708680555555555 / (8 + 0 + 0) = **0.9213585069444444**.

## 3. Verdict

The trees identify the same eight major components and closely agree on their internal code: Surface, App/runtime integration, Termio/Exec, input encoders, Terminal/Screen/PageList, renderer preparation/presentation, resize handling and teardown. Most differences are detail or grouping. Implied parents include shared App resources, subprocess startup/readers, StreamHandler effects, active Screen contents and ordered deinitialization. B places App message dispatch under integration and configuration propagation under resize/configuration, producing the two cross-owner matches. Its deeper resize nesting costs slightly; A's explicit child-exit policy is the largest unmatched teardown detail. These are representation differences, not judgments of correctness or completeness.
