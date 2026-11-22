## 1. Anchor tree

The common Surface root is a wrapper; its eight component branches form the scored top level. Ranges include whole subtrees. Details folded into matched parent lines are not counted again as unmatched. Relocated descendants are scored only at their A location. Offsets are local to each comparison, not cumulative absolute depths.

- A 3–11 ↔ B 3–12 · same · offset 0 · s = 0.938889 · Runtime boundary and App
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 0.725 · Surface event interface
    - A 5 ↔ B 19 · relocated to session assembly · offset 1 · s = 0.45 · Interaction/session state
  - A 6–7 ↔ B 6–8 · same · offset 0 · s = 1 · Runtime interface
    - A 7 ↔ B 8 · same · offset 0 · s = 1 · Native UI delegation
  - A 8–11 ↔ B 9–12 · same · offset 0 · s = 0.908333 · App
    - A 9 ↔ B 10 · same · offset 0 · s = 1 · Registry, focus and mailbox
    - A 10 ↔ B 11 + 12 · grouped · offset 0 · s = 1 · Shared rendering resources
    - A 11 ↔ B 54–55 · summarized, relocated to child-output effects · offset 0 · s = 0.45 · Validated message dispatch
- A 13–20 ↔ B 14–25 · same · offset 0 · s = 0.858333 · Session assembly
  - A 14 + 15 + 18 ↔ B 15–18 · grouped, summarized · offset 0 · s = 0.9 · Session resources and workers
  - A 16–17 ↔ B 22–25 · same · offset 0 · s = 0.75 · Shared renderer state
    - A 17 ↔ B 23 + 24 · grouped · offset 0 · s = 1 · Protected references to session state
    - unmatched: B 25 (demand-lock fairness helpers)
  - A 19–20 ↔ B 41–44 · relocated to child output · offset 0 · s = 0.5 · Exec subprocess and reader ownership
    - A 20 ↔ B 43 + 44 · grouped · offset 0 · s = 1 · Reader implementation
- A 22–34 ↔ B 27–38 · same · offset 0 · s = 1 · Input and writes
  - A 23–26 ↔ B 28–31 · same · offset 0 · s = 1 · Keyboard handling
    - A 24 ↔ B 29 · same · offset 0 · s = 1 · Binding actions
    - A 25–26 ↔ B 30–31 · same · offset 0 · s = 1 · Key encoding
      - A 26 ↔ B 31 · same · offset 0 · s = 1 · Keyboard protocol state
  - A 27–28 + 29–30 ↔ B 32–34 · grouped · offset 0 · s = 1 · Mouse and paste protocols
    - A 28 ↔ B 33 · same · offset 0 · s = 1 · Mouse reporting
    - A 30 ↔ B 34 · same · offset 0 · s = 1 · Paste encoding
  - A 31–34 ↔ B 35–38 · same · offset 0 · s = 1 · IO messages and writes
    - A 32 ↔ B 36 · same · offset 0 · s = 1 · Readonly filtering
    - A 33–34 ↔ B 37–38 · same · offset 0 · s = 1 · Queued backend writes
      - A 34 ↔ B 38 · same · offset 0 · s = 1 · Exec PTY writes
- A 36–47 ↔ B 40–55 · same · offset 0 · s = 0.969375 · Child output and VT interpretation
  - A 37–39 + 40–42 ↔ B 45–51 · grouped · offset 0 · s = 0.9275 · Locked output processing and interpreter
    - A 41–42 ↔ B 47–48 + 49 · grouped · offset 1 · s = 0.855 · StreamHandler operations
      - A 42 ↔ B 49 · same · offset 1 · s = 0.9 · Persistent protocol state
  - A 43–47 ↔ B 52–55 · same · offset 0 · s = 0.95 · StreamHandler effects
    - A 44 ↔ B 50 · same, differently nested · offset 1 · s = 0.9 · Protocol replies
    - A 45 ↔ B 51 · same, differently nested · offset 1 · s = 0.9 · Renderer notification
    - A 46–47 ↔ B 53 · summarized · offset 0 · s = 0.9 · Surface UI messages
- A 49–62 ↔ B 57–70 · same · offset 0 · s = 0.993516 · Terminal model
  - A 50–53 ↔ B 58–60 · same · offset 0 · s = 1 · Terminal
    - A 51 ↔ B 59 · same · offset 0 · s = 1 · Geometry
    - A 52 + 53 ↔ B 60 · grouped · offset 0 · s = 1 · Protocol state and metadata
  - A 54–62 ↔ B 61–63 · same · offset 0 · s = 0.974063 · ScreenSet
    - A 55 ↔ B 62 + 63 · grouped · offset 0 · s = 1 · Screen selection
    - A 56–62 ↔ B 64–70 · differently nested · offset 1 · s = 0.89625 · Screen
      - A 57 ↔ B 65 · same · offset 0 · s = 1 · Editing state
      - A 58 ↔ B 66 · same · offset 0 · s = 1 · Extended protocols
      - A 59–62 ↔ B 67–70 · same · offset 0 · s = 0.975 · PageList
        - A 60 ↔ B 69 · same · offset 0 · s = 1 · Page storage
        - A 61–62 ↔ B 70 · summarized · offset 0 · s = 0.9 · Tracked positions
- A 64–76 ↔ B 72–83 · same · offset 0 · s = 0.940694 · Rendering
  - A 65–66 ↔ B 73–74 · same · offset 0 · s = 1 · Renderer scheduling
    - A 66 ↔ B 74 · same · offset 0 · s = 1 · Thread implementation
  - A 67–73 ↔ B 75–80 · same · offset 0 · s = 0.941667 · Frame update
    - A 68–70 ↔ B 77–78 · same · offset 0 · s = 0.75 · Locked snapshot
      - A 69 ↔ B 78 · same · offset 0 · s = 1 · Brief snapshot
      - unmatched: A 70 (synchronized-output deferral)
    - A 71–72 ↔ B 76 + 80 · grouped, summarized · offset 0 · s = 0.9 · Snapshot and frame contributors
    - A 73 ↔ B 79 · same · offset 0 · s = 1 · Font shaping
  - A 74 + 75–76 ↔ B 81–83 · grouped · offset 0 · s = 0.7025 · Drawing and graphics backend
    - A 75–76 ↔ B 82 · summarized · offset 1 · s = 0.81 · Metal/OpenGL selection
    - unmatched: B 83 (main-thread resize drawing)
- A 78–87 ↔ B 85–91 · same · offset 0 · s = 0.86875 · Geometry and configuration
  - A 79–80 + 81–83 ↔ B 86–87 + 88–91 · grouped · offset 0 · s = 1 · Geometry calculation and resize
    - A 80 ↔ B 87 · same · offset 0 · s = 1 · Pixel-to-grid calculation
    - A 82–83 ↔ B 89–90 · same · offset 0 · s = 1 · Locked resize
      - A 83 ↔ B 90 · same · offset 0 · s = 1 · Dimension consistency
  - A 84–87 ↔ B 20–21 · relocated to session assembly · offset 0 · s = 0.475 · Derived configuration
    - A 85 + 86–87 ↔ B 21 · grouped, summarized · offset 0 · s = 0.9 · Replacement and propagation
- A 89–97 ↔ B 93–103 · same · offset 0 · s = 0.9375 · Exit and teardown
  - A 90 ↔ B 94–95 · summarized · offset 0 · s = 0.9 · Child exit
  - A 91 ↔ B 96–97 · summarized · offset 0 · s = 0.9 · Runtime close
  - A 92–97 ↔ B 98–103 · same · offset 0 · s = 0.825 · Surface deinitialization
    - A 93–94 ↔ B 99 + 100 · grouped · offset 0 · s = 0.95 · Worker shutdown
      - A 94 ↔ B 100 · same · offset 1 · s = 0.9 · Reader shutdown
    - A 95 + 96 + 97 ↔ B 101 + 102 · grouped · offset 0 · s = 1 · Resource release
    - unmatched: B 103 (App-wide resource teardown)

## 2. Score

Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner), additionally multiplied by 0.5 for relocation. Summarized comparisons use inner = 0.8. Each nested J is the sum of its pair scores divided by its paired-plus-unmatched count.

Top-level k = 8, uA = 0, uB = 0:

J = (0.938888889 + 0.858333333 + 1 + 0.969375 + 0.993515625 + 0.940694444 + 0.86875 + 0.9375) / 8
  = 7.507057291666667 / 8
  = **0.9383821614583334**.

For example, shared renderer state has inner J = 1/(1+1) = 0.5, hence s = 0.75. Relocated configuration has inner J = 0.9, hence s = (0.5 + 0.5×0.9)×0.5 = 0.475.

## 3. Verdict

The trees identify the same eight major components and closely agree on their internal code anchors: Surface/App, Termio/Exec, input encoders, StreamHandler, Terminal/ScreenSet/Screen/PageList, rendering, resize/configuration, and teardown. Differences are mostly detail and grouping. Implied parents include shared rendering resources, session resources, mouse/paste protocols, output processing plus interpretation, and drawing plus graphics backend. B places Screen beside ScreenSet rather than beneath it. Interaction state, App dispatch, Exec startup/readers, and derived configuration move between top-level branches; these are presentation-owner changes, not different implementations. The few unmatched details concern lock fairness, synchronized output, main-thread drawing, and App teardown.
