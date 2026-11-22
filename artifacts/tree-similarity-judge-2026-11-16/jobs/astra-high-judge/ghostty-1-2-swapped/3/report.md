## 1. Anchor tree

Ranges include whole subtrees. Parent ranges can therefore contain a separately identified folded or relocated detail; such containment is not another unmatched node. Offsets are local to the comparison, so an inherited grouping offset is not charged again.

- A 3–14 ↔ B 3–11 · same · offset 0 · s = 0.952778 · Surface integration
  - A 4–5 ↔ B 4–5 · same · offset 0 · s = 1 · Surface event API
    - A 5 ↔ B 5 · same · offset 0 · s = 1 · Native event boundary
  - A 6–8 ↔ B 6–7 · same · offset 0 · s = 0.75 · apprt
    - A 8 ↔ B 7 · same · offset 0 · s = 1 · UI delegation
    - unmatched: A 7 (explicit runtime alternatives)
  - A 9–14 ↔ B 8–11 · same · offset 0 · s = 0.966667 · App
    - A 10 ↔ B 9 · same · offset 0 · s = 1 · Registry and focus
    - A 11–12 ↔ B 10 · summarized · offset 0 · s = 0.9 · Shared resources
    - A 13–14 ↔ B 11 · summarized · offset 0 · s = 0.9 · Message dispatch
- A 16–25 ↔ B 13–20 · same · offset 0 · s = 0.83645 · Session assembly
  - A 17 ↔ B 14 + 18 · grouped · offset 0 · s = 1 · Termio and worker
  - A 18 ↔ B 15 · same · offset 0 · s = 1 · Renderer and worker
  - A 19–21 ↔ B 16–17 · same · offset 0 · s = 1 · Shared State
    - A 20 + 21 ↔ B 17 · grouped · offset 0 · s = 1 · Referenced state and mutex
  - A 24–25 ↔ B 87 · relocated, summarized · offset 2 · s = 0.3645 · Owned derived configuration; B puts this under configuration propagation
  - unmatched: A 22–23 (explicit retained interaction-state inventory, beyond the event-boundary description)
- A 27–40 ↔ B 22–34 · same · offset 0 · s = 0.997917 · Input
  - A 28–32 ↔ B 23–26 · same · offset 0 · s = 0.9875 · Keyboard handling
    - A 29 ↔ B 24 · same · offset 0 · s = 1 · Binding actions
    - A 30–32 ↔ B 25–26 · same · offset 0 · s = 0.95 · Key encoding
      - A 31–32 ↔ B 26 · summarized · offset 0 · s = 0.9 · Protocol options
  - A 33–36 ↔ B 27–28 + 29–30 · grouped · offset 0 · s = 1 · Mouse/selection/paste
    - A 34 + 35 ↔ B 28 · grouped · offset 0 · s = 1 · Reporting and selection
    - A 36 ↔ B 30 · same · offset 0 · s = 1 · Paste
  - A 37–40 ↔ B 31–34 · same · offset 0 · s = 1 · Writes
    - A 38 ↔ B 32 · same · offset 0 · s = 1 · Readonly filtering
    - A 39–40 ↔ B 33–34 · same · offset 0 · s = 1 · Mailbox/backend dispatch
      - A 40 ↔ B 34 · same · offset 0 · s = 1 · PTY writes
- A 42–58 ↔ B 36–47 · same · offset 0 · s = 0.886806 · Output interpretation
  - A 43–49 ↔ B 19–20 · relocated · offset 0 · s = 0.3625 · Exec ownership; B puts it under session assembly
    - A 45–49 ↔ B 20 · summarized · offset 0 · s = 0.9 · Startup and reader lifetime
    - unmatched: A 44 (execution settings)
  - A 50–54 ↔ B 37–39 + 40–42 · grouped · offset 0 · s = 0.975 · Locked processing and interpretation
    - A 51–54 ↔ B 38 + 39 + 41–42 · grouped · offset 0 · s = 0.95 · Processing and VT dispatch
      - A 52 + 53–54 ↔ B 42 · grouped, summarized · offset 0 · s = 0.9 · Persistent stream/handler
  - A 55–58 ↔ B 43–47 · same · offset 0 · s = 0.983333 · External effects
    - A 56 ↔ B 44 · same · offset 0 · s = 1 · Replies
    - A 57 ↔ B 46–47 · summarized · offset 0 · s = 0.9 · Surface effects
    - A 58 ↔ B 45 · same · offset 0 · s = 1 · Renderer notifications
- A 60–73 ↔ B 49–62 · same · offset 0 · s = 0.93724 · Terminal model
  - A 61–62 + 72–73 ↔ B 50–53 · grouped · offset 0 · s = 0.75 · Terminal operations/state
    - A 73 ↔ B 51 + 52 + 53 · grouped · offset 0 · s = 1 · Output-controlled state
    - unmatched: A 62 (explicit native-window/GPU ownership exclusion)
  - A 63–71 ↔ B 54–62 · same · offset 0 · s = 0.998958 · ScreenSet
    - A 64 ↔ B 55 · same · offset 0 · s = 1 · Primary/alternate screens
    - A 65–71 ↔ B 56–62 · same · offset 0 · s = 0.995833 · Active Screen
      - A 66 ↔ B 57 · same · offset 0 · s = 1 · Editing state
      - A 67 ↔ B 58 · same · offset 0 · s = 1 · Extended protocols
      - A 68–71 ↔ B 59–62 · same · offset 0 · s = 0.975 · PageList
        - A 69 + 70 ↔ B 60 · grouped · offset 0 · s = 1 · Page storage
        - A 71 ↔ B 61–62 · summarized · offset 0 · s = 0.9 · Pins
- A 75–88 ↔ B 64–76 · same · offset 0 · s = 0.961042 · Rendering
  - A 76 ↔ B 65–66 · summarized · offset 0 · s = 0.9 · Scheduling
  - A 77–78 ↔ B 75–76 · same · offset 0 · s = 0.905 · Graphics backend
    - A 78 ↔ B 75–76 · folded, summarized · offset 1 · s = 0.81 · Metal/OpenGL selection
  - A 79–83 + 84–85 ↔ B 67–73 · grouped · offset 0 · s = 0.983333 · Snapshot and text construction
    - A 80 + 83 ↔ B 68–70 · grouped, summarized · offset 0 · s = 0.9 · Snapshot and synchronized output
    - A 81–82 ↔ B 71–72 · same · offset 0 · s = 1 · Presentation inputs
      - A 82 ↔ B 72 · same · offset 0 · s = 1 · Frame data
    - A 85 ↔ B 73 · same · offset 0 · s = 1 · Generic text construction
  - A 86–88 ↔ B 74 · summarized · offset 0 · s = 0.9 · drawFrame
- A 90–99 ↔ B 78–87 · same · offset 0 · s = 0.9725 · Geometry/configuration
  - A 91–97 ↔ B 81–83 · same · offset 0 · s = 0.94 · Resize
    - A 92 ↔ B 79–80 · summarized · offset 1 · s = 0.81 · Geometry calculation
    - A 93–97 ↔ B 82–83 · same · offset 0 · s = 0.95 · Coordinated resizing
      - A 94–97 ↔ B 83 · summarized · offset 0 · s = 0.9 · Resize consistency
  - A 98–99 ↔ B 84–87 · same · offset 0 · s = 0.95 · Configuration propagation
    - A 99 ↔ B 85 + 86–87 · grouped, summarized · offset 0 · s = 0.9 · Component settings
- A 101–109 ↔ B 89–97 · same · offset 0 · s = 0.800833 · Teardown
  - A 102 ↔ B 91 · same · offset 0 · s = 1 · Runtime close
  - A 103–104 ↔ B 93–94 · same · offset 1 · s = 0.9 · Stop workers
    - A 104 ↔ B 94 · same · offset 0 · s = 1 · Exec.threadExit
  - A 105–106 ↔ B 95 + 96 · grouped, summarized · offset 1 · s = 0.81 · Resource destruction
  - A 107 ↔ B 97 · same · offset 1 · s = 0.9 · Remaining resources
  - unmatched: A 108–109 (App-wide teardown), B 90 (child-exit handling)

## 2. Score

Each level uses J = sum(s)/(k + uA + uB). Each pair uses s = 0.9^offset × (0.5 + 0.5 × inner), additionally halved for relocation. For example, owned configuration scores 0.9² × 0.9 × 0.5 = 0.3645; teardown's inner J is (1 + 0.9 + 0.81 + 0.9)/6 = 0.601667.

All eight top-level components match, with no unmatched top-level components. Their scores are: integration 0.952777778; assembly 0.83645; input 0.997916667; output 0.886805556; model 0.937239583; rendering 0.961041667; geometry/configuration 0.9725; teardown 0.800833333.

J = (0.952777778 + 0.83645 + 0.997916667 + 0.886805556 + 0.937239583 + 0.961041667 + 0.9725 + 0.800833333)/8 = 7.345564583/8 = 0.918195573.

## 3. Verdict

The trees are very similar: they identify the same eight major components and largely the same internal modules. Most differences are detail or grouping, not different code ownership. B moves Exec startup into assembly and configuration ownership into configuration propagation. A's combined mouse/selection/paste parent is implied in B; B's updateFrame parent combines A's snapshot and shaping branches. B also makes Surface.deinit an explicit intermediate parent. The largest unmatched lifecycle details are A's App-wide teardown and B's child-exit handling. This comparison scores representation, not repository correctness.
