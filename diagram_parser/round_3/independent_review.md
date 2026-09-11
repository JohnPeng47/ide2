# Round 3 independent semantic review

**Result: 5 passes, 1 semantic failure across 6 accepted fresh diagrams.** Sol 1 fails. Sol 2, Sol 3, Astra 1, Astra 2, and Astra 3 pass the declared semantic extraction policy. There were **0 parser exceptions, 2 strict/diagnostic failures, and 7 diagnostic events**. Astra 3 is a semantic pass even though its correctly joined wrapped label triggers strict failure. Zero diagnostics was not used as evidence of correctness.

Reviewer identity: `/root/round_3_independent_review`. I read the five original ASCII files and then the accepted replacement Sol 2 ASCII before inspecting any parser output. I saved a source-derived expected fixture first. I did not read or run parser code, snapshots, tests, earlier-round reports, or excluded-input contents. An initial directory listing showed excluded filenames; their contents were not inspected. Sol 2 is the accepted verbatim final-response extraction identified in the capture manifest; excluded generations are outside the six-file denominator.

The fixture uses explicitly reviewed tree boundaries, literal routing-suffix overrides, separate columns for the overlapping Sol 1 trees, and an explicit two-line label span for Astra 3. It preserves named inline reference arrows verbatim, including arrow lengths. Wire graphics and reference/workflow arrows do not imply containment. Explicit-connector appendices remain trees. No detached ordinary prose bullet appendix occurs in these six accepted sources, so this round does not add evidence about that policy branch.

| Diagram | Verdict | Nodes expected / actual | Roots expected / actual | Edges expected / actual | Source lines | Actual excluded lines | Actual continuation lines | Strict fails |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Sol 1 | Fail | 169 / 172 | 15 / 12 | 154 / 160 | 224 | 50 | 2 | Yes |
| Sol 2 | Pass | 110 / 110 | 4 / 4 | 106 / 106 | 113 | 3 | 0 | No |
| Sol 3 | Pass, heading alternative | 169 / 169 | 2 / 2 | 167 / 167 | 183 | 14 | 0 | No |
| Astra 1 | Pass | 123 / 123 | 7 / 7 | 116 / 116 | 133 | 10 | 0 | No |
| Astra 2 | Pass | 118 / 118 | 7 / 7 | 111 / 111 | 128 | 10 | 0 | No |
| Astra 3 | Pass | 111 / 111 | 1 / 1 | 110 / 110 | 124 | 12 | 1 | Yes |
| **Total** | **5 pass / 1 fail** | **800 / 803** | **36 / 33** | **764 / 770** | **905** | **99** | **3** | **2** |

Expected counts in this table use the independently predeclared interpretation alternatives closest to the actual output. Baseline counts and alternatives are also retained in the JSON, so this does not conceal heading uncertainty. The fixture covers 800 expected node/continuation source lines and 105 excluded source lines under the selected alternatives. All 803 actual nodes, ordered roots, ordered child arrays, parent identities, depths, source start coordinates, end lines, raw source spans, and all 905 line classifications were compared. All review-table node and excluded-line rows were also checked against the frozen JSON. Source hashes and parsed-output hashes match the capture summary. The output format has no end-column field; the fixture records end columns independently, while supported parsed start-column and end-line fields are checked.

**Sol 1 findings.** Lines below are 1-based; columns are 0-based. Exact expected-versus-actual details for every mismatching node and source line are retained in `independent_review.json`.

| Source lines | Expected | Actual |
|---|---|---|
| 20, 22, 26 | Labels `scene`, `evidence`, `scene`; routing tails excluded | `scene ------------------------------------+`, `evidence ---------------------------------+---------+`, `scene -------------------------------------------------+` |
| 32, 34–41 | Semantic labels such as `collapsedContentId?`, `DiagramBox`, `contentId`, `ContainerBox`, `layout`, `gap`; adjacent wires excluded | Trailing `---+`, spaces plus `\|`, or multi-junction wire tails remain in labels. Line 34 is `DiagramBox                                    \|`. |
| 24, 42 | Excluded arrowheads/routing graphics; no nodes or containment edges | `v         v` becomes a child of line 22 `evidence`; `v` becomes a child of line 41 `gap`. |
| 25 | `MappingDocument` at column 0; `LineGridScene` at column 55 is a separate reference target, optionally a standalone root | One merged label, `MappingDocument                                        LineGridScene`. |
| 43 | `contents: GridContent [contentId -> content]` at column 8 under line 26; separate `GridContent` root at column 57 | Both labels merge into the contents node; the separate GridContent root is missing. |
| 44–47 | `id` at line 44 column 64, plus `ascii`, `revision`, and `mappings: EvidenceMapping[]`, all children of separate line 43 column 57 `GridContent` | Line 44 becomes `\|-- id` at column 60 under line 43 column 8 `contents`; lines 45–47 incorrectly become children of line 44. |
| 84–85 | Standalone `-->` save-result annotations; no containment children | `new ProjectRepresentationRevision` and `updated ProjectRepresentation.currentRevisionId` become children of line 83 `Draft + expected revisionId`. |
| 148–150 | Line 148 label ends at `CallTreeNode`; lines 149–150 are routing graphics | Arrowhead `v` joins the label: `targetNodeIds[] --------------------------------> CallTreeNode v`; end line becomes 150 instead of 148. |
| 151–159 | `projectSelection()` is a separate workflow tree root, with `ProjectionSelectionResult` and its ordered descendants | Root attaches as a containment child of line 146 `links[]`; subtree depths are inflated. |
| 171–173 | `mappings: treeLine -> sourceRanges`, ending at line 171; arrowhead excluded | `mappings: treeLine -> sourceRanges v`, ending at line 173. |
| 174–180 | `projectCompactions()` is a separate workflow tree root, with `projected files` and its ordered descendants | Root attaches as a containment child of line 167 `files: CompactionSnapshot[]`; subtree depths are inflated. |

The GridContent branch has a one-column alignment wobble between its first and remaining child branches. The intended sibling relationship is still evident from the four branch connectors; this is not an unresolved parent ambiguity. Downstream range fields at lines 48–50 retain their local parent links but acquire wrong total depths because the right-hand tree was attached to the left-hand one.

**Passing-file checks.** Sol 2 correctly removes all three Unicode routing-only suffixes at lines 10–12 while preserving named inline Unicode arrows at lines 60 and 62. Sol 3 correctly removes routing-only suffixes at lines 14–16 and retains its twenty-node explicit-connector source appendix. Its ten source-file entries remain children of their corresponding ten labels in order. Astra 1 and Astra 2 match every expected node, root, edge, label, coordinate, and exclusion. Astra 3 correctly treats line 1 as the actual tree root because branches descend from it, excludes prose at lines 122–124, and joins lines 76–77 into exactly `Shared inputs: project context, session id, ASCII, revision, mappings, selection, instruction`, under line 75 `Prompt operation`, beginning at line 76 column 12 and ending at line 77. The joined-continuation diagnostic is informational, not a semantic failure.

**Unresolved source intent, tracked separately.** There are three genuine interpretation regions in two diagrams, and zero diagrams whose final verdict is ambiguous-only. These alternatives were written into the fixture before parser inspection:

- Sol 1 line 25: the isolated `LineGridScene` arrow target may be preserved as a standalone root or omitted as reference-only content. Neither alternative permits concatenating it into `MappingDocument`.
- Sol 1 lines 221–224: underlined `Legend` may be a heading above two connector roots or a parent root containing those two entries. The actual heading-as-root form is accepted. This does not excuse any earlier Sol 1 failure.
- Sol 3 lines 161–183: underlined `SOURCE MAP` may be a heading above a ten-root appendix or an additional tree root parenting those entries. Both were predeclared; the parser matches the latter exactly. The declared appendix policy requires keeping the connector entries, which the parser does.

These alternatives explain the difference between the baseline fixture totals of 799 nodes / 47 roots / 752 edges and the selected-alternative totals of 800 / 36 / 764. Sol 1 fails under every accepted alternative. Sol 3 has no deterministic semantic mismatch under its accepted alternative.

**Source hashes.** Paths are relative to `round_3/`.

| Diagram / source | SHA-256 |
|---|---|
| Sol 1 — `generated/sol_1/diagrams/mapping-domain-model.txt` | `734a48698f4a8babb0fbe6dd3c22d23209c733158d35aadfbacd56559a3c452e` |
| Sol 2 — `blind_replacement/sol_2/diagrams/domain-model.txt` | `8ef6fb0d17710abdd2bab715bc2458ef4606410db61adf42dc03fe7bf13bd095` |
| Sol 3 — `generated/sol_3/diagrams/domain-model.txt` | `22a82eca11ac57e13208600c82cbaedd06493092a69a27d0a65cb34c1aba8fce` |
| Astra 1 — `generated/astra_1/diagrams/domain-model.txt` | `fab52c11c51a6b75f309746a858b2448ed207d0bbcb86c89c4c021d8f761a66a` |
| Astra 2 — `generated/astra_2/diagrams/domain-model.txt` | `b32c5a2347d8da0d68960aa23351015f089ad52f1ba2cf468c41f1dd961b4348` |
| Astra 3 — `generated/astra_3/diagrams/domain-model.txt` | `7697b4e29aa26e7ce68115c685d3e009fd260d8924300019b3b14867a6b898f7` |

Reproduce the comparison from the repository root with `python diagram_parser/round_3/independent_check.py`. The source-specific fixture can be regenerated with `python diagram_parser/round_3/independent_build_expectations.py`; it does not read parser outputs. Detailed expected nodes and edges are in `independent_expected.json`; complete actual-node and source-line audits are in `independent_review.json`. No generated ASCII, parsed output, parser code, or manifest was modified.
