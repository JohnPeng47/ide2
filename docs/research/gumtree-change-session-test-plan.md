# Proposed tests for ChangeSession content-tree matching

Status: matcher-scoped implementation and regression coverage added. This remains the broader test matrix, including separate parser/adapter follow-ups.

Implemented suites: `diagramContentDiff.test.ts`, `diagramNodeMatcher.test.ts`, and `diagramContentDiffCompatibility.test.ts` under `domain/mapping/changes/__tests__`; session history/provenance coverage in `infrastructure/mapping/changes/__tests__/changeSessions.test.ts`; wrapper rendering in `tests/browser/mapping/browser-change-sessions-check.mjs`; and bounded-size performance fixtures in `tests/performance/diagram-content-diff.mjs`.

Scope explicitly excludes fixing C14/C15 (text/node transitions), C16's node-level quote coordinates (raw-line fallback is tested), and C19 (partial row coverage). The parser/content model is unchanged. The wider parsing matrix below remains useful follow-up coverage rather than a claim that every item is now a matcher regression test.

## Test structure

Test the application contract through `buildDiagramContent`, `diagramContentNodes`, `patchDiagram`, and `diffDiagramContent`. Generic interpreter tests are supporting coverage, not substitutes: the application selects narrower parser policies than `parseDiagram` defaults.

Every ASCII fixture has two independently reviewed expectations:

1. Parsed model: exact labels, original line/column spans, roots, parent relationships, ordered children, and relevant fold ranges.
2. Diff: expected correspondences, statuses on both sides, moved flags, ancestor indicators, loose-line changes, and aggregate counts.

Address nodes in expectations by `(line, startColumn)` within each snapshot, resolving those occurrences to revision-scoped IDs. Do not use `.find(n => n.label === label)` for duplicates or snapshot IDs containing revision/hash values. Use distinct expected occurrence keys such as `before:leftSame` and `after:rightSame`; these are test identities, not labels supplied to the matcher.

After extracting the matcher, assert forward/reverse maps directly as well as the public decorations. Count-only assertions can pass while the wrong same-label occurrence is highlighted. Freeze inputs, then verify that content, child arrays, provenance, and anchors remain unchanged.

Keep currently passing regression tests. Add missing cases rather than duplicating every parser test. Mark current bugs separately from intentional compatibility behavior; do not approve current output merely by updating snapshots.

## Observed parser traps

These were checked against the current code while preparing this proposal:

| Input | Application model today | Test implication |
| --- | --- | --- |
| `Root` in tree mode | No structural nodes; Root is loose text. | Adding the first child changes how unchanged Root is represented. |
| `Root\n\x60-- Leaf` in tree mode (`\x60` means backtick) | Root and Leaf are structural nodes. | Current diff reports 2 added + 1 removed against bare Root; desired review is only Leaf added. This needs text/node reconciliation, not just GumTree. |
| `Root\n+--> Leaf` in tree mode | Root is prose; Leaf is a structural root. | A headed branch is not interchangeable with an unheaded branch under the compatibility grammar. |
| `Root\n\x20\x20Child` in tree mode | Neither line becomes a structural node. | Do not use generic interpreter indentation-only trees as application fixtures without checking their output. |
| `placement    automatic \| manual` in a tree branch | One full label. | Spacing inside a label can be a text edit. |
| Same row in diagram mode | Separate placement and annotation nodes. | One raw line can own several independently diffable occurrences. |
| `> Root\n> \x60-- Leaf` | Quote wrapper is stripped during parsing, but returned columns do not address those labels in the original raw lines. | Current diff filters these nodes out and falls back to whole-line text. Never highlight the wrong span; fix the adapter if node-level quoted content is supported. |
| `First note\nSecond note` in diagram mode | One multiline node label with only the first span exposed by the adapter. | Current structural filter rejects it; every line still needs text coverage. |
| `Root\n\|-- A\n\x60-- B`, parser v1 vs v2 | v1 indexes only B; v2 indexes Root, A, and B. | Preserve compatibility mode; never silently reparse v1 as v2. |

## A. Structural correspondence: release-blocking cases

| ID | Fixture/edit | Required result |
| --- | --- | --- |
| A01 | Identical ASCII with new revision ID/hash-derived node IDs | No changes. IDs are not cross-version identity. |
| A02 | Insert/delete an unrelated preceding sibling | Only inserted/deleted node changes; shifted lines do not become moves. |
| A03 | Insert a wrapper around one existing subtree | Wrapper added; subtree root moved; deeper descendants unchanged. Preserve the exact old Root. |
| A04 | Insert wrapper + rename existing parent + add a description child | The screenshot regression: wrapper/description added; existing parent modified and moved; unchanged descendants remain unchanged. |
| A05 | Remove wrapper | Wrapper removed; surviving subtree root moved; descendants unchanged. |
| A06 | Insert two nested wrappers or wrap only some siblings | Only new wrappers added; mark just the existing nodes whose immediate parents change as moved. |
| A07 | Move subtree from A to B while A/B remain | A and B retain identity; subtree root moved, its leaf unchanged. Never rename A to B. |
| A08 | Move and rename subtree root; edit one descendant | Root can be modified and moved simultaneously; changed descendant modified; remaining descendants unchanged. |
| A09 | Reorder siblings, with an insertion before them | Preserve matches; LIS detects actual reordering, not index shifts. Use a fixture with a unique stable subsequence for exact moved-node assertions. |
| A10 | Rename visible root with surviving children | Root modified, children unchanged; synthetic forest root never appears in output/counts. |
| A11 | Multiple roots; add/remove/reorder/move a branch between roots | Respect the parsed forest and preserve unchanged root identities. |
| A12 | Leaf gains children / parent loses its last child | Matched node stays the same node. Do not use leaf/container status as an incompatible type. |
| A13 | New/removed whole diagram, including a prose-only diagram | Mark actual content on the appropriate side; no synthetic-root count. |
| A14 | Controller demo replacement | Preserve existing expected added/removed labels; old bridge/transact nodes must not be renamed to unrelated new session nodes. |

## B. Label changes and ambiguous identity

| ID | Fixture/edit | Required result |
| --- | --- | --- |
| B01 | One label replacement between established sibling anchors | Retain existing single-replacement modification behavior. |
| B02 | placement and sizing both change spacing/punctuation | Two modifications; each matches its distinctive corresponding field. |
| B03 | Several similar field labels, insertion in the middle, and two edits | Alignment respects accepted anchors and does not shift all later pairings. |
| B04 | A/B become unrelated X/Y | Two removals + two additions under the existing ambiguity policy. Shape/order alone is insufficient. |
| B05 | Similar labels in different parents, e.g. requestId/sessionId/sourceId | Never steal an established match or pick a weak global text similarity over structural context. |
| B06 | Two equal Same siblings remain while another label changes | Repeated group stays unchanged under its matched parent. |
| B07 | Two equal Same siblings become one, without provenance | Preserve current conservative policy: two removals + one addition. |
| B08 | Same deletion with exact patch provenance identifying the survivor | Exactly one removal; assert the specific surviving occurrence. |
| B09 | Same labels under different parents, one edited | Parent context disambiguates the modification; other branch unchanged. |
| B10 | Repeated subtree roots with distinct descendants | Match by descendants without swapping identities due to position changes. |
| B11 | Identical subtrees copied into a new location | With provenance, existing occurrence survives and copied occurrence is added. Without disambiguating evidence, do not invent a move or map two new nodes to one old node. |
| B12 | Two edited parent candidates have equal descendant evidence | Leave unresolved unless label/context supplies a clear winner. Deterministic does not mean correct. |
| B13 | Wrapper competes with surviving renamed child for the same anchors | Match surviving child when evidence distinguishes it; do not automatically choose largest subtree or closest ancestor. |
| B14 | One old node split into two, or two merged into one | Mapping remains one-to-one. Match a clear surviving occurrence if present; otherwise use conservative additions/removals. |
| B15 | Labels differ only in case, internal whitespace, or punctuation | If paired, preserve raw difference as modified; normalization used for matching must not erase visible edits. |
| B16 | Trailing spaces change but parser trims the label | Assert current node-label contract: no fabricated label modification. Raw-formatting diff is separate; do not silently broaden this change. |
| B17 | Strings that resemble dictionary keys: constructor, prototype, __proto__ | Valid labels remain ordinary labels; matcher lookup keys do not affect maps or objects. |

## C. Parser and content-model integration

For appropriate cases run separately under tree v2, saved tree v1, and unstructured diagram/mixed mode. Declare different expected models when grammars differ; never assert blanket equivalence across modes.

| ID | Input variation | Required result |
| --- | --- | --- |
| C01 | Supported unheaded markers +--, backtick--, backslash--, and v2 pipe-- | Equivalent parsed topology yields equivalent matching; connector glyph changes alone do not add/remove nodes. Test v1 pipe-- separately. |
| C02 | Headed +--> vs unheaded +-- | Assert title/root changes in parser output first; matcher cannot assume this is formatting-only. Mixed-mode ambiguity must not become invented containment. |
| C03 | Extra spaces after a branch marker | Correct original start/end columns; label remains unchanged when only its position shifts. |
| C04 | Internal spacing: two spaces vs three or more | Tree mode retains text; mixed mode may split columns. No accidental same-row node loss or cross-column highlighting. |
| C05 | Blank/connector-only lines before, within, and after a tree | No spurious content nodes or move counts; fold ranges and subsequent source lines remain correct. |
| C06 | Consecutive independent trees and a prose heading | Correct root set, no parent leakage into the next tree, no forced match to a synthetic/visible root. |
| C07 | Side-by-side trees in diagram mode; edit only the right column | Match by occurrence including startColumn; only the right label changes. Tree mode deliberately has a different model. |
| C08 | Same label twice on the same row in diagram mode | Distinct IDs/spans; no line-only or label-only deduplication. |
| C09 | Unmarked continuation below a branch | App adapters use continuation: separate. Assert actual node/prose representation; do not merge lines because the generic parser defaults do. |
| C10 | Multiline prose node from mixed mode | If not representable as a valid single-line content node, fallback covers every changed raw line exactly once. No invented first-line span for the whole label. |
| C11 | Inline `->`, `\|`, `---`, and balanced [], {}, () in labels | Preserve literal tree labels and protected mixed-mode text; do not turn words into containment edges. |
| C12 | Unbalanced bracket followed by arrow-like text | Conservative parser output is preserved; matcher does not repair the missing delimiter or infer missing nodes. |
| C13 | Malformed branch, missing space/label, abruptly dedented child, truncated connector | Assert partial model and raw fallback coverage; no crashes, invented ancestry, or highlighting outside valid text. |
| C14 | Plain Root gains first child / loses last child | Unchanged Root must not be counted as deleted+added just because it switches between loose text and structural node. This is a known additional integration gap. |
| C15 | Same text changes from parsed label to prose or vice versa | Reconcile only clear same-text occurrences with supporting context; do not double count or globally pair ambiguous prose occurrences. |
| C16 | Quoted drawing (`> ` prefix on every line) | Highlight valid original spans or deliberately use raw-line fallback. No normalized-column slices over raw prefixes. Node-level support requires an adapter fix. |
| C17 | Separate supported fences, excluded code fence, and prose outside | Never connect roots across blocks; excluded content remains eligible for the appropriate raw-text review. Preserve original line numbers. |
| C18 | Closed ASCII frame vs an incomplete frame | Respect actual parser wrapper recognition; frame edges do not become ancestors. No wrong spans after wrapper normalization. |
| C19 | One invalid/filtered node span on a row that also has a valid node | Do not silently lose the changed text just because another node occupies that row. Current row-level loose-text coverage needs explicit scrutiny here. |
| C20 | Tree parser v1 vs v2 with identical ASCII | Assert their different model expectations; preserve existing empty visual diff for identical ASCII. Parser metadata migration is a separate concern. |
| C21 | Change only a graph reference wire | No fabricated content-node rename/reparent. Content-tree matching does not compare reference topology; connection/wire visualization is separate scope. |
| C22 | Indentation-only content | Use application output, not generic tree-parser output. It must remain reviewable even when the adapter indexes no tree nodes. |

## D. Provenance, persistence, and boundaries

| ID | Case | Required result |
| --- | --- | --- |
| D01 | Patch inserts lines above an untouched label | Provenance identifies the shifted node; no move from line-number change. |
| D02 | Whole-subtree patch adds indentation or rewrites identical labels | Missing exact provenance does not imply addition; infer correspondence without writing it into provenance. |
| D03 | Successive patches, undo, redo, reset, and exact revert | Always compare with session baseline; restore expected provenance; exact revert clears all decorations/counts. |
| D04 | Same final ASCII via different patch histories | Unambiguous content produces the same diff. Duplicate occurrences may differ only where valid provenance supplies additional evidence. |
| D05 | Stale/missing provenance IDs, mismatched label, or conflicting origins | Ignore invalid hints; enforce a bijection; no crash or overwrite of an accepted valid mapping. |
| D06 | Same labels/IDs in independent diagram instances/documents | Scope matching to each before/after diagram pair; no cross-diagram highlight or provenance leakage. |
| D07 | Shared content displayed by multiple GridBoxes | Each display instance shows the correct scoped decorations; preserve existing per-display counting semantics. |
| D08 | Folded changed subtree, deleted child, moved child, and changed folded prose | Parent receives containsChanges on appropriate sides without becoming modified; unfolding reveals exact changes. |
| D09 | Last-character and one-character labels at line ends | Respect 1-based inclusive content-node endColumn vs exclusive interpreter span endColumn; no off-by-one highlight. |
| D10 | Empty/whitespace-only input; tabs, Unicode branches, ANSI/control chars; over 20,000 characters | Application builder rejects invalid input. Do not add unsupported formats merely because generic parser tests accept them. |
| D11 | CRLF/CR in patch text and patch trailing newline | patchDiagram normalizes line endings; trailing blank line is preserved; invalid ranges/deleting the entire content remain rejected. Direct builder's stricter input contract stays distinct. |

## E. Invariants and generated cases

Use a seeded generator with stable test-only identities, render supported ASCII, and verify the parsed topology against the generated model before testing the diff. Restrict expected exact identity to unique-label or provenance-backed edits; do not require an algorithm to recover an unknowable random edit history.

- Generate insertion, deletion, supported wrapper insertion/removal, subtree movement, and context-supported renames, singly and in combinations.
- Assert forward/reverse correspondence is a bijection and references only actual indexed nodes.
- Assert valid node spans reproduce the exact raw label; unsupported/multispan material has explicit fallback coverage rather than disappearing.
- Assert roots/parent/child relationships are acyclic and reciprocal in valid input models; matching must not create or mutate tree relationships.
- Repeat with new revision IDs and new objects: decoration by occurrence is stable, and caches do not leak across contents.
- Reorder the storage object's keys while retaining explicit child order: traversal/storage insertion order must not decide ambiguous identity. Either the adapter canonicalizes source order or the matcher does.
- Repeat each run: same input/provenance gives the same result. Where two minimum reorder explanations exist, assert valid deterministic behavior, not an arbitrarily assumed unique moved node.
- Check reverse-direction status inversion on unambiguous insertion/deletion/modification fixtures. Do not impose full symmetry on ambiguous heuristic matches or direction-specific provenance.
- Counts agree with node/loose-text classifications; moved+modified is one in each applicable category, and containsChanges alone contributes no count.
- Inputs remain immutable; inferred matches never rebase real connection/source anchors or change nodeOrigins.

## F. Performance and UI acceptance

Benchmark wide sibling lists, deep chains, repeated labels/subtrees, nearly identical long labels, and mostly unrelated replacements within the real 20,000-character app limit. The generic parser's 700-level test exceeds that size and should not be copied blindly into the application suite.

For the proposed local-alignment limits, exercise 63/64/65 nodes per side and cell-budget boundaries. Crossing a work bound may leave uncertain pairs unmatched; it must preserve established anchors and never partially corrupt a result. Record deterministic work/size bounds in unit tests and timings in a separate benchmark rather than fragile millisecond assertions in CI.

Keep browser coverage focused on rendering contracts: modified+moved node styling, exact same-row label boundaries, quoted/raw fallback, folded ancestor indicators, Original/Proposed switching, and live refresh after undo/revert. Use disposable data. Full parser coverage belongs in domain tests, not dozens of browser scenarios.

## Implementation sequence for tests

1. Add fixture helpers that assert both parsed model and diff, addressing occurrences by coordinates.
2. Lock down A03/A04/A07, B02/B04/B07/B08/B14, C07/C14/C16/C19, and D09 first. These distinguish real matching improvements from parser/adapter mistakes.
3. Add remaining parser-adapter characterizations and regression pairs, maintaining the existing controller, provenance, and cumulative-edit coverage.
4. Add generated invariants and bounded-work checks as the matcher is extracted.
5. Run the small browser acceptance set once the domain behavior is stable.

Keep expected-failure cases explicit during test-first work; do not permanently skip them or change conservative duplicate/replacement expectations just to make an upstream algorithm pass. Parser representation transitions and raw-coordinate normalization are separate known gaps and should be resolved or explicitly scoped before claiming the new matcher covers the full matrix.
