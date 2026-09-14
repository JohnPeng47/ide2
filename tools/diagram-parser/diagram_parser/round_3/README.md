# Round 3 — fixes, cleanup, and another independent evaluation

**New round: 5 of 6 passed; 1 of 6 failed semantic parsing.** There were no
parser exceptions. Two diagrams fail strict mode: Sol 1 has genuine layout
problems; Astra 3 has a correctly joined wrapped label and an informational
diagnostic. The independent reviewer audited 803 parsed nodes, 770 edges,
33 roots, and all 905 original source lines.

## Fixes completed before this round

- Paired routing wires are removed from semantic labels, including the 14 bad
  labels found in round 2. Removed text and positions remain in `decorations`.
  `label_mode="literal"` restores literal suffix preservation.
- Automatic extraction excludes detached ordinary prose bullet appendices after
  explicit trees. Standalone bullet trees, nested lists, and explicit ASCII
  appendix trees remain supported. `list_policy="include"` or `mode="tree"`
  selects inclusion deliberately.
- The parser now separates text preparation, list classification, wire cleanup,
  and iterative hierarchy construction. Line accounting is recorded directly
  during parsing rather than filled in afterward.

All 32 tests passed before freezing, including 2,000 known-answer randomized
cases, exact comparison with the independent round-2 clean-label oracle, literal
compatibility checks, and the original corpus. All six prior-round diagrams pass
the corrected interpretation; see [prior_round_regression.json](prior_round_regression.json).

## New results

| Generator | Semantic verdict | Nodes | Edges | Strict diagnostics |
| --- | --- | ---: | ---: | --- |
| Sol 1 | Fail | 172 | 160 | 6 |
| Sol 2 | Pass | 110 | 106 | 0 |
| Sol 3 | Pass | 169 | 167 | 0 |
| Astra 1 | Pass | 123 | 116 | 0 |
| Astra 2 | Pass | 118 | 111 | 0 |
| Astra 3 | Pass | 111 | 110 | 1, correct wrapped-label join |

Sol 1 mixes overlapping trees with downward `v` arrows, separately drawn
reference targets, and workflow branches. The parser creates nodes from routing
glyphs, combines adjacent labels, retains some routing graphics, and assigns
incorrect parents to the separate GridContent tree and workflow roots. These are
new failures, recorded against the frozen parser rather than hidden by editing
the input or changing the parser during evaluation.

Three source-intent regions in two diagrams have multiple plausible readings.
The reviewer declared alternatives before reading parser output. Sol 1 fails
under every alternative, and Sol 3 passes a predeclared heading-as-root reading;
none prevents a definite diagram-level verdict. Exact lines, expected labels and
parents, and the source-intent caveats are in the [independent review](independent_review.md)
and [JSON report](independent_review.json).

## Generation and provenance

The six accepted diagrams came from three `gpt-5.6-sol` and three `gpt-6-astra`
generations at high reasoning effort with the same exact prompt and source
context as earlier rounds. [manifest.json](manifest.json) pins parser options,
source prompt hashes, and the pre-generation parser snapshot.

There were seven model generations to obtain six accepted samples. One original
Sol 2 run read previous diagrams outside its temporary workspace. It was excluded
before parsing and retained under `excluded/`. Its replacement used filesystem
isolation to hide other workspaces/transcripts and disabled read-capable tools.
The isolated file-writing helper was unavailable, so the replacement's exact
final-response ASCII fence was saved verbatim. Its full final response and both
execution/delivery receipts remain under `blind_replacement/sol_2/`. A separate
isolation setup failure occurred before any model session and is also recorded.
See [generation_exclusions.json](generation_exclusions.json).

The accepted six-file manifest is [parse_summary.json](parse_summary.json), with
generation receipts in [generated/receipts.json](generated/receipts.json). Its
source/output hashes were checked after independent review. Previous-round
artifacts, this round's inputs, and the frozen parser were not modified to improve
the evaluation result.

Reproduce the independent comparison:

```sh
python3 diagram_parser/round_3/independent_check.py
```

The one newly failing hybrid-layout diagram remains a known limitation for the
next iteration. This six-diagram evaluation does not establish 99.99% reliability.
