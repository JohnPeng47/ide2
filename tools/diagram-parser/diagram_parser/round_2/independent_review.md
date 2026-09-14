# Independent round 2 review

Reviewer: `/root/round_2_independent_review`. Six generators produced exactly six diagrams; no extra outputs.

**Clean semantic-label result: 1 confirmed incorrect diagram, 4 passes, and 1 ambiguous diagram.** Parser exceptions: **0**. Strict diagnostic failures: **0**. These are distinct categories.

The confirmed failure is `sol_3_1`: 14 labels contain right-side routing graphics. All explicit containment hierarchies are correct. `sol_1_1` needs a policy decision about its ordinary asterisk-bullet invariant appendix.

Under a **literal suffix-label** contract, there are **0 confirmed failures, 5 passes, and 1 ambiguity**. If ordinary bullet lists count as trees, that literal contract gives 6 passes. Under clean semantic labels, treating the appendix as prose gives 2 failures / 4 passes; accepting it as a tree gives 1 failure / 5 passes.

## Method and coverage

Original sources were read first, including every heading, note, separator, unmarked line, and detached forest. No parser code, snapshot code, existing tests, or earlier-round results were read, and the parser was not run. The frozen inputs and outputs were not modified.

A source-specific independent checker uses explicitly reviewed boundaries and the observed four-column ASCII branches. It compares all 716 actual nodes, all 704 containment edges, 12 roots, and all 797 source lines. It checks labels, parent/ordered children, depth, source positions/spans, raw text, root/order consistency, line classification, and review-table agreement. Seven ambiguous appendix nodes are also fully checked against the alternate bullet-tree interpretation. No actual wrapped labels occur.

Reproduce with `python diagram_parser/round_2/independent_check.py`. `independent_expected.json` records every expected node, edge, line classification, and the appendix alternative.

| Diagram | Verdict | Actual nodes / edges / roots | Expected nodes / edges / roots |
|---|---|---|---|
| sol_1_1 | ambiguous | 126 / 124 / 2 | 119 / 118 / 1 (unambiguous core; alternate 126 / 124 / 2) |
| sol_2_1 | pass | 110 / 108 / 2 | 110 / 108 / 2 |
| sol_3_1 | fail | 129 / 124 / 5 | 129 / 124 / 5 |
| astra_1_1 | pass | 114 / 113 / 1 | 114 / 113 / 1 |
| astra_2_1 | pass | 111 / 110 / 1 | 111 / 110 / 1 |
| astra_3_1 | pass | 126 / 125 / 1 | 126 / 125 / 1 |

## sol_1_1: ambiguous

File: `generated/sol_1/diagrams/mapping-domain-model.txt`

Input SHA256: `faac5a29f307fff9e7e92edb93f47e71fecdac5225e05155ad1c048c4f2c7069`

Lines 1-3 are title, underline, and blank. Project at line 4 is the root of the unambiguous tree through line 123. Lines 125-135 are a KEY RELATIONSHIPS heading, underline, and flat multiplicity statements; all are correctly excluded from the tree, without inventing children or continuation labels. Lines 137-145 form an underlined INVARIANTS heading and six ordinary asterisk bullets. This may be prose notes or a supported bullet tree, so its inclusion is ambiguous. No wrapped labels.

Expected root lines: [4]. Actual root lines: [4, 137]. All unambiguous node/edge structure and line accounting match.

The parser creates an additional root at line 137 and exactly six children at lines 140-145. If these are prose notes, all seven nodes and six edges are extraneous; if bullet lists are accepted tree syntax, all seven labels and edges are correct. Neither interpretation is forced into a pass/fail verdict. The key-relationships statements at lines 128-135 are correctly prose under both readings.

Parser exception: none. Strict diagnostic failure: no. Source lines checked: 145; actual classifications: {"blank": 5, "border": 3, "guide": 1, "node": 126, "prose": 10}.

## sol_2_1: pass

File: `generated/sol_2/diagrams/mapping-domain-model.txt`

Input SHA256: `4ae31397e2bb8ca1cd82961197520d61433fc8e70debc47af5394cba1a2d7a89`

MAPPING PROJECT DOMAIN at line 1 and INVARIANTS at line 112 are separate visible roots: both are followed by a vertical guide and explicit ASCII branches. The detached invariant tree has seven children at lines 114-120. Both roots and every child are correctly preserved. No prose appendix or wrapped labels.

Expected root lines: [1, 112]. Actual root lines: [1, 112]. All unambiguous node/edge structure and line accounting match.

Parser exception: none. Strict diagnostic failure: no. Source lines checked: 120; actual classifications: {"blank": 1, "guide": 9, "node": 110}.

## sol_3_1: fail

File: `generated/sol_3/diagrams/mapping-domain-model.txt`

Input SHA256: `acc91a2299e737e53098bb732005c9f55a23257894d4bcef08dfdc832a5f4209`

Lines 1-3 are a title/underline/blank. MappingProject at line 4 is the first root. DERIVED READ MODELS at line 115 is a heading for three detached trees rooted at lines 118, 125, and 134; its underline and intervening blanks are not nodes. SOURCE ANCHORS at line 142 governs seven explicit ASCII branches at lines 145-151 and is accepted as a fifth root, even though its children are references rather than domain entities. Unlike ordinary prose bullets, these rows explicitly use the diagram branch syntax. Right-side reference wiring spans lines 16-20 and 35-48 and is not wrapped label text. No actual wrapped labels occur.

Expected root lines: [4, 118, 125, 134, 142]. Actual root lines: [4, 118, 125, 134, 142]. All unambiguous node/edge structure and line accounting match.

The following are clean-label errors, not missing containment edges. In particular the vertical bars at lines 17, 37-38, and 41-46 are part of routes beside unrelated nodes. All parent/child relationships are correct.

| Source line | Expected semantic label | Actual parsed label |
|---|---|---|
| 16 | `currentRevisionId` | `currentRevisionId -----------------------+` |
| 17 | `revisions: 1..* (through catalog)` | `revisions: 1..* (through catalog)        \|` |
| 20 | `ProjectRepresentationRevisionRecord` | `ProjectRepresentationRevisionRecord <--------+` |
| 35 | `collapsedContentId?` | `collapsedContentId? --------+` |
| 37 | `DiagramGridBox` | `DiagramGridBox                    \|` |
| 38 | `kind: diagram` | `kind: diagram                 \|` |
| 39 | `contentId` | `contentId --------------------+---+` |
| 41 | `ContainerGridBox` | `ContainerGridBox                      \|` |
| 42 | `kind: container` | `kind: container                    \|` |
| 43 | `children: GridBox[] (recursive)` | `children: GridBox[] (recursive)    \|` |
| 44 | `layout` | `layout                             \|` |
| 45 | `collisionPolicy: push-right` | `collisionPolicy: push-right    \|` |
| 46 | `gap` | `gap                            \|` |
| 48 | `contents: { contentId -> GridContent }` | `contents: { contentId -> GridContent } <---+` |

Visible routes connect lines 16 → 20, 35 → 48, and 39 → 48. These are references, not containment edges, so their absence from tree parent/children fields is not counted as a structural failure. Standalone wire rows 18, 36, 40, and 47 are correctly accounted for as guides. A literal suffix extractor preserves these glyphs correctly; a semantic-label extractor does not separate them from labels.

Parser exception: none. Strict diagnostic failure: no. Source lines checked: 151; actual classifications: {"blank": 7, "border": 3, "guide": 10, "node": 129, "prose": 2}.

## astra_1_1: pass

File: `generated/astra_1/diagrams/mapping-domain-model.txt`

Input SHA256: `07baf0de3c027b7df1c11bf21544f411cca1752010a8d25b6fed377f003558b2`

Line 1 is the visible tree root because line 2 carries its vertical connector. The complete tree is lines 1-120. Lines 122-123 are detached legend/scope prose and are correctly excluded. No wrapped labels or additional trees.

Expected root lines: [1]. Actual root lines: [1]. All unambiguous node/edge structure and line accounting match.

Parser exception: none. Strict diagnostic failure: no. Source lines checked: 123; actual classifications: {"blank": 1, "guide": 6, "node": 114, "prose": 2}.

## astra_2_1: pass

File: `generated/astra_2/diagrams/mapping-domain-model.txt`

Input SHA256: `256f0d5cd0724369fccf9d4be9af034865f7f76caa5933a49aea05238c2eabb2`

Line 1 is the visible tree root connected through line 2. The complete tree is lines 1-117. Lines 119-120 are detached notation/scope prose and are correctly excluded. No wrapped labels or additional trees.

Expected root lines: [1]. Actual root lines: [1]. All unambiguous node/edge structure and line accounting match.

Parser exception: none. Strict diagnostic failure: no. Source lines checked: 120; actual classifications: {"blank": 1, "guide": 6, "node": 111, "prose": 2}.

## astra_3_1: pass

File: `generated/astra_3/diagrams/domain-model.txt`

Input SHA256: `521ac9b7d0f0fea833791e492289e36759946359d4bbff04ae32947bcf6b86a5`

Lines 1-3 are title, scope prose, and a notation legend, separated from the actual root Mapping workspace at line 5. The tree is lines 5-138. Those introductory lines are correctly excluded. No wrapped labels or additional trees.

Expected root lines: [5]. Actual root lines: [5]. All unambiguous node/edge structure and line accounting match.

Parser exception: none. Strict diagnostic failure: no. Source lines checked: 138; actual classifications: {"blank": 1, "guide": 8, "node": 126, "prose": 3}.
