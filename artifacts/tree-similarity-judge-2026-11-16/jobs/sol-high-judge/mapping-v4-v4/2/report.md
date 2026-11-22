## Anchor tree
- A 3–17 ↔ B 3–14 · same · offset 0 · s = 1 · Canvas workspace and sessions
  - A 4–6 ↔ B 4–5 · same · offset 0 · s = 1 · application entry
  - A 7–11 ↔ B 6–8 · same · offset 0 · s = 1 · drafts and controllers
  - A 12–17 ↔ B 9–13 · same · offset 0 · s = 1 · CanvasSession
- A 19–42 ↔ B 16–30 · same · offset 0 · s = 0.916667 · revision-backed canvas model and history
  - A 20–32 ↔ B 40–47 · relocated under B’s controller · offset 0 · s = 0.5 · history
    - A 21–23 ↔ B 41, 43–44 · grouped · offset 0 · s = 1 · history service and navigation
    - A 24–31 ↔ B 42, 45–47 · grouped · offset 0 · s = 1 · checkpoint record and views
  - A 33–36 ↔ B 23–26, 27–29 · grouped · offset 0 · s = 1 · composition and resolution
  - A 37–42 ↔ B 17–22 · same · offset 0 · s = 1 · diagram revisions
- A 44–63 ↔ B 32–51 · same · offset 0 · s = 0.927083 · MappingDocumentController
  - A 45–50 ↔ B 33–37 · same · offset 0 · s = 1 · versioned updates
  - A 51–52 ↔ B 38–39 · same · offset 0 · s = 1 · commits
  - A 53–54 ↔ B 48–49 · same · offset 0 · s = 1 · transfer coordination
  - A 56–63 ↔ B 54–59 · relocated under B’s presentation anchor · offset 0 · s = 0.416667 · tldraw adapter
    - A 57–58 ↔ B 55–57 · same · offset 0 · s = 1 · editor and shape projection
    - A 59–61 ↔ B 58–59 · same · offset 0 · s = 1 · gestures and checkpoints
    - unmatched: A 62–63 (runtime disposal detail)
- A 65–83 ↔ B 53–69 · same · offset 0 · s = 0.8625 · selection and source inspection
  - A 66–70 ↔ B 60–61 · same · offset 1 · s = 0.9 · canvas interaction state
  - A 75–77 ↔ B 62–65 · same · offset 0 · s = 1 · source mappings
  - A 78–83 ↔ B 66–67 · same · offset 0 · s = 1 · source panes
  - unmatched: A 71–74 (revision-pinned region selection)
- A 85–106 ↔ B 71–87 · same · offset 0 · s = 0.9 · agent edits
  - A 86–89 ↔ B 72–73 · same · offset 0 · s = 1 · prompt composer
  - A 90–96 ↔ B 74–79 · same · offset 0 · s = 1 · generation service
  - A 97–101 ↔ B 80–81 · same · offset 0 · s = 1 · canvas bridge
  - A 102–106 ↔ B 83–85 · same · offset 0 · s = 1 · revision receiver
  - unmatched: B 82 (LiveCanvasService)
- A 108–129 ↔ B 89–104 · same · offset 0 · s = 0.97625 · persistence and publication
  - A 109–113 ↔ B 90–92, 101 · grouped · offset 0 · s = 1 · persistence lifecycle
  - A 114–118 ↔ B 93 · summarized in B · offset 1 · s = 0.81 · storage transport
  - A 119–123 ↔ B 94–97 · same · offset 0 · s = 1 · record store
  - A 124–129 ↔ B 98–100 · same · offset 0 · s = 1 · publication

## Score
Top-level J = (1 + 0.916667 + 0.927083 + 0.8625 + 0.9 + 0.97625) / 6 = **0.930417**. The six terms are the top-level anchors in the order above; neither tree has an unmatched top-level component.

## Verdict
The trees identify the same six major areas: workspace sessions, revision-backed canvas state, controller commands, inspection, agent edits, and persistence/publication. Their main structural difference is ownership: A places history with the canvas model and the tldraw adapter with the controller, while B places them under the controller and presentation respectively. B groups composition with resolved revisions and makes the service pipeline explicit; A gives storage transport and pinned region selection more detail. B additionally identifies LiveCanvasService. The implied parents are the shared revision-backed model for B’s separately placed history and the shared controller/editor boundary for B’s separately placed tldraw adapter.
