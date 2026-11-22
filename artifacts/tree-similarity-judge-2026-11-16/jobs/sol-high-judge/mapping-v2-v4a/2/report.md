### Anchor tree
- A 3–14, 16–28 ↔ B 3–17 · grouped · offset 0 · s = 0.935 · application, workspace and session
  - A 5–8 ↔ B 4–6 · summarized · offset 0 · s = 0.9 · entry and services
  - A 9–14 ↔ B 7–11 · summarized · offset 0 · s = 0.9 · CanvasWorkspace
  - A 16–28 ↔ B 12–17 · summarized · offset 1 · s = 0.81 · CanvasSession
- A 30–55 ↔ B 65–83 · same · offset 0 · s = 0.7305 · semantic document and canvas view
  - A 31–37 ↔ B 33–36 · relocated to B history · s = 0.475 · MappingGridDocument; scene composition agrees
  - A 39–46 ↔ B 37–42 · relocated to B history · s = 0.4188 · Diagram; its source lookup matches B 75–77
  - A 48–55 ↔ B 66–70, 78–83 · grouped in B · s = 0.95 · canvas, display and view state
  - unmatched: B 71–74 (captured region-selection details)
- A 57–75, 97–109 ↔ B 44–63 · grouped in A · offset 0 · s = 0.9316 · controller and editor
  - A 57–75 ↔ B 45–55 · offset 1 · s = 0.8625 · controller: operations, snapshots and commands
  - A 97–109 ↔ B 56–63 · offset 1 · s = 0.864 · native editor bridge: projection, gestures and undo
- A 77–95 ↔ B 19–42 · same · offset 0 · s = 0.925 · history archive
  - A 79–80, 92 ↔ B 20–23 · grouped · s = 0.95 · contexts and navigation
  - A 81–89 ↔ B 24–32 · s = 0.975 · history record and snapshots
  - A 90–91 ↔ B 41–42 · s = 1 · diagram revision store
  - A 93–95 ↔ B 53–54 · relocated to B controller · s = 0.475 · transfer-aware navigation
- A 111–128 ↔ B 85–106 · same · offset 0 · s = 0.9823 · agent-assisted editing
  - A 112–116 ↔ B 86–89 · s = 0.975 · prompt coordinator
  - A 117–120 ↔ B 90–96 · s = 0.95 · edit service
  - A 121–123 ↔ B 97–101 · s = 0.95 · canvas command bridge
  - A 124–128 ↔ B 102–106 · s = 0.9833 · revision receiver
- A 130–149 ↔ B 108–129 · same · offset 0 · s = 0.795 · workspace persistence
  - A 134–138 ↔ B 109–113 · s = 0.9833 · persistence adapter
  - A 139–144 ↔ B 114–118 · s = 0.9833 · storage transport
  - A 145–149 ↔ B 119–123 · s = 0.9833 · record store
  - unmatched: A 131–133 (startup restoration); B 124–129 (explicit publication)

### Score
Top-level J = (0.935 + 0.73046875 + 0.931625 + 0.925 + 0.9822917 + 0.795) / 6 = **0.8832**.

### Verdict
The trees identify the same workspace/session, document, controller/editor, history, agent and persistence components. B places the diagram model beneath history and the editor beneath the controller; A makes the editor a separate top-level component and leaves the controller/editor grouping implied. B adds selection and explicit-publication detail, while A separately identifies startup restoration. These are mainly differences in grouping, depth and detail rather than different component identities.
