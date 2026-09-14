# LLM ASCII tree parser

`tree_parser.py` is a Python 3.10+ standard-library parser that returns an ordered
forest, original line locations, and explicit diagnostics for recovery decisions.
It is standalone; the existing TypeScript application is not changed.

## Use

From the repository root:

```sh
python3 diagram_parser/tree_parser.py diagram_parser/original_tree.txt
python3 diagram_parser/tree_parser.py --strict diagram_parser/generated/astra_1/diagrams/domain-model.txt
python3 diagram_parser/tree_parser.py --format ascii diagram_parser/original_tree.txt
python3 -m unittest discover -s diagram_parser -p 'test_*.py' -v
python3 diagram_parser/validate_corpus.py
```

The CLI reads UTF-8 files or stdin and emits JSON by default. Multiple files produce
a JSON array. `--format ascii` renders a canonical tree. Exit status is 1 on an
input error or an empty tree; `--strict` also fails on any diagnostic, including an
inferred continuation. JSON results remain available on strict failures.

```python
from diagram_parser.tree_parser import parse_tree

tree = parse_tree("Root\n+-- Child\n|   `-- Grandchild\n`-- Other")
assert tree.nodes[2].parent_id == 1
assert tree.nodes[0].children == [1, 3]
print(tree.to_dict())
```

Nodes have `id`, `label`, `parent_id`, `children` (node IDs), `depth`, `line`,
`end_line`, `column`, `branch_column`, `raw_lines`, and `decorations`. IDs are stable preorder
array indices for a given input; duplicate labels remain distinct nodes. They are
not persistent identities across edits. Roots have `parent_id=None` and depth 0.
Lines and columns are one-based. Columns refer to normalized text after ANSI
removal and tab expansion, not terminal display widths; virtual plain-root branch
columns can be zero. The `lines` array classifies every original input line and
retains its exact text, including prose, guides, fences, and borders.

## Parsing policy

- Accepts ASCII and Unicode branches, mixed connector lengths, guides, blank
  guide rows, indentation-only trees, numbered/bulleted lists, rootless forests,
  nested unmarked headings, and multiple trees.
- Uses connector positions to find the nearest shallower ancestor, without a
  fixed indentation width. An inconsistent dedent attaches to the nearest
  shallower node and emits `irregular_dedent`.
- Accepts tabs (default width 4), CRLF, BOM, ANSI colors/hyperlinks, nonbreaking
  spaces, common invisible formatting characters, Markdown fences and consistent
  block quotes, and simple rectangular outer frames.
- Preserves label punctuation, named inline arrows, multiplicities, internal
  whitespace, and Unicode text. Paired outgoing/incoming reference wires drawn
  beside a tree are removed from semantic labels. Their original text and source
  positions remain in `decorations` and `raw_lines`; they do not become containment
  edges. Lone pipe/dash suffixes and unpaired routes are kept. Use
  `label_mode="literal"` / `--label-mode literal` for the complete label suffix.
- In `mode="auto"`, supported fenced blocks take precedence over surrounding
  text. In unfenced input, titles, notes, and unmarked text outside recognized
  tree regions are classified as prose. Detached ordinary bullet appendices after
  explicit trees are also prose by default; standalone bullet trees, indented
  lists inside a tree, and appendices using explicit ASCII branches remain nodes.
  This is extraction, not semantic proof:
  inspect `lines` when input structure is uncertain. `mode="tree"` preserves
  prose-like unmarked lines as tree nodes. `list_policy="include"` /
  `--list-policy include` retains detached bullet appendices without changing the
  rest of auto mode's prose extraction.
- `continuation="auto"` joins unmarked text aligned with the preceding label,
  including hanging labels ending in `/`, `,`, or `\`, and reports the join.
  `continuation="nodes"` preserves such lines as separate nodes;
  `continuation="join"` additionally joins indented unmarked lines.
- `strict=True` raises `TreeParseError` on any diagnostic; its `.result` contains
  the parsed data for inspection. Normal parsing returns the same diagnostics
  without raising. `max_chars` and `max_nodes` bound accepted input sizes.
- Canonical rendering gives every root an explicit connector, so standalone leaf
  roots survive subsequent automatic parsing. Traversal and rendering do not
  recurse through the hierarchy.

Ambiguous indentation cannot uniquely reveal an author's intent. Automatic prose
extraction can exclude an intended unmarked root, and an aligned plain line could
be either a child or a wrapped label. The mode and continuation options expose
these choices. Paired-wire cleanup is a conservative drawing heuristic, not full
graph reconstruction. This parser targets text trees, not arbitrary box-and-arrow graphs,
side-by-side trees, or recovery of hierarchy whose indentation was lost.

## Source context and generation

The inspected page was:

`http://127.0.0.1:5179/mapping?diagram=representation-9044402993fccf94debfaa08a438e767`

Its live catalog revision was
`representation-revision-3afa4c8b-97f4-4cc6-9af6-7e8149505da1`.
The page was inspected in headless Chrome and its tree was confirmed against
`GET /api/core/project/representations`.

`source_ranges.json` records all 16 mapped ranges across nine files, including
evidence IDs, one-based inclusive coordinates, original source lines, project
corpus identity, current source hashes, and range comparison results. Each file
was fetched through `GET /api/core/project/source?projectId=...&path=...` from the
diagram's own corpus. Six ranges still match at their saved coordinates; ten have
changed. The prompt uses the revision's immutable `originalLines`, so its source
context corresponds to the displayed diagram rather than outdated coordinates
applied to changed files.

`code_context.md` merges overlapping mapped ranges into **845 unique source
lines**, retaining the original source text and filenames/ranges. No additional
source or diagram examples were added. `generation_prompt.txt` embeds that context
in the user's exact prompt, including its original spelling.

`generate_corpus.py` launched six fresh, isolated Codex CLI agents, with no inherited
conversation and at most three running concurrently: three `gpt-5.6-sol` and three
`gpt-6-astra`, all with `model_reasoning_effort="high"`. Each received byte-identical
stdin and wrote to its own `diagram_parser/`. Outputs were copied unchanged into
`generated/<model_run>/diagrams/`. The agent could not see another generator's
output or the parser in its working directory.

`generated/receipts.json` records models, reasoning effort, prompt hashes, process
exit codes, duration, and output paths. Per-run receipts are also retained. Local
execution logs are ignored by Git. Reproduction requires an authenticated `codex`
CLI; `python3 diagram_parser/generate_corpus.py` refuses to overwrite existing runs.
Separate working directories do not prevent a generator from reading files at
other paths. The optional `--blind` flag uses bubblewrap to hide other workspaces
and transcripts and disables shell, subagent, and web tools. If that environment
cannot write a file, the runner can save exact diagram fences from the model's
final response and records that delivery method in the receipt. No diagram text
is rewritten during capture.

## Validation

All six original generated files pass strict parsing with **762 nodes, 746 edges,
and zero diagnostics** under the archived round-1 interpretation
(`list_policy="include"`). The current automatic policy excludes Sol 3's seven
detached prose bullets; the compatibility check intentionally retains them.
`corpus_expected.json` records every expected label and parent source
line, using reviewed tree boundaries and the generators' four-column layouts. It
was assembled independently of `tree_parser.py`; tests compare every node/edge and
verify input hashes so changing a generated diagram cannot make a test pass.

| Generator | Nodes | Edges | Roots |
| --- | ---: | ---: | ---: |
| Sol 1 | 148 | 146 | 2 |
| Sol 2 | 125 | 123 | 2 |
| Sol 3 | 128 | 119 | 9 |
| Astra 1 | 110 | 109 | 1 |
| Astra 2 | 133 | 132 | 1 |
| Astra 3 | 118 | 117 | 1 |

Sol 3 contains a separate seven-item bullet list; each bullet is a forest root.
Sol 1 and Sol 2 each contain two explicit trees. Introductory titles and trailing
notes are excluded where appropriate and retained in line accounting.

The original diagram has 125 nodes under `MappingScreen`. Its status label spans
lines 50–51; joining those lines produces one informational diagnostic, as intended.

The test suite additionally checks 2,000 deterministic randomized trees against
known models generated before rendering. Variations include connector families,
widths, indentation, guide rows, margins, ANSI, fences, quotes, and newline styles.
It also checks canonical round trips, duplicate labels, source line accounting,
CLI behavior, ambiguous wraps, malformed fences, bounds, and a 1,100-level tree.

The generated examples initially exposed incorrect treatment of preambles,
trailing notes, and detached bullet lists. Full-edge and round-trip checks also
caught standalone roots being lost during canonical rendering. These were fixed
without editing the generated inputs.

`validate_corpus.py` writes the seven parsed JSON artifacts to `parsed/` and updates
`validation_report.json`. These results demonstrate the tested coverage, **not a
measured 99.99% success rate** on arbitrary LLM output. Establishing that rate would
require a much larger representative corpus with independently checked structures.

## Additional evaluation rounds

[Round 2](round_2/README.md) ran six new generators against the unchanged parser,
then used a separate subagent to compare the ASCII originals with every parsed
node and edge. Clean-label review found **1 failure, 4 passes, and 1 ambiguous
prose-list case**. There were no exceptions or diagnostics, and the unambiguous
hierarchy was correct. The failure was 14 labels retaining routed wire fragments;
literal branch-suffix preservation instead yields 0 confirmed failures, 5 passes,
and 1 ambiguity. Both rubrics and exact line evidence are recorded in that report.

`generate_corpus.py --output-dir <new-directory-under-diagram_parser>` supports
additional rounds without overwriting earlier inputs. `capture_round.py` loads a
round's frozen parser and manifest, records raw outputs and hashes, and leaves
semantic correctness for independent review.

The parser has since been fixed and refactored for round 3. Its stages now handle
text extraction, prose-list classification, paired-wire cleanup, and iterative
hierarchy construction separately. All **32 tests** pass, including exact comparison
with the independent round-2 oracle, preservation of literal labels, and explicit
bullet-list policies. [Prior-round regression results](round_3/prior_round_regression.json)
record all six previous diagrams passing the clean-label interpretation. The
original round-2 baseline and its failure report remain unchanged.

[Round 3 results](round_3/README.md): the new independent evaluation found **5
passes and 1 failure**. The failure combines overlapping trees with downward
routing arrows and workflow branches. All six prior-round cases are fixed, but
this new hybrid-layout case remains unsupported by the tree-only API. One contaminated generation was
excluded before parsing and replaced; the report preserves the full provenance.

## Graphs containing trees and text

`graph_parser.py` adds `parse_graph(text)` without changing `tree_parser.py` or the
archived evaluation results. It separates positioned labels and local tree regions,
calls `parse_tree` for each hierarchy, and then traces reference connectors. A graph
node is either a local tree or a text region. Consecutive unconnected text lines at
the same column form a multiline text region. Repeated labels remain distinct
occurrences; a reference to a printed `Project` does not automatically resolve to
another tree named `Project` elsewhere in the drawing.

```python
from diagram_parser.graph_parser import parse_graph

result = parse_graph(source)
result.nodes          # tree/text regions, original spans, and parsed local trees
result.references     # source/target region IDs and optional internal tree node IDs
result.repairs        # original and cleaned columns for each moved item
result.diagnostics    # unresolved arrows, incomplete routes, blocked repairs
result.cleaned_ascii  # complete drawing with tree/wire alignment repairs
result.original_ascii # exact input
```

```sh
python3 diagram_parser/graph_parser.py diagram_parser/fixtures/mapping_graph.txt \
  --cleaned-output /tmp/mapping.cleaned.txt > /tmp/mapping.graph.json
python3 diagram_parser/graph_parser.py diagram_parser/fixtures/misaligned_neighbor.txt --format ascii
python3 diagram_parser/graph_parser.py diagram_parser/fixtures/workbench_renderer.txt --nodes
python3 -m unittest discover -s diagram_parser -p 'test_*.py'
```

`--nodes` prints a numbered list of every tree item and text node in source order,
including duplicate label occurrences. Each tree item includes its own subtree,
with descendants indented beneath it; leaves print just their label. Descendants
also receive their own numbered entries. It overrides `--format`; multiline
labels use literal `\n` separators.

The regular graph dialect uses tree joints (`|--`, `+--`, backtick/backslash
elbows, and common Unicode tree joints) for containment and headed wires (`-->`,
`<--`, `v`, `^`) for references. A routed wire may turn/join at `+`.
At `-|-`, the horizontal wire passes across the vertical wire without joining it.
A head aimed
at a neighboring tree's branch/guide addresses that tree region; a head aimed at
a label addresses that tree item. A root item's endpoint is represented by the
region ID alone. A shared bus connects its sources to each explicit arrowhead;
separate arrowheads remain separate reference records, even if their endpoints
match. Shared sources are called out in an informational diagnostic.

Neighboring labels require **at least three spaces**, except where a reference
connector itself separates them. One or two internal spaces are preserved.
Balanced brackets, braces, and parentheses protect embedded arrows and spacing,
so `[id -> record]` remains label text. Bare dashes inside a label remain text.
An underline is drawing metadata; its heading remains a tree root when directly
followed by branches. These are explicit input conventions, not a claim that
arbitrary prose spacing is unambiguous.

Cleanup preserves the layout and spelling, including truncated labels. By
default it clusters branch drift within one column (`tree_tolerance`) and traces
vertical drift within two columns per row (`wire_tolerance`). Explicit ancestor
guides protect narrow nesting from being flattened. Set `tree_tolerance=0` for
intentional narrow, unguided indentation. Each vertical run is moved together,
including its corners, with horizontal segments extended as needed. Repairs do
not cross text or another wire. Tree roots close to their first branch column
are aligned with that column, and incoming arrows retain a gap before a branch.
Source span columns remain original; `cleaned_column`/`cleaned_branch_column` and
local parsed-tree coordinates describe the cleaned placement. Coordinates are
one-based after tab expansion. Reference wire cells use cleaned coordinates.

Missing heads, missing sources, tied targets, and blocked repairs produce
diagnostics instead of invented links. `strict=True` raises `GraphParseError`
for warnings/errors (the partial result is available on the exception);
`--strict` returns a nonzero exit status while still emitting the result.
Informational shared-bus diagnostics do not fail strict mode. Unknown framing,
unmarked workflow sources, and unrestricted connector styles are outside this
initial graph dialect. This does not establish the original 99.99% reliability
target on arbitrary LLM drawings.

The supplied examples are saved in `fixtures/`, alongside their cleaned output
and parsed JSON. `mapping_graph.txt` preserves the first 60 lines of round 3's
Sol 1 drawing. The added `Expand Here` annotation is tested separately using a
headed connector, as agreed. `misaligned_neighbor.txt` preserves the latest
six-line snippet exactly, including its orphan arrow and `mappin` truncation.
The larger example produces three trees and five text regions. Its row-26
`scene` route has no continuation/head and remains a warning. The short snippet
has an arrow without a source; its `contents` reference still resolves correctly
to the neighboring `GridContent` tree.

Graph tests check known containment and reference relationships, cleanup
idempotence, graph equivalence after cleanup, colliding repairs, parallel wires,
arrow directions, labels, and limits. A Sol-high subagent independently reviewed
the implementation and added adversarial tests in `test_graph_review.py`.
Findings and their resolution are recorded in `graph_review.md`.

### Workbench renderer example

`fixtures/workbench_renderer.txt` preserves the supplied 80-line drawing;
`workbench_renderer.cleaned.txt` and `workbench_renderer.parsed.json` contain the
cleaned drawing and graph. The result has **61 tree items in two tree regions,
two distinct `skip editor` text targets, and seven references**, with no
diagnostics. `TextModel` starts an unmarked local tree; the explicit outer branch
for `EditorRenderingCoordinator` resumes the `Workbench renderer` tree.

This example added support for nonjoining wire crossings, a crowded label next
to vertical wires, and parallel wire bundles drifting together. Bundle matching
preserves left-to-right order, maximizes continued tracks, and minimizes total
drift; ties remain unresolved. Existing crossing cells may move along their
horizontal wire while retaining separate horizontal and vertical connectivity.
An outer-tree dedent closes a later embedded region without closing earlier
parallel trees. A nearby vertical pipe does not create a lateral reference from
label text.

`test_workbench_graph.py` checks every parent against a manually transcribed
source-line oracle and all seven expected references. Cleanup makes 59 recorded
wire alignment repairs. Parsing the cleaned drawing preserves the graph and
requires no further repairs. The complete suite now has **52 passing tests**;
the earlier Sol review remains a record of the preceding implementation.
