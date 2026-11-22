### Anchor tree
- A 3–17 ↔ B 3–14 · s = 0.937778 · CanvasWorkspace and sessions
  - A 4–6 ↔ B 4–5 · s = 0.95 · application entry
  - A 7–11 ↔ B 6–8 · s = 0.801667 · drafts and controllers; session replacement sits one level higher in B
  - A 12–17 ↔ B 9–12 · s = 0.875 · CanvasSession
  - Unmatched within these pairs: A 10–11 (persist notification), A 16–17 (session disposal detail).
- A 19–42 ↔ B 16–30 · s = 0.853438 · revision-backed canvas and history
  - A 20–23 ↔ B 40–44 · relocated, offset 1 · s = 0.45 · CanvasHistoryService
  - A 24–32 ↔ B 42 and 45–47 · grouped, relocated, offset 1 · s = 0.4275 · history record and canvas views
  - A 33–36 ↔ B 23–25 and 27–29 · grouped · s = 1 · composition and resolution
  - A 37–42 ↔ B 17–22 · s = 0.95 · diagram content and revisions
- A 44–63 ↔ B 32–51 · s = 0.916667 · MappingDocumentController
  - A 45–50 ↔ B 33–37 · s = 0.875 · versioned operations; A 47 is unmatched staging detail
  - A 51–52 ↔ B 38–39 · s = 1 · commits
  - A 53–54 ↔ B 48–49 · s = 1 · transfer-aware navigation
  - A 56–63 ↔ B 54–59 · relocated · s = 0.458333 · tldraw adapter; A 62–63 adds disposal detail
- A 65–83 ↔ B 53–69 · s = 0.9225 · selection and source inspection
  - A 66–70 ↔ B 61 · summarized, offset 1 · s = 0.81 · MappingCanvasState
  - A 71–74 and 75–77 ↔ B 62–65 · grouped · s = 0.975 · selection and source evidence
  - A 78–83 ↔ B 66–69 · s = 0.75 · display and source panes; A 80 and 82–83 add pane details
- A 85–106 ↔ B 71–87 · s = 0.936458 · agent-assisted edits
  - A 86–89 ↔ B 72–75 · s = 1 · prompt and pinned request
  - A 90–96 ↔ B 74–75 and 76–79 · grouped · s = 0.85 · generation run; B 78 adds cancellation
  - A 97–101 ↔ B 80–82 · s = 0.666667 · browser bridge; A 101 adds cleanup, B 82 identifies LiveCanvasService
  - A 102–106 ↔ B 83–85 · s = 0.975 · revision receiver
- A 108–129 ↔ B 89–104 · s = 0.847667 · persistence and publication
  - A 109–113 ↔ B 90–92 · s = 0.833333 · WorkspacePersistence
  - A 114–118 ↔ B 93 · summarized, offset 1 · s = 0.81 · storage transport
  - A 119–123 ↔ B 94–97 · s = 1 · validated record batch
  - A 124–129 ↔ B 98–100 · s = 0.833333 · explicit publication
  - Unmatched: B 101 (reload reconstruction); A 112–113 (removed-document cleanup) and 127–129 (acknowledged baseline detail).

### Score
Six top-level anchors, no unmatched top-level nodes: **J = (0.937778 + 0.853438 + 0.916667 + 0.9225 + 0.936458 + 0.847667) / 6 = 0.902418**.

### Verdict
Both trees identify the workspace/session, revisioned canvas, controller, inspection, agent-edit and persistence boundaries. Their main difference is ownership in the breakdown: B puts history under the controller and the tldraw adapter under canvas presentation, while A gives both places beneath its other anchors. B leaves CanvasHistoryService and CanvasViews as implied parts of its revision-backed model; A spells out more checkpoint, pane and save-acknowledgement detail. The agent and source-selection differences are chiefly grouping and detail rather than different components.
