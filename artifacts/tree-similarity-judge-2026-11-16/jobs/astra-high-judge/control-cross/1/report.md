## 1. Anchor tree
No shared component anchors. The root descriptions are treated as headings; their immediate component branches are compared.

- unmatched: A 3–11 (runtime boundary and application coordination)
- unmatched: A 13–20 (Surface session and workers)
- unmatched: A 22–34 (terminal input handling)
- unmatched: A 36–47 (child output and protocol interpretation)
- unmatched: A 49–62 (terminal session model)
- unmatched: A 64–76 (frame preparation and GPU rendering)
- unmatched: A 78–87 (geometry and configuration)
- unmatched: A 89–97 (session shutdown)
- unmatched: B 3–17 (canvas workspace and session ownership)
- unmatched: B 19–42 (canvas history and diagram revisions)
- unmatched: B 44–63 (document controller and editor runtime)
- unmatched: B 65–83 (selection and source exploration)
- unmatched: B 85–106 (AI and agent operations)
- unmatched: B 108–129 (workspace persistence and publication)

## 2. Score
k = 0, uA = 8, uB = 6; Σs = 0.

J = 0 / (0 + 8 + 6) = **0**.

There are no top-level anchor scores or recursive comparisons.

## 3. Verdict
The trees identify no common code components. A decomposes a terminal session; B decomposes a revisioned mapping workspace. Generic similarities such as sessions, selection, workers and cleanup do not establish code identity. In particular, A's App coordinates terminal surfaces, whereas B's App names a mapping-page entry point. This is a difference in component identity, not detail, grouping or relocation. No shared implied parent was identified. The score reflects unmatched components, not an assessment of either tree's correctness.
