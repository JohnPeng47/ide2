### Anchor tree
- A 3–14 ↔ B 3–14, 16–28 · grouped · offset 0 · s = 0.822500 · application and session lifetime
  - A 4–5 ↔ B 4–6 · s = 0.750000 · entry; unmatched B 6 (evals consumer)
  - A 6–8, 13–14 ↔ B 9–14 · grouped · s = 0.975000 · draft registry and lifecycle
    - A 7 ↔ B 12 · s = 1 · metadata; A 13–14 ↔ B 11, 14 · grouped, summarized · s = 0.9 · session lifecycle
  - A 9–12 ↔ B 16–28 · offset 1 · s = 0.855000 · CanvasSession
    - A 10 ↔ B 20–24; A 11 ↔ B 25–26; A 12 ↔ B 27–28 · summarized · s = 0.9 each
  - Unmatched B 7–8 (services context).
- A 16–30 ↔ B 30–55 · s = 0.865972 · semantic canvas model
  - A 17–22 ↔ B 39–46 · s = 0.862500 · diagram content and revisions
    - A 18–19 ↔ B 41–42 · s = 1 · content; A 20–21 ↔ B 87 · relocated, summarized · s = 0.45 · retained revisions
  - A 23–26 ↔ B 31–37 · s = 0.883333 · composition
    - A 24 ↔ B 32–34; A 25 ↔ B 35–37 · summarized · s = 0.9 each; A 26 ↔ B 85 · relocated · s = 0.5 · pinned binding
  - A 27–29 ↔ B 89–91 · relocated, offset 1 · s = 0.45 · resolved document; A 28 ↔ B 91 · s = 1
- A 32–51 ↔ B 57–75, 77–95 · grouped · s = 0.965486 · controller and history
  - A 33–37 ↔ B 59–72 · s = 0.983333 · versioned operations; A 34 ↔ B 62, 63 · grouped · s = 1; A 35, 36 ↔ B 64–67 · grouped · s = 1; A 37 ↔ B 68–72 · summarized · s = 0.9
  - A 38–39 ↔ B 73 · summarized · s = 0.9 · transient update
  - A 40–44, 45–47, 48–49 ↔ B 77–95 · grouped · s = 0.909583 · history, views and transfer
    - A 41 ↔ B 79–80; A 42 ↔ B 81–87 · summarized · s = 0.9 each; A 43 ↔ B 92 · s = 1
    - A 44 ↔ B 74–75 · relocated, summarized · s = 0.45; A 45–47 ↔ B 88 · offset 1, summarized · s = 0.81; A 48–49 ↔ B 93–95 · offset 1 · s = 0.855
- A 53–69 ↔ B 97–109, 48–55, 43–46 · grouped · s = 0.709063 · presentation and source inspection
  - A 54–59 ↔ B 97–109 · s = 0.87 · editor runtime: shape projection A 55 ↔ B 100–101 (0.9), native geometry A 56–57 ↔ B 102–103 (1), settlement A 58 ↔ B 104–105 (0.9), restoration A 59 ↔ B 106–108 (0.9); unmatched B 109 (runtime disposal)
  - A 60–61 ↔ B 48–55 · relocated · s = 0.375 · canvas state; A 61 ↔ B 49, 50 (1); unmatched B 51–55 (folded-content projection)
  - A 62–65 ↔ B 43–46 · relocated, offset 1 · s = 0.4275 · source evidence; A 63–64 ↔ B 44 · summarized · s = 0.9
  - Unmatched A 66–67 (source/code panes).
- A 71–87 ↔ B 111–128 · s = 0.920313 · agent-assisted editing
  - A 72–75 ↔ B 112–116 · s = 0.8625 · composer and request; A 73 ↔ B 114–115 (0.9), A 74 ↔ B 119 (1), A 75 ↔ B 120 (1); unmatched B 116
  - A 76–79 ↔ B 117–120 · s = 0.833333 · edit runs; A 77 ↔ B 118 (1), A 78 ↔ B 115 (1); unmatched A 79
  - A 80–82 ↔ B 121–123 · s = 0.666667 · canvas bridge; A 81 ↔ B 122 (1); unmatched A 82 and B 123
  - A 83–85 ↔ B 124–128 · s = 1 · revision receiver; A 84 ↔ B 126, 127 (1), A 85 ↔ B 128 (1)
- A 89–104 ↔ B 130–149 · s = 0.856250 · workspace persistence
  - A 90–93 ↔ B 134–138, 139–144 · grouped · s = 0.966667 · incremental persistence and storage; A 91 ↔ B 136 (1), A 92 ↔ B 137–138 (0.9), A 93 ↔ B 139–144 (0.9)
  - A 94–97 ↔ B 145–149 · s = 0.983333 · record store; A 95 ↔ B 146 (1), A 96 ↔ B 147 (1), A 97 ↔ B 148–149 (0.9)
  - A 101 ↔ B 131–133 · summarized · s = 0.9 · reload; unmatched A 98–100 (project checkpoint publication).

### Score
Top-level J = (0.822500 + 0.865972 + 0.965486 + 0.709063 + 0.920313 + 0.856250) / 6 = **0.856597**.

### Verdict
Both trees identify the workspace/session, revisioned model, controller/history, editor, agent-editing and persistence components. B separates CanvasSession and history into top-level nodes that A places under their owning workspace and controller; those implied parents account for the grouped matches. B places presentation state and source evidence under its semantic-model branch, while A places them under presentation and inspection. The remaining differences are mainly detail: B expands editor and storage mechanics, whereas A separately identifies source panes and explicit project checkpoint publication.
