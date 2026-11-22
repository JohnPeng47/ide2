## 1. Anchor tree

The common Surface root is context; its eight component branches form the scored top level. Pure call-flow descriptions, repeated parent responsibilities and file-only annotations are not additional components. Recursion stops at component leaves. Offsets below an offset anchor measure additional displacement, avoiding charging the same inherited depth difference twice. Relocated counterparts are counted only at their A location.

- A 3–11 ↔ B 3–12 · same · offset 0 · s = 0.937639 · Runtime boundary and application coordination
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 0.725 · Surface event interface
    - A 5 ↔ B 5 + 19 · grouped, relocated · offset 1 · s = 0.45 · Interactive-session ownership and retained input state. B places the retained-state portion under session assembly; the relocation factor conservatively applies to the grouped match.
  - A 6–7 ↔ B 6–8 · same · offset 0 · s = 1 · apprt host integration
    - A 7 ↔ B 7 + 8 · grouped · offset 0 · s = 1 · Native layout/UI responsibility
  - A 8–11 ↔ B 9–12 · same · offset 0 · s = 0.900833 · App
    - A 9 ↔ B 10 · same · offset 0 · s = 1 · Registry, focus and mailbox
    - A 10 ↔ B 11 + 12 · grouped · offset 0 · s = 1 · Shared rendering resources
    - A 11 ↔ B 54–55 · summarized, relocated to output handling · offset 1 · s = 0.405 · Validated dispatch
- A 13–20 ↔ B 14–25 · same · offset 0 · s = 0.858333 · Session assembly
  - A 14 + 15 + 18 ↔ B 15–18 · grouped, summarized · offset 0 · s = 0.9 · I/O, renderer and worker resources
  - A 16–17 ↔ B 22–25 · same · offset 0 · s = 0.75 · Shared renderer.State
    - A 17 ↔ B 23 + 24 · grouped · offset 0 · s = 1 · Aliasing and mutex protection
    - unmatched: B 25 (State-level starvation-control machinery; the renderer's use of lockDemand is matched separately)
  - A 19–20 ↔ B 41–44 · relocated to child-output handling · offset 0 · s = 0.5 · Exec physical session
    - A 20 ↔ B 43 + 44 · grouped · offset 0 · s = 1 · Backend reader implementation
- A 22–34 ↔ B 27–38 · same · offset 0 · s = 1 · User input and writes
  - A 23–26 ↔ B 28–31 · same · offset 0 · s = 1 · Keyboard handling
    - A 24 ↔ B 29 · same · offset 0 · s = 1 · Binding actions
    - A 25–26 ↔ B 30–31 · same · offset 0 · s = 1 · Key encoding
      - A 26 ↔ B 31 · same · offset 0 · s = 1 · Keyboard protocol state
  - A 27–28 + 29–30 ↔ B 32–34 · grouped · offset 0 · s = 1 · Mouse and paste protocols
    - A 28 ↔ B 33 · same · offset 0 · s = 1 · Mouse encoding
    - A 30 ↔ B 34 · same · offset 0 · s = 1 · Paste encoding
  - A 31–34 ↔ B 35–38 · same · offset 0 · s = 1 · I/O messages and writes
    - A 32 ↔ B 36 · same · offset 0 · s = 1 · Readonly filtering
    - A 33–34 ↔ B 37–38 · same · offset 0 · s = 1 · Backend write dispatch
      - A 34 ↔ B 38 · same · offset 0 · s = 1 · Exec PTY writes
- A 36–47 ↔ B 40–55 · same · offset 0 · s = 0.9375 · Child output and VT interpretation
  - A 37–39 + 40–42 ↔ B 45–51 · grouped · offset 0 · s = 0.95 · Locked processing and terminal stream
    - A 39 ↔ B 51 · same · offset 1 · s = 0.9 · Output-triggered rendering
    - A 41–42 ↔ B 47–48 + 49 · grouped · offset 1 · s = 0.9 · Stateful StreamHandler operations
  - A 43–47 ↔ B 52–55 · same · offset 0 · s = 0.8 · External effects
    - A 44 ↔ B 50 · same, regrouped within output handling · offset 1 · s = 0.9 · Protocol replies
    - A 46–47 ↔ B 53 · summarized · offset 0 · s = 0.9 · Surface-effect mailbox
    - unmatched: A 45 (separate renderer-effect mailbox)
- A 49–62 ↔ B 57–70 · same · offset 0 · s = 0.989922 · Terminal emulation and storage
  - A 50–53 ↔ B 58–60 · same · offset 0 · s = 1 · Terminal
    - A 51 ↔ B 59 · same · offset 0 · s = 1 · Geometry and editing rules
    - A 52 + 53 ↔ B 60 · grouped · offset 0 · s = 1 · Protocol state and metadata
  - A 54–62 ↔ B 61–63 + 64–70 · grouped · offset 0 · s = 0.959688 · ScreenSet and Screens
    - A 55 ↔ B 62 + 63 · grouped · offset 0 · s = 1 · Screen selection
    - A 57 ↔ B 65 · same · offset 1 · s = 0.9 · Editing state
    - A 58 ↔ B 66 · same · offset 1 · s = 0.9 · Extended protocols
    - A 59–62 ↔ B 67–70 · same · offset 1 · s = 0.8775 · PageList
      - A 60 ↔ B 69 · same · offset 0 · s = 1 · Page rows and cells
      - A 61–62 ↔ B 70 · summarized · offset 0 · s = 0.9 · Tracked pins
- A 64–76 ↔ B 72–83 · same · offset 0 · s = 0.940694 · Rendering
  - A 65–66 ↔ B 73–74 · same · offset 0 · s = 1 · Renderer thread
  - A 67–73 ↔ B 75–80 · same · offset 0 · s = 0.941667 · Frame preparation
    - A 68–70 ↔ B 76 + 77–78 · grouped · offset 0 · s = 0.75 · RenderState snapshot
      - A 69 ↔ B 78 · same · offset 0 · s = 1 · Brief shared-state snapshot
      - unmatched: A 70 (synchronized-output suppression)
    - A 71–72 ↔ B 80 · summarized · offset 0 · s = 0.9 · Frame contents and cells
    - A 73 ↔ B 79 · same · offset 0 · s = 1 · Font shaping and glyph resources
  - A 74 + 75–76 ↔ B 81–83 · grouped · offset 0 · s = 0.7025 · Presentation and graphics backend
    - A 75–76 ↔ B 82 · summarized · offset 1 · s = 0.81 · Metal/OpenGL selection
    - unmatched: B 83 (explicit main-thread resize drawing path)
- A 78–87 ↔ B 85–91 · same · offset 0 · s = 0.880833 · Geometry and configuration
  - A 79–80 ↔ B 87 · summarized · offset 1 · s = 0.81 · Font metrics and grid geometry
  - A 81–83 ↔ B 86–87 + 88–91 · grouped · offset 0 · s = 1 · Surface/Termio resizing
    - A 82–83 ↔ B 89–90 · same · offset 0 · s = 1 · Locked resize
      - A 83 ↔ B 90 · same · offset 0 · s = 1 · Dimension consistency
  - A 84–87 ↔ B 20–21 · relocated to session assembly · offset 0 · s = 0.475 · Owned configuration
    - A 85 + 86–87 ↔ B 21 · grouped, summarized · offset 0 · s = 0.9 · Configuration updates
- A 89–97 ↔ B 93–103 · same · offset 0 · s = 0.94375 · Exit and teardown
  - A 90 ↔ B 94–95 · summarized · offset 0 · s = 0.9 · Child exit
  - A 91 ↔ B 96–97 · summarized · offset 0 · s = 0.9 · Runtime close
  - A 92–97 ↔ B 98–103 · same · offset 0 · s = 0.8625 · Surface deinitialization
    - A 93–94 ↔ B 99 + 100 · grouped, summarized · offset 0 · s = 0.9 · Worker/reader shutdown
    - A 95 + 96 ↔ B 101 · grouped · offset 0 · s = 1 · Renderer and terminal release
    - A 97 ↔ B 102 · same · offset 0 · s = 1 · Font/configuration release
    - unmatched: B 103 (application-wide teardown)

## 2. Score

Each nested level uses J = Σs/(k + uA + uB). For example, shared renderer.State has J = 1/(1 + 0 + 1) = 0.5, giving s = 0.75. Relocated App dispatch gives s = 0.9 × (0.5 + 0.5 × 0.8) × 0.5 = 0.405.

Top-level anchor scores:

| Anchor | s |
|---|---:|
| Runtime/App | 0.937638889 |
| Session assembly | 0.858333333 |
| Input | 1 |
| Output/VT | 0.9375 |
| Terminal/storage | 0.989921875 |
| Rendering | 0.940694444 |
| Geometry/configuration | 0.880833333 |
| Exit/teardown | 0.94375 |

There are eight matched top-level components and no unmatched top-level components:

J = (0.937638889 + 0.858333333 + 1 + 0.9375 + 0.989921875 + 0.940694444 + 0.880833333 + 0.94375)/(8 + 0 + 0) = 7.488671875/8 = **0.936083984375**.

## 3. Verdict

The trees identify essentially the same Surface-centered architecture: runtime/App integration, session workers, input, VT output processing, terminal storage, rendering, resizing/configuration and teardown. Differences are predominantly grouping and detail. B makes resource construction and mouse/paste explicit grouping parents; A leaves those parents implied. A nests Screen beneath ScreenSet, while B presents them as siblings, leaving that ownership parent implied. B places Exec under output handling, configuration under assembly and App dispatch under output effects rather than their A locations. These are representational-owner changes, not evidence of different code components. A few additional mechanism-level nodes account for the remaining difference; no correctness or completeness judgment is included.
