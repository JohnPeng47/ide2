# Diagram interpreter

`parseDiagram(text, options)` is a TypeScript implementation shared by browser
and server. It has no Python dependency. It interprets positioned text as local
trees and directed reference networks, preserving the original drawing and
recording unresolved interpretations instead of choosing by recognizer order.

```ts
import { parseDiagram, explainNode, renderCleaned } from './interpreter';

const diagram = parseDiagram(source, { dialect: 'graph' });
diagram.nodes;        // Label occurrences, original spans, parent/child IDs
diagram.edges;        // Separate contains and references relationships
diagram.regions;      // Local trees and text regions
diagram.unresolved;   // Competing interpretations and incomplete connectors
diagram.repairs;      // Accepted changes to logical geometry, with reasons
diagram.decisions;    // Evidence, recognizer IDs, and repair dependencies
diagram.lines;        // Accounting for every input line

explainNode(diagram, diagram.nodes[0].id);
const preview = renderCleaned(diagram);
preview.text;         // Optional normalized, aligned drawing
preview.sourceMap;    // Original offset range for each output UTF-16 unit
preview.diagnostics; // Rendering collisions; original geometry wins on failure
```

## Interpretation choices

- `tree` treats branch markers as containment. Labels retain inline arrows and
  internal spacing. Plain roots, indentation-only trees, lists, and configured
  continuations are supported.
- `graph` recognizes marked containment branches, neighboring regions, and
  headed references. Labels on the same row need three separating spaces unless
  a reference connector separates them. Balanced `[]`, `{}`, and `()` protect
  internal arrows and spaces. Two spaces inside a label remain text.
- `mixed` (the default) and `unknown` retain branch/reference ambiguity for a
  marker such as `+-->`. They do not silently pick a dialect. They currently use
  the same conservative structural policy.

Graph containment uses jointed markers such as `+--`, `|--`, and `└──`.
References use horizontal runs ending in arrowheads or corners, plus connected
vertical strokes and `v`, `^`, `↓`, or `↑`. A `+` joins wire channels; a `-|-`
crossing keeps horizontal and vertical channels separate. Joined buses connect
each source to each resolved head and report that interpretation. A head aimed
at a tree branch addresses the tree region. Equal target candidates stay
unresolved. A printed name never implicitly links to a matching name elsewhere.

Graph `treeTolerance` defaults to one column. A uniquely dominant column may
repair a nearby branch, unless an explicit ancestor guide establishes nesting.
Equal evidence for nesting and drift leaves the disputed parent unresolved.
Explicit tree mode follows drawn indentation without graph alignment repairs.
`wireTolerance` defaults to two columns. Whole wire bundles are matched in
left-to-right order, maximizing continued tracks and then minimizing drift.
Only pairs present in every optimal matching are connected. Repairs that cross
text or another wire are blocked. `repairs: 'none'` uses original geometry.

`continuation: 'auto' | 'join' | 'separate'` controls tree-label wrapping.
`detachedLists: 'auto' | 'include'` controls prose bullet appendices.
The app's `asciiTree.ts` adapter selects `ascii-tree-2`, which preserves the
arrow-tree heading conventions and additionally recognizes `|--` branches.
Saved `ascii-tree-1` structures retain their original grammar during validation. The stored
tree contract therefore remains unchanged; the full graph API is separately
available to consumers. This change does not add graph-navigation UI or change
the app's printable-ASCII input validation.

## Stage contracts

1. `source.ts`: retain immutable original text, normalize formatting, and map
   every normalized column to its original offset range. Fence/block boundaries
   stop structural inference from crossing unrelated code blocks.
2. `recognizers.ts`: dispatch independent, read-only recognizers by glyph family
   or literal character. Return positioned candidates, including overlaps.
3. `layout.ts`: apply explicit connector conventions before separating labels
   and wires. Competing recognizers with different boundaries stay unresolved.
4. `trees.ts`: establish local regions, interpret ancestry and continuations,
   and evaluate branch-alignment proposals.
5. `wires.ts`: maintain independent crossing channels, evaluate ordered track
   matches and collision constraints, then resolve reference endpoints.
6. `render.ts`: render accepted repairs transactionally as an optional preview.
   Rendering never mutates input or determines the semantic result.

The semantic model always references original positions. Repairs describe
separate logical positions. Public line/column numbers start at one; range ends
are exclusive. Original offsets and normalized columns use UTF-16 units, matching
JavaScript string indexing, **not terminal display widths**. Tabs expand before
consistent quote wrappers are removed. Occurrence IDs are deterministic for the
same positions; they are not persistent identities across edits.

## Adding syntax

An equivalent glyph can be registered as data:

```ts
parseDiagram('A ~~~> B', {
  dialect: 'graph',
  glyphs: { '~': 'horizontal' }
});
```

A new shape uses a recognizer with a unique ID and explicit start features:

```ts
import type { Recognizer } from './interpreter';

const customBranch: Recognizer = {
  id: 'double-at-branch',
  starts: ['@'],
  recognize({ row, column }) {
    return row.text.startsWith('@@ ', column - 1)
      ? [{ kind: 'branch', endColumn: column + 2 }]
      : [];
  }
};

parseDiagram('Root\n@@ Child', {
  dialect: 'tree', recognizers: [customBranch]
});
```

All applicable recognizers run against the same immutable source. Registration
order does not define precedence. Duplicate IDs and invalid candidate bounds
are errors. New interpretations beyond the existing branch/route/stroke roles
belong in a named interpretation module and may require a model extension.
They should not be hidden inside a glyph alias or scanner callback.

Each extension needs a positive fixture, nearby literal/overlap cases, and a
comparison against existing semantic expectations. The tests use independently
reviewed tree/graph fixtures, not the Python implementation as an output oracle.

## Limits and execution

Malformed drawing normally produces partial results and diagnostics. Invalid
options and resource-limit violations throw. Defaults bound input to 1,000,000
UTF-16 units, expanded rows to 100,000 columns, candidates to 100,000, nodes to
10,000, and each track-matching table to 100,000 cells. These are configurable.

This dialect does not infer arbitrary box-and-arrow layouts, diagonal routes,
relationships from prose, or missing/truncated label content. Simple enclosing
frames are treated as wrappers, not container semantics. Original text remains
available for unsupported content.

```sh
npm run parse:diagram -- drawing.txt --dialect graph
npm run parse:diagram -- drawing.txt --dialect graph --format cleaned
npm run parse:diagram -- drawing.txt --dialect graph --strict
```

The CLI reads stdin if no file is given. JSON output includes the full partial
result. `--strict` exits with status 1 on warnings/errors while still emitting
that result. Rendering collisions also produce a nonzero exit status.
