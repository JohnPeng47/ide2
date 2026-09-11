# Round 2 — independent baseline review

Six new generations used the unchanged source context and exact prompt from round 1:
three `gpt-5.6-sol` and three `gpt-6-astra`, all at high reasoning effort.
The parser was frozen before generation and was not fixed during this round.

**Clean semantic-label extraction: 1 of 6 failed, 4 passed, 1 was ambiguous.**
There were **0 parser exceptions and 0 strict-diagnostic failures**.
All unambiguous tree parent-child relationships were correct.

| Generator | Verdict | Finding |
| --- | --- | --- |
| Sol 1 | Ambiguous | Lines 137 and 140–145 form an invariants heading and prose bullets. The parser includes them as a second tree with seven nodes. Including a bulleted outline or excluding explanatory prose are both plausible. |
| Sol 2 | Pass | Labels and tree structure match. |
| Sol 3 | Fail for clean labels | Fourteen labels retain pieces of routed reference wires. For example, line 16 becomes `currentRevisionId -----------------------+` instead of `currentRevisionId`; line 37 includes a trailing pipe after `DiagramGridBox`. Tree hierarchy is correct. |
| Astra 1 | Pass | Labels and tree structure match. |
| Astra 2 | Pass | Labels and tree structure match. |
| Astra 3 | Pass | Labels and tree structure match. |

The definition of a label matters here. If labels intentionally include **all
literal text after a branch connector**, the wire case passes: that rubric gives
**0 confirmed failures, 5 passes, and 1 ambiguity**. Accepting the prose bullet
outline as an additional tree resolves the remaining case to a literal-parsing
pass. The stricter clean-label result above is retained so a zero-diagnostic parse
is not mistaken for perfect domain-label extraction.

The six captured outputs contain 716 nodes and 704 edges across 797 source lines.
The independent reviewer checked all nodes, edges, roots, ordering, depths, source
locations, and excluded lines. It did not read or invoke the parser implementation
to derive expected results. No generated input was edited to make it pass.

Evidence:

- [Independent review](independent_review.md) and [machine-readable verdicts](independent_review.json).
- [Independent expected structures](independent_expected.json),
  [checker](independent_check.py), and [check results](independent_check_results.json).
- [Frozen parser and prompt hashes](manifest.json), [parser snapshot](tree_parser_snapshot.py),
  [generation receipts](generated/receipts.json), and [parse summary](parse_summary.json).
- Original diagrams in `generated/*/diagrams/`; untouched parser output and
  line-oriented review tables in `parsed/`.

Re-run the independent comparison with:

```sh
python3 diagram_parser/round_2/independent_check.py
```

These are six held-out examples, not a population reliability estimate. This round
records failure modes; the production parser remains unchanged.
