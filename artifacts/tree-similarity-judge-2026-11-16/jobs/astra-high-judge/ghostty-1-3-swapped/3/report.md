## 1. Anchor tree

Ranges include their original subtrees. Relocated descendants are scored at their A location, not again inside the containing B range. Comparisons use residual children after those assignments. Details folded into a matched parent line are not additional unmatched components; offsets below an already-offset anchor are relative to that anchor.

- A 3–12 ↔ B 3–11 · same · offset 0 · s = 0.966667 · Surface/runtime boundary
  - A 4–5 ↔ B 4–5 · summarized · offset 0 · s = 0.9 · callback interface; B 5's retained-state detail is assigned below
  - A 6–8 ↔ B 6–7 · same · offset 0 · s = 1 · apprt integration
    - A 7, 8 ↔ B 7 · grouped · offset 0 · s = 1 · runtime-owned layout/native operations
  - A 9–12 ↔ B 8–11 · same · offset 0 · s = 1 · App coordination
    - A 10 ↔ B 9 · same · offset 0 · s = 1 · registration/focus/mailbox
    - A 11, 12 ↔ B 10 · grouped · offset 0 · s = 1 · shared rendering resources
- A 14–25 ↔ B 13–20 · same · offset 0 · s = 0.853125 · session resources
  - A 15–18 ↔ B 14, 15, 18 · grouped, summarized · offset 0 · s = 0.9 · construction and workers
  - A 19 ↔ B 5 · relocated to runtime boundary · offset 1 · s = 0.45 · retained interaction/session state
  - A 20–21 ↔ B 84–87 · relocated to geometry/configuration · offset 0 · s = 0.475 · owned configuration
    - A 21 ↔ B 85, 86–87 · grouped, summarized · offset 0 · s = 0.9 · configuration replacement/propagation
  - A 22–25 ↔ B 16–17 · same · offset 0 · s = 1 · renderer.State
    - A 23, 24, 25 ↔ B 17 · grouped · offset 0 · s = 1 · shared access and synchronization
- A 27–38 ↔ B 22–34 · same · offset 0 · s = 1 · input processing
  - A 28–31 ↔ B 23–26 · same · offset 0 · s = 1 · keyboard handling
    - A 29 ↔ B 24 · same · offset 0 · s = 1 · bindings
    - A 30–31 ↔ B 25–26 · same · offset 0 · s = 1 · key encoding
      - A 31 ↔ B 26 · same · offset 0 · s = 1 · keyboard protocols
  - A 32–34 ↔ B 27–28, 29–30 · grouped · offset 0 · s = 1 · mouse/paste protocols
    - A 33 ↔ B 28 · same · offset 0 · s = 1 · mouse reporting
    - A 34 ↔ B 30 · same · offset 0 · s = 1 · paste encoding
  - A 35–38 ↔ B 31–34 · same · offset 0 · s = 1 · IO writes
    - A 36 ↔ B 32 · same · offset 0 · s = 1 · readonly filtering
    - A 37–38 ↔ B 33–34 · same · offset 0 · s = 1 · queued writes
      - A 38 ↔ B 34 · same · offset 0 · s = 1 · PTY backend
- A 40–55 ↔ B 36–47 · same · offset 0 · s = 0.845833 · child output
  - A 41–44 ↔ B 19–20 · relocated to session assembly · offset 0 · s = 0.5 · Exec session/reader
    - A 42, 43, 44 ↔ B 20 · grouped · offset 0 · s = 1 · physical-session reader lifetime; subprocess startup is folded into B 19
  - A 45–51, 52–55 ↔ B 37–39, 40–42, 43–47 · grouped · offset 0 · s = 0.883333 · VT processing/effect routing
    - A 46–51 ↔ B 38, 39, 41–42, 44, 45 · grouped · offset 0 · s = 0.95 · parser, handler and worker effects
      - A 47–48, 49 ↔ B 42 · grouped, summarized · offset 0 · s = 0.9 · persistent handler/terminal operations; response and repaint details are already represented by B 44–45
    - A 53 ↔ B 46–47 · summarized · offset 0 · s = 0.9 · surface-effect mailbox
    - A 54–55 ↔ B 11 · relocated to App coordination, summarized · offset 0 · s = 0.45 · validated dispatch
- A 57–70 ↔ B 49–62 · same · offset 0 · s = 0.982396 · terminal model/storage
  - A 58–60 ↔ B 50–53 · same · offset 0 · s = 1 · Terminal
    - A 59 ↔ B 51 · same · offset 0 · s = 1 · geometry
    - A 60 ↔ B 52, 53 · grouped · offset 0 · s = 1 · protocol state/metadata
  - A 61–63 ↔ B 54–62 · same · offset 0 · s = 1 · ScreenSet; Screen is compared separately below
    - A 62, 63 ↔ B 55 · grouped · offset 0 · s = 1 · primary/alternate/active screens
  - A 64–70 ↔ B 56–62 · same, deeper in B · offset 1 · s = 0.894375 · Screen
    - A 65, 66 ↔ B 57, 58 · grouped · offset 0 · s = 1 · screen-local state
    - A 67–70 ↔ B 59–62 · same · offset 0 · s = 0.975 · PageList
      - A 68, 69 ↔ B 60 · grouped · offset 0 · s = 1 · page content; ordering is folded into B 59
      - A 70 ↔ B 61–62 · summarized · offset 0 · s = 0.9 · tracked positions
- A 72–83 ↔ B 64–76 · same · offset 0 · s = 0.940694 · rendering
  - A 73–74 ↔ B 65–66 · same · offset 0 · s = 1 · render scheduling
    - A 74 ↔ B 66 · same · offset 0 · s = 1 · independent rendering worker
  - A 75–80 ↔ B 67–73 · same · offset 0 · s = 0.941667 · frame preparation
    - A 76, 80 ↔ B 71–72 · grouped, summarized · offset 0 · s = 0.9 · snapshot and visual contributions
    - A 77–78 ↔ B 68–70 · same · offset 0 · s = 0.75 · locked snapshot
      - A 78 ↔ B 69 · same · offset 0 · s = 1 · brief shared-state extraction
      - unmatched: B 70 (synchronized-output postponement)
    - A 79 ↔ B 73 · same · offset 0 · s = 1 · fonts and glyph preparation
  - A 81–83 ↔ B 74, 75–76 · grouped · offset 0 · s = 0.7025 · drawing/graphics integration
    - A 82 ↔ B 75–76 · summarized · offset 1 · s = 0.81 · graphics backend/presentation resources
    - unmatched: A 83 (separate main-thread resize drawing path)
- A 85–91 ↔ B 78–87 · same · offset 0 · s = 1 · geometry; B configuration is assigned to A's resource anchor
  - A 86–87 ↔ B 79–80 · same · offset 0 · s = 1 · pixel/cell geometry
    - A 87 ↔ B 80 · same · offset 0 · s = 1 · grid-size calculation
  - A 88–91 ↔ B 81–83 · same · offset 0 · s = 1 · resize coordination; A 91's renderer message is folded into B 81
    - A 89–90 ↔ B 82–83 · same · offset 0 · s = 1 · locked backend/emulator resize
      - A 90 ↔ B 83 · same · offset 0 · s = 1 · consistent dimensions
- A 93–103 ↔ B 89–97 · same · offset 0 · s = 0.94375 · teardown
  - A 94–95 ↔ B 90 · summarized · offset 0 · s = 0.9 · child-exit policy
  - A 96–97 ↔ B 91 · summarized · offset 0 · s = 0.9 · runtime-managed close
  - A 98–103 ↔ B 92–97 · same · offset 0 · s = 0.8625 · Surface.deinit
    - A 99, 100 ↔ B 93–94 · grouped, summarized · offset 0 · s = 0.9 · worker/reader shutdown
    - A 101 ↔ B 95, 96 · grouped · offset 0 · s = 1 · renderer/IO release
    - A 102 ↔ B 97 · same · offset 0 · s = 1 · fonts/local allocations
    - unmatched: A 103 (application-wide final teardown)

## 2. Score

Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner), with a further × 0.5 for relocation. Summaries use inner = 0.8; leaf matches use inner = 1. Grouped matches count once.

Top-level anchor scores:

| Anchor | s |
|---|---:|
| Runtime boundary | 0.966666667 |
| Session resources | 0.853125000 |
| Input | 1.000000000 |
| Child output | 0.845833333 |
| Terminal model | 0.982395833 |
| Rendering | 0.940694444 |
| Geometry | 1.000000000 |
| Teardown | 0.943750000 |

There are eight anchored pairs and no unmatched top-level components:

J = (0.966666667 + 0.853125 + 1 + 0.845833333 + 0.982395833 + 0.940694444 + 1 + 0.94375) / (8 + 0 + 0)

J = 7.532465278 / 8 = **0.941558160**.

For example, snapshot extraction has inner J = 1/(1+0+1) = 0.5, hence s = 0.75. Relocated configuration has inner J = 0.9, hence s = (0.5 + 0.5×0.9)×0.5 = 0.475. The nested Level objects give the remaining arithmetic.

## 3. Verdict

The trees identify essentially the same eight major components and closely agree on their internal code boundaries. Their strongest agreement is in input handling, terminal storage, geometry and shutdown. Most differences are grouping or detail: implied parents include shared rendering resources, mouse/paste protocols, VT processing/effect routing and worker shutdown. B nests Screen under ScreenSet, while A presents them beside each other. Configuration, Exec startup, retained interaction state and validated App dispatch move between top-level explanatory owners; these are presentation relocations, not different implementations. The remaining unmatched breakdowns are small: B's synchronized-output condition, A's separate main-thread resize drawing path and A's final App teardown.
