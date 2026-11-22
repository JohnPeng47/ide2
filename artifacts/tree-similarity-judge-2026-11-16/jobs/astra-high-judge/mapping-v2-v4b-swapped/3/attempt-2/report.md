## 1. Anchor tree

Reference-only file lines and repeated call-flow descriptions are not separate components. Offsets are local to the matched grouping. A facet folded into a parent line is treated as a semantic leaf; its range still includes that node's complete subtree. Extracted and relocated facets are counted only at their listed match, not again as unmatched children.

- A 3–14 ↔ B 3–14 + 16–28 · grouped · offset 0 · s = 0.852875 · application/workspace/session lifetime
  - A 4–5 ↔ B 5–6 · summarized · offset 0 · s = 0.9 · entry
  - A 6–8 ↔ B 9–14 · same · offset 0 · s = 0.975 · drafts/controllers
    - A 7 ↔ B 12 · same · offset 0 · s = 1 · metadata
    - A 8 ↔ B 9–14 · folded · offset 1 · s = 0.9 · controller map
  - A 13–14 ↔ B 11 + 14 · grouped · offset 1 · s = 0.9 · session lifecycle
  - A 9–12 ↔ B 16–28 · same · offset 1 · s = 0.75375 · CanvasSession
    - A 10 ↔ B 19 + 20–24 · grouped, summarized · offset 0 · s = 0.9 · stores
    - A 11 ↔ B 25–26 · summarized · offset 0 · s = 0.9 · notifications
    - A 12 ↔ B 27–28 · summarized · offset 0 · s = 0.9 · dirty state
    - unmatched: B 18 (CanvasCursorCopy ownership)
  - unmatched: B 7–8 (service construction/context)
- A 16–30 ↔ B 30–55 · same · offset 0 · s = 0.862802083 · document model
  - A 17–22 ↔ B 39–46 · same · offset 0 · s = 0.8518125 · Diagram
    - A 18–19 ↔ B 41–42 · same · offset 0 · s = 1 · DiagramContent
      - A 19 ↔ B 42 · same · offset 0 · s = 1 · content construction
    - A 20–21 ↔ B 87 + 90–91 · grouped, relocated to history · offset 1 · s = 0.40725 · retained revisions
      - A 21 ↔ B 90–91 · summarized · offset 1 · s = 0.81 · creation/revision wrappers
  - A 23–26 ↔ B 31–37 · same · offset 0 · s = 0.875 · composition
    - A 24 ↔ B 32–34 · summarized · offset 0 · s = 0.9 · grid scene
    - A 25 ↔ B 35 + 36–37 · grouped, summarized · offset 0 · s = 0.9 · connections/review/context
    - A 26 ↔ B 85 · relocated to history · offset 1 · s = 0.45 · pinned bindings
  - A 27–29 ↔ B 89 · summarized, relocated to history · offset 0 · s = 0.45 · resolved document
- A 32–51 ↔ B 57–75 + 77–95 · grouped · offset 0 · s = 0.946388889 · semantic controller/history
  - A 33–37 ↔ B 61–72 · same · offset 0 · s = 0.966666667 · versioned operations
    - A 34 ↔ B 62 + 63 · grouped · offset 0 · s = 1 · settle/version check
    - A 35 + 36 ↔ B 64–67 · grouped, summarized · offset 0 · s = 0.9 · operation families
    - A 37 ↔ B 68–72 · summarized · offset 0 · s = 0.9 · reconciliation/publication
  - A 38–39 ↔ B 73 · summarized · offset 0 · s = 0.9 · recorded/transient updates
  - A 40–44 ↔ B 77–95 · same · offset 1 · s = 0.87 · history service
    - A 41 ↔ B 79–80 · summarized · offset 0 · s = 0.9 · contexts
    - A 42 ↔ B 81–88 · summarized · offset 0 · s = 0.9 · archive records
    - A 43 ↔ B 92 · same · offset 0 · s = 1 · append/navigation
  - A 44 ↔ B 74–75 · summarized · offset 1 · s = 0.81 · persistence deltas
  - A 45–47 ↔ B 88 · summarized · offset 1 · s = 0.81 · named views
  - A 48–49 ↔ B 93–95 · same · offset 0 · s = 1 · transfers
    - A 49 ↔ B 94–95 · same · offset 0 · s = 1 · coordinated undo
- A 53–69 ↔ B 97–109 · same · offset 0 · s = 0.69828125 · presentation/source inspection
  - A 54–59 ↔ B 97–109 · same · offset 1 · s = 0.783 · editor adapter
    - A 55 ↔ B 100–101 · summarized · offset 0 · s = 0.9 · native shapes
    - A 56–57 ↔ B 102–103 · same · offset 0 · s = 1 · native geometry/undo
      - A 57 ↔ B 103 · same · offset 0 · s = 1 · frame isolation
    - A 58 ↔ B 104–105 · summarized · offset 0 · s = 0.9 · gesture settlement
    - A 59 ↔ B 106–108 · summarized · offset 0 · s = 0.9 · checkpoint restoration
    - unmatched: B 109 (disposal)
  - A 60–61 ↔ B 48–55 · relocated to model · offset 0 · s = 0.375 · canvas state
    - A 61 ↔ B 49 + 50 · grouped · offset 0 · s = 1 · selection/controls/display
    - unmatched: B 51–55 (projection/folding)
  - A 62–65 ↔ B 43–44 + 45–46 · grouped, relocated to model · offset 1 · s = 0.42825 · source evidence
    - A 63 ↔ B 44 · same · offset 0 · s = 1 · evidence join
    - A 64 ↔ B 45–46 · summarized · offset 1 · s = 0.81 · source API
    - A 65 ↔ B 43–44 · folded · offset 1 · s = 0.9 · binding
  - unmatched: A 66–67 (source/code panels and repository navigation)
- A 71–87 ↔ B 111–128 · same · offset 0 · s = 0.913916667 · agent editing
  - A 72–75 + 76–79 ↔ B 112–116 + 117–120 · grouped · offset 0 · s = 0.781 · prompt/edit runs
    - A 73 ↔ B 114 · same · offset 0 · s = 1 · pinned requests
    - A 74 ↔ B 119 · same · offset 0 · s = 1 · generation
    - A 76–79 ↔ B 118 · summarized · offset 1 · s = 0.81 · run ownership/deduplication
    - unmatched: B 113 (composer state), B 115–116 (composer polling/lifetime)
  - A 80–82 ↔ B 120 + 121–123 · grouped · offset 0 · s = 0.7025 · command transport
    - A 81 ↔ B 121–123 · summarized · offset 1 · s = 0.81 · browser bridge
    - unmatched: A 82 (LiveCanvasService)
  - A 83–85 ↔ B 124–128 · same · offset 0 · s = 1 · revision receiver
    - A 75 + 84 ↔ B 126 · grouped · offset 0 · s = 1 · checked installation
    - A 85 ↔ B 127 + 128 · grouped · offset 0 · s = 1 · receipts/acknowledgement
- A 89–104 ↔ B 130–149 · same · offset 0 · s = 0.854375 · persistence
  - A 90–93 ↔ B 134–138 · same · offset 0 · s = 0.951666667 · client persistence
    - A 91 ↔ B 136 · same · offset 0 · s = 1 · cursors
    - A 92 ↔ B 137–138 · summarized · offset 0 · s = 0.9 · persisted records
    - A 93 ↔ B 139–144 · summarized · offset 1 · s = 0.81 · storage/worker
  - A 94–97 ↔ B 145–149 · same · offset 0 · s = 0.983333333 · server records
    - A 95 ↔ B 147 · same · offset 0 · s = 1 · validation
    - A 96 ↔ B 146 · same · offset 0 · s = 1 · concurrency/receipts
    - A 97 ↔ B 148–149 · summarized · offset 0 · s = 0.9 · atomic publication
  - A 101 ↔ B 131–133 · summarized · offset 0 · s = 0.9 · reconstruction
  - unmatched: A 98–100 (project checkpoint publication)

## 2. Score

Each inner level uses Σs/(k + uA + uB); each pair applies the requested depth, detail and relocation factors. There are six top-level anchors and no unmatched top-level components after grouping.

Top-level s values: workspace 0.852875; model 0.862802083; controller/history 0.946388889; presentation 0.69828125; agents 0.913916667; persistence 0.854375.

J = (0.852875 + 0.862802083 + 0.946388889 + 0.69828125 + 0.913916667 + 0.854375) / (6 + 0 + 0) = 5.128638889 / 6 = 0.854773148.

## 3. Verdict

The trees share nearly all major components, especially the semantic controller, agent installation and persistence pipeline. B separates CanvasSession and CanvasHistoryService into top-level components; their implied parents are workspace lifetime and semantic editing. Most other differences are detail or grouping. The larger structural differences are B placing revision resolution under history and source/presentation state under the model, while A groups source inspection with the canvas. A separately identifies source panels, live copy/paste and project publication; B adds composer lifecycle and presentation folding.
