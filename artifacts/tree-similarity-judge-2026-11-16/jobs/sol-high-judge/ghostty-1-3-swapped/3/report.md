### Anchor tree
- A 3–12 ↔ B 3–11 · same · offset 0 · s=1 · runtime boundary and App
  - A 4–5 ↔ B 4–5 · s=1 · Surface events
  - A 6–8 ↔ B 6–7 · s=1 · apprt boundary
  - A 9–12 ↔ B 8–11 · s=1 · App coordination; A 11, 12 ↔ B 10 groups shared resources
- A 14–25 ↔ B 13–20 · same · offset 0 · s=0.835938 · session assembly
  - A 15–18 ↔ B 14, 15, 18 · grouped/summarized · s=0.9 · constructed resources and workers
  - A 19 ↔ B 5 · relocated, offset 1 · s=0.45 · retained state
  - A 20–21 ↔ B 84–87 · relocated · s=0.475 · derived configuration
  - A 22–25 ↔ B 16–17 · s=0.8625 · shared renderer state; A 23, 24 ↔ B 17 groups pointer and mutex; A 25 ↔ B 68–70 relocates demand locking
- A 27–38 ↔ B 22–34 · same · s=0.991667 · input
  - A 28–31 ↔ B 23–26 · s=1 · bindings and key encoding
  - A 32–34 ↔ B 27–30 · s=0.95 · mouse and paste
  - A 35–38 ↔ B 31–34 · s=1 · mailbox and PTY writes
- A 40–55 ↔ B 36–47 · same · s=0.888542 · output and VT handling
  - A 41–44 ↔ B 19–20 · relocated · s=0.5 · Exec session and reader
  - A 45–51 ↔ B 37–42 · s=0.99375 · Termio and StreamHandler; A 50, 51 ↔ B 44, 45 are nested differently
  - A 52–55 ↔ B 43–47 · s=0.8375 · UI effects; A 54–55 ↔ B 11 relocates App dispatch
- A 57–70 ↔ B 49–62 · same · s=0.999826 · terminal model
  - A 58–60 ↔ B 50–53 · s=1 · Terminal
  - A 61–70 ↔ B 54–62 · s=0.999306 · ScreenSet, Screen, pages and tracked pins
- A 72–83 ↔ B 64–76 · same · s=0.94375 · rendering
  - A 73–74 ↔ B 65–66 · s=1 · renderer thread
  - A 75–80 ↔ B 67–73 · s=0.9375 · snapshot and glyph preparation; unmatched B 70 (synchronized-output postponement)
  - A 81–83 ↔ B 74, 75 · grouped · s=0.725 · draw and graphics API; unmatched A 83 (resize drawing)
- A 85–91 ↔ B 78–87 · same · s=0.96375 · geometry
  - A 86–87 ↔ B 81–83 · s=0.905 · Surface sizing; A 87 ↔ B 79–80 matches grid metrics at offset 1
  - A 88–91 ↔ B 82–83 · s=0.95 · locked I/O resize and renderer notification
- A 93–103 ↔ B 89–97 · same · s=0.945833 · shutdown
  - A 94–95 ↔ B 90 · summarized · s=0.9 · child exit
  - A 96–97 ↔ B 91 · summarized · s=0.9 · close
  - A 98–103 ↔ B 92–97 · s=0.875 · destruction order; unmatched A 103 (App.deinit)

### Score
Eight top-level anchors, no unmatched top-level nodes: **J = (1 + 0.835938 + 0.991667 + 0.888542 + 0.999826 + 0.943750 + 0.963750 + 0.945833) / 8 = 0.946141**.

### Verdict
Both trees identify the same eight principal components and closely agree on their internal owners: Surface/apprt and App, session resources, input, Termio/VT output, the terminal screen model, rendering, resize, and teardown. Most differences are extra detail or grouping. B places owned configuration under geometry and Exec startup under assembly, while A places them under session assembly and output respectively; App mailbox dispatch likewise appears under output in A but App coordination in B. Those are relocations, not missing components.
