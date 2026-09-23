# GumTree assessment and ChangeSession diff implementation plan

Status: matcher implementation complete. Parser/content-model changes remain out of scope.

## Implemented scope

`domain/mapping/changes/diagramNodeMatcher.ts` independently implements staged correspondence over existing parsed nodes; it does not copy/translate upstream source or introduce a GumTree runtime dependency. `diagramContentDiff.ts` retains classification, move/LIS handling, counts, ancestor indicators, and loose-line fallback.

- Valid, nonconflicting patch origins are locked first, then unique exact labels (including roots/leaves), atomic exact subtrees, and contextual exact matches. Unequal duplicate groups remain unresolved without occurrence evidence.
- Container recovery aggregates mapped-descendant overlap in postorder. Acceptance requires coverage of at least `max(0.5, 1 / (1 + log(oldSize + newSize)))`. Direct-child evidence, label similarity, and matched-parent context distinguish candidates. Both directions must prefer the pair by more than 0.1 score units; ties remain unresolved.
- Label recovery retains the single-gap replacement rule and adds bounded sequence alignment. Multi-node candidates require shared meaningful words, token/bigram similarity of at least 0.65, and a greater-than-0.1 advantage in both directions. Maximum gap: 64 nodes on each side and 4,096 cells. Larger uncertain gaps remain additions/removals.
- Recovery repeats while matches are added. Every phase uses a guarded bijection. Matching never updates content IDs, edge anchors, source mappings, or `nodeOrigins`.

Tests cover the reconstructed FloatingPane regression, exact-root preservation, subtree moves, container splits/merges, duplicate ambiguity/provenance, multiple label edits, generated correspondence invariants, parser compatibility, and cumulative session history. The existing controller fixture remains conservative. The full planning matrix in `gumtree-change-session-test-plan.md` includes additional parser/adapter work outside this implementation; it is not a claim that every proposed case was implemented.

Known separate gaps remain: text/node representation transitions when a bare root gains its first child; normalized quoted coordinates (currently raw-line fallback); and partial raw-text coverage when a filtered span shares a row with a valid node. No parser versions or adapters changed.

Run the benchmark with `node --import tsx tests/performance/diagram-content-diff.mjs`. It verifies expected counts before timing already-parsed inputs within the 20,000-character limit. On this development host, 12-run medians were approximately 28 ms for 1,300 siblings plus an insertion, 71 ms for an 85-container renamed chain, 20 ms for 1,500 ambiguous repeated siblings, and 1–8 ms for bounded label-recovery cases. Timings are observations, not CI thresholds or browser latency guarantees.

## Recommendation

Adapt GumTree's staged node correspondence into the existing TypeScript renderer diff. Preserve our exact matches and ambiguity rules, add descendant-based bottom-up matching, and replace the current single-replacement limitation with guarded local recovery.

The upstream implementation contains the missing mechanism, but its unmodified matching policies do not fit all our existing expectations. Prefer the Simple pipeline as the architectural reference. Classic/Hybrid's tree-edit-distance recovery made incorrect rename matches in our controller fixture.

Keep `diffDiagramContent`'s output contract and its status/move/ancestor/prose classification. The preview needs a correspondence, not an executable tree-edit script or a Java runtime.

## Source inspected

Pulled https://github.com/GumTreeDiff/gumtree into `/tmp/gumtree-review-20260921`.

- Commit: `286fa3028cc3e4d7e5f621266c6541018167cf1b` (2026-09-11).
- Checkout version: `4.1.0-SNAPSHOT`.
- Core compiled from that checkout with a temporary JDK 17 and Maven dependencies; no upstream source edits were needed. This bypassed Gradle and did not run GumTree's complete test suite.
- Source files carry LGPL-3.0-or-later notices. Record attribution and handle the upstream license explicitly for any copied or translated source; a Java-to-TypeScript translation is not merely a dependency change.

Relevant upstream files, pinned to the inspected commit:

| File | What to borrow or account for |
| --- | --- |
| [CompositeMatchers.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/matchers/CompositeMatchers.java) | Simple = GreedySubtreeMatcher + SimpleBottomUpMatcher; Classic uses GreedyBottomUpMatcher. Simple has the highest registration priority. |
| [AbstractSubtreeMatcher.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/matchers/heuristic/gt/AbstractSubtreeMatcher.java) | Matches identical subtrees largest-height-first. Default minimum height is 1, excluding isolated leaves as anchors. |
| [GreedySubtreeMatcher.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/matchers/heuristic/gt/GreedySubtreeMatcher.java) | Resolves duplicate subtree candidates greedily using contextual and positional comparators. This differs from our deliberately unresolved duplicates. |
| [SimpleBottomUpMatcher.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/matchers/heuristic/gt/SimpleBottomUpMatcher.java) | Finds candidates by walking ancestors of already-matched descendants. Allows different text labels and parents when node types agree. Recovers unmatched children with exact-subtree LCS, structure-only LCS, and unique-type histograms. |
| [SimilarityMetrics.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/matchers/SimilarityMetrics.java) | Simple uses common mapped descendants / maximum descendant count (Chawathe similarity). Classic uses Dice similarity. |
| [ZsMatcher.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/matchers/optimal/zs/ZsMatcher.java) | Classic/Hybrid recover matches with Zhang–Shasha tree edit distance and q-gram label costs. Even unrelated same-type labels can be cheaper to update than delete+insert. |
| [ChawatheScriptGenerator.java](https://github.com/GumTreeDiff/gumtree/blob/286fa3028cc3e4d7e5f621266c6541018167cf1b/core/src/main/java/com/github/gumtreediff/actions/ChawatheScriptGenerator.java) | Generates separate updates and moves from established mappings; aligns siblings with LCS. Useful reference, but our existing classification already serves the preview. |

Simple's default bottom-up acceptance threshold is `1 / (1 + log(oldDescendants + newDescendants))`. Classic's default Dice threshold is 0.5. These are upstream defaults, not validated acceptance thresholds for ASCII diagrams.

## Experiment and findings

Ran 12 input pairs through Simple, Classic, and Hybrid, each with minimum anchor height 1 and 0, both with and without unique exact-label seed mappings: 144 executions. Verified the reported observations with assertions, including that mappings remained bidirectional in these runs.

The inputs used our actual `buildDiagramContent` / `diagramContentNodes` parser. Every parsed content node received a generic `line` type, and a separate synthetic `diagram` root wrapped the forest. The controller pair came from our existing `controllerDiffFixture.ts`. The screenshot failure was reconstructed as a minimal example, not read from the saved live ChangeSession.

Temporary experiment artifacts:

- `/tmp/GumtreeReview.java`: runner using upstream matchers and Chawathe actions.
- `/tmp/gumtree-review-cases.json`: parsed input pairs.
- `/tmp/gumtree-review-results.json`: mappings and actions for all 144 runs.
- `/tmp/gumtree-review-jdk`, `/tmp/gumtree-review-libs`, `/tmp/gumtree-review-classes`: isolated build environment.

These paths are temporary investigation artifacts, not production dependencies. Preserve the relevant fixtures in our test suite during implementation.

Observed results with Simple, minimum height 0, and unique exact-label seeds:

| Case | Upstream result | Fits current desired behavior? |
| --- | --- | --- |
| Insert wrapper around unchanged subtree | 1 insertion, 1 move | Yes: only the existing subtree root moves. |
| Insert wrapper, shorten DisplayNodeBase label, add description child | 2 insertions, 1 update, 1 move | Yes: DisplayNodeBase survives; its unchanged children get no actions. |
| Edit both placement and sizing labels | 2 updates | Yes. |
| Move Moving/Leaf from A to B | 1 move of Moving | Yes. |
| Insert sibling before A/B | 1 insertion | Yes. |
| Reorder C/A/B | 1 move | Yes. |
| Rename diagram's visible root | 1 update | Yes. |
| Remove wrapper while retaining its subtree | 1 deletion, 1 move | Yes. |
| Keep repeated siblings while renaming another sibling | 1 update | Yes. |
| Controller demo, structural nodes only | 9 insertions, 5 deletions | Yes. Prose remains our separate diff's responsibility. |
| Replace unrelated A/B with X/Y | 2 updates | No: current contract keeps this multi-node gap ambiguous. |
| Delete one of two indistinguishable Same siblings | 1 deletion | No: it selects a survivor, while our unseeded contract declines to guess. |

Additional findings:

- Without exact seeds, even the unchanged-wrapper example could rename the old `Root` to the new wrapper and insert a replacement `Root`. Descendant overlap alone does not establish semantic identity when all diagram nodes have one generic type.
- Without seeds, moving a subtree from A to B could be represented as renaming containers. Preserving exact matches fixed this in the experiment.
- With minimum height 1 and no seeds, isolated leaves are unavailable as global anchors. The simple sibling reorder became label updates; height 0 recovered the move.
- Classic and Hybrid, even with exact seeds, interpreted three genuinely replaced controller nodes as renames: for example, `CanvasSessionBridge -> browser poll/reply` became `changeSessionId`. Their smaller edit script is not our desired review result.
- Simple's structure-only recovery still pairs unrelated same-type leaves by order. We must not import that rule unchanged.

## Proposed implementation

### 1. Establish fixtures and extract the matching seam

Add the reconstructed FloatingBox failure and small independent cases to `domain/mapping/changes/__tests__/diagramContentDiff.test.ts`, plus a dedicated fixture file for the before/after ASCII.

Extract node correspondence from `diagramContentDiff.ts` into `domain/mapping/changes/diagramNodeMatcher.ts`. Return forward/reverse maps; optionally retain internal match reasons for tests. Keep indexing validation and the existing `DiagramContentDiff` contract stable.

Acceptance at this step: extraction leaves all existing tests unchanged; new bug reproductions fail for the documented reason. Before final validation, capture the actual saved baseline/proposal when available to cover its exact parser output.

### 2. Preserve strong matches before bottom-up inference

Use one guarded pairing operation for every phase. It must preserve a bijection and must never overwrite a provenance seed or accepted match.

Order the evidence:

1. Existing exact patch provenance, validated against current nodes/labels.
2. Exact subtree correspondence and unique exact labels, retaining the current successful reparenting behavior. Include unique leaves as anchors. Check whole-subtree pairing against existing mappings before committing it.
3. Exact local matches under matched parents; pair equal repeated sibling groups in order only when multiplicities and context support it, as today.

Keep revision IDs, indentation, and source positions as presentation metadata, not structural identity. Use a synthetic forest root if needed, exclude it from output, and allow visible roots to rename or move. Do not manufacture AST types from the full text label or from whether a node currently has children.

Acceptance: wrapper-only, unchanged root labels, subtree moves, duplicate provenance, and sibling insertion/reordering retain their current semantics.

### 3. Add GumTree-style bottom-up container recovery

Visit unmatched containers in postorder. For each, gather candidate ancestors of its already-matched descendants in the other tree. Score common mapped descendants against candidate subtree size, following Simple's Chawathe measure.

Require a unique, evidence-supported winner. Prefer established direct-child correspondences and label similarity when a new wrapper competes with the surviving node. If candidates remain indistinguishable, keep them unresolved. Do not accept a parent mapping that contradicts existing child/provenance mappings.

Start evaluation with upstream's dynamic threshold, then make any stricter ASCII-specific acceptance rule explicit and fixture-backed. A threshold alone must not override ambiguity or a stronger exact match. Rerun local recovery when a new parent match creates a new context; terminate when no pairs are added.

Acceptance: the renamed DisplayNodeBase is matched across its new parent; only it is modified/reparented, while expandedGeometry? and geometryPolicy keep their identities. Include competing-wrapper and repeated-container negative cases to prevent matching whichever ancestor is largest or closest.

### 4. Recover multiple edited siblings with label evidence

Retain exact subtree LCS and the existing single-replacement rule. For remaining multi-node gaps under matched parents, add sequence alignment over admissible label-edit candidates.

Use normalized token/character similarity only for correspondence. Preserve raw text for the final modified status. In the placement/sizing case, punctuation and spacing changes leave distinctive matching words; A/B versus X/Y has no such evidence.

Do not use structure-only LCS or a unique generic `line` type as proof of identity. Require a clear candidate advantage; leave tied duplicates and unsupported replacements as added/removed. Resolve the alignment with accepted anchors fixed rather than filtering conflicting matches afterward.

Limit the first implementation to small gaps (initial bound: 64 unmatched nodes per side and 4,096 alignment cells). Above that bound, retain already-established matches and classify unresolved nodes conservatively. Validate and tune the bound with measured fixture/performance results; do not import Classic's whole-subtree Zhang–Shasha fallback in the first pass.

Acceptance: placement and sizing become modifications together; the unrelated-replacement, duplicate-deletion, and controller fixtures preserve their intended classifications.

### 5. Feed the completed correspondence into existing classification

Keep these responsibilities in `diagramContentDiff.ts`:

- Unmatched nodes become added/removed.
- Matched nodes with different raw labels become modified.
- Matched nodes with changed immediate parents become moved; descendants of a moved subtree remain unchanged when their own parents correspond.
- Existing LIS logic detects sibling moves without marking insertion-induced shifts.
- Ancestor `containsChanges`, folded prose indicators, loose-line diffing, and counts remain intact.

`changeDocumentDiff.ts` and `ChangeSessionPreview.tsx` should consume the same result shape. No ChangeSession storage/API migration is required. Continue to treat inferred correspondence as rendering-only: never write it into `nodeOrigins`, edge anchors, or source mappings. Explicitly test that diffing does not mutate either snapshot.

### 6. Validate behavior and performance

Run the targeted diagram-content diff tests, ChangeSession service/store tests, patch provenance tests, and typecheck. Add cases for cumulative edits, revert/undo/redo, multiple documents, visible-root edits, nested wrappers, and repeated labels with and without exact provenance.

Check the expected highlights in the browser using the actual baseline/proposal fixture once available. Verify both Original and Proposed, moved-plus-modified styling, and collapsed ancestors.

Benchmark representative wide, deep, and repeated-label trees within the existing 20,000-character diagram limit. Avoid rebuilding descendant sets inside every candidate comparison; cache/index traversal data. Bound local alignment work, preserve deterministic iteration/tie handling, and check repeated preview recomputation. Record timings rather than assuming upstream AST defaults suit browser rendering.

Completion means the reported parent-insertion failure is fixed, the conservative ambiguity fixtures still pass, raw text/prose highlighting remains correct, provenance is untouched, and measured runtime is acceptable for the preview. No acceptance/save behavior or canvas-editing feature is part of this change.

## Delivery order

1. Fixtures and matcher extraction.
2. Seed-preserving bottom-up recovery; fixes the moved-and-renamed parent.
3. Guarded multi-sibling label recovery; fixes placement/sizing without broad false renames.
4. Browser validation, adversarial cases, and performance checks.

The implementation should document which behavior comes from GumTree and which constraints intentionally differ for ASCII review. This is an adaptation of its correspondence pipeline, not a claim of full GumTree equivalence.
