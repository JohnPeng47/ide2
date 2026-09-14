# Independent graph-parser review

Verdict: pass for the supplied 60-line mapping graph and the later truncated
`GridContent` alignment case under the documented regular connector grammar.

The review treated labels as positioned occurrences, not globally interned names.
It checked local containment independently from routed references.  The supplied
mapping fixture produces three local trees (`Project`, `MappingDocument`, and
`GridContent`), five text occurrences, and twelve directed reference occurrences.
The only non-informational diagnostic is the expected unheaded route on line 26.
The two joined buses report informational `shared_reference_bus` diagnostics.

The truncated alignment fixture produces the expected neighboring `GridContent`
tree with leaves `id`, `ascii`, `revision`, and `mappin`.  Cleanup aligns the root
and all first-level branch markers at one column while retaining the arrow from
the left `contents` item.  Re-parsing both cleaned fixtures preserves their graph
signatures, produces byte-identical cleaned ASCII, and requests no further
repairs.

Four adversarial findings were fixed during review:

1. The neighboring tree root initially remained one column left of its normalized
   first-level branches.
2. A real one-column nesting level with an explicit vertical guide was initially
   collapsed as alignment drift.
3. Two spaces inside a tree label initially split it into a second graph node.
4. An unheaded run of dashes was initially mistaken for a reference, splitting
   labels and treating dashed heading rules as wires.

The independent regressions are in `test_graph_review.py`.  Together with the
main graph suite and the original tree suite, all 48 tests pass.

The remaining limits are explicit grammar boundaries.  Neighboring text regions
need at least three separating spaces.  Containment children need visible branch
markers.  References need an arrowhead; arrow-only continuation rows do not infer
a source from nearby indentation.  A joined multi-source bus expands each source
to each geometrically resolved arrow endpoint and reports that choice.  Wire
repairs follow mutually nearest vertical cells within the configured tolerance;
if straightening would cross text or another wire, the route remains unchanged
and a diagnostic is returned.
