### Anchor tree
- No shared code anchors.
- Unmatched A: 3–12 (runtime boundary and App); 13–20 (Surface session and workers); 22–34 (terminal input); 36–47 (child output); 49–62 (terminal model); 64–76 (renderer); 78–87 (geometry and configuration); 89–97 (shutdown).
- Unmatched B: 3–17 (CanvasWorkspace and CanvasSession); 19–42 (history and diagrams); 44–63 (controller and editor); 65–83 (selection and sources); 85–106 (AI and agents); 108–129 (persistence and publication).

### Score
No top-level anchors contribute an s value. J = 0 / (0 + 8 + 6) = **0**.

### Verdict
The trees identify different code: A describes Ghostty’s Zig terminal session, while B describes a TypeScript mapping-canvas workspace. Similar generic terms such as “App” do not name the same component. There is no shared breakdown to compare, nor an implied shared parent.
