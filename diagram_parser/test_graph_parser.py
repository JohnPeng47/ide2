"""Known-answer graph tests; expectations are independent of parser output."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

try:
    from .graph_parser import GraphParseError, parse_graph
except ImportError:
    from graph_parser import GraphParseError, parse_graph

HERE = Path(__file__).parent


def signature(result):
    nodes = [(n.kind, n.text, [(t.label, t.parent_id) for t in n.tree.nodes]
              if n.tree else []) for n in result.nodes]
    edges = sorted((e.source.node_id, e.source.tree_node_id or -1,
                    e.target.node_id, e.target.tree_node_id or -1)
                   for e in result.references)
    return nodes, edges


def named_edges(result):
    def label(endpoint):
        node = result.nodes[endpoint.node_id]
        return node.text if endpoint.tree_node_id is None else node.tree.nodes[endpoint.tree_node_id].label
    return [(label(e.source), label(e.target)) for e in result.references]


class GraphTests(unittest.TestCase):
    def test_mapping_known_hierarchies_and_references(self):
        result = parse_graph((HERE / "fixtures/mapping_graph.txt").read_text())
        trees = {n.text: n.tree for n in result.nodes if n.tree}
        self.assertEqual(set(trees), {"Project", "MappingDocument", "GridContent"})
        grid = trees["GridContent"]
        self.assertEqual([(n.label, n.parent_id) for n in grid.nodes], [
            ("GridContent", None), ("id", 0), ("ascii", 0), ("revision", 0),
            ("mappings: EvidenceMapping[]", 0), ("sourceRanges[]", 4),
            ("source/file identity", 5), ("line/column range", 5)])
        self.assertEqual(len(trees["Project"].nodes), 17)
        self.assertEqual(len(trees["MappingDocument"].nodes), 23)
        self.assertIn(("currentRevisionId", "ProjectRepresentationRevision"), named_edges(result))
        self.assertIn(("contents: GridContent [contentId -> content]", "GridContent"), named_edges(result))
        self.assertIn(("collapsedContentId?", "GridContent"), named_edges(result))
        self.assertIn(("contentId", "GridContent"), named_edges(result))
        self.assertIn(("EvidenceMapping", "evidenceId"), named_edges(result))
        self.assertIn(("sourceRanges[]", "SourceEvidence"), named_edges(result))
        self.assertEqual([n.kind for n in result.nodes if n.text == "LineGridScene"], ["text"])
        self.assertEqual([(d.line, d.code) for d in result.diagnostics if d.severity != "info"],
                         [(26, "unheaded_reference")])
        cleaned = parse_graph(result.cleaned_ascii)
        self.assertEqual(signature(result), signature(cleaned))
        self.assertEqual(cleaned.cleaned_ascii, result.cleaned_ascii)
        self.assertFalse(cleaned.repairs)

    def test_latest_truncated_neighbor(self):
        text = (HERE / "fixtures/misaligned_neighbor.txt").read_text()
        result = parse_graph(text)
        self.assertEqual(len(result.nodes), 2)
        neighbor = result.nodes[1]
        self.assertEqual([(n.label, n.parent_id) for n in neighbor.tree.nodes],
                         [("GridContent", None), ("id", 0), ("ascii", 0),
                          ("revision", 0), ("mappin", 0)])
        self.assertEqual(named_edges(result), [("contents: GridContent [contentId -> content]", "GridContent")])
        self.assertTrue(any(d.code == "unresolved_reference" for d in result.diagnostics))
        self.assertEqual(len({s.cleaned_branch_column for s in neighbor.spans[1:]}), 1)
        self.assertEqual(signature(result), signature(parse_graph(result.cleaned_ascii)))
        self.assertIn("mappin", result.cleaned_ascii)
        self.assertEqual(result.original_ascii, text)

    def test_tree_parser_reused_with_label_syntax(self):
        result = parse_graph("Root\n|-- map [id -> record]\n|-- status: settled | ...\n`-- a-b { column, row }")
        self.assertEqual([n.label for n in result.nodes[0].tree.nodes],
                         ["Root", "map [id -> record]", "status: settled | ...", "a-b { column, row }"])
        self.assertFalse(result.references)
        self.assertFalse(result.diagnostics)

    def test_inline_targets_and_annotations(self):
        result = parse_graph("LineGridScene ------------------> [Expand Here]")
        self.assertEqual(named_edges(result), [("LineGridScene", "[Expand Here]")])
        result = parse_graph("Root\n|-- p ----> Same\n`-- q ----> Same")
        self.assertEqual(len(result.nodes), 3)
        self.assertNotEqual(result.references[0].target.node_id, result.references[1].target.node_id)

    def test_drifting_corner_and_down_arrow(self):
        result = parse_graph("A ------+\n         |\n        |\n         v\n         B")
        self.assertEqual(named_edges(result), [("A", "B")])
        self.assertEqual(result.cleaned_ascii, "A -------+\n         |\n         |\n         v\n         B")
        self.assertEqual(len(result.repairs), 2)
        self.assertFalse(result.diagnostics)

    def test_vertical_reference_and_text_box(self):
        result = parse_graph("Alpha\n  |\n  v\nBeta\nDetails")
        self.assertEqual(named_edges(result), [("Alpha", "Beta\nDetails")])
        self.assertFalse(result.diagnostics)

    def test_parallel_wires_stay_separate(self):
        result = parse_graph("A --+    B --+\n    |        |\n    v        v\n    C        D")
        self.assertEqual(named_edges(result), [("A", "C"), ("B", "D")])
        self.assertFalse(result.diagnostics)

    def test_vertical_directions_and_direct_heads(self):
        for source, expected in [("A\nv\nB", ("A", "B")),
                                 ("A\n^\n|\nB", ("B", "A")),
                                 ("A <--- B", ("B", "A"))]:
            with self.subTest(source=source):
                result = parse_graph(source)
                self.assertEqual(named_edges(result), [expected])
                self.assertFalse(result.diagnostics)

    def test_repair_cannot_cross_text(self):
        result = parse_graph("A --+\n    |X\n      |\n      v\n      B")
        self.assertIn("blocked_wire_repair", [d.code for d in result.diagnostics])
        self.assertIn("|X", result.cleaned_ascii)
        self.assertFalse(result.references)

    def test_missing_head_and_ambiguous_target(self):
        result = parse_graph("A --+\n    |\n    |")
        self.assertFalse(result.references)
        self.assertIn("unheaded_reference", [d.code for d in result.diagnostics])
        with self.assertRaises(GraphParseError):
            parse_graph("v\nA  B", strict=True)

    def test_arrow_touching_neighbor_branch(self):
        result = parse_graph("Root       Other\n|-- a ---->|-- b\n`-- c      `-- d")
        self.assertEqual(len(result.nodes), 2)
        self.assertEqual(named_edges(result), [("a", "Other")])
        self.assertEqual([n.label for n in result.nodes[1].tree.nodes], ["Other", "b", "d"])
        self.assertEqual(signature(result), signature(parse_graph(result.cleaned_ascii)))

    def test_limits_and_cli(self):
        with self.assertRaises(ValueError):
            parse_graph("abcdef", max_chars=3)
        with self.assertRaises(ValueError):
            parse_graph("A    B", max_spans=1)
        with self.assertRaises(ValueError):
            parse_graph("A", wire_tolerance=-1)
        run = subprocess.run([sys.executable, str(HERE / "graph_parser.py")],
                             input="A --> B", text=True, capture_output=True, check=True)
        data = json.loads(run.stdout)
        self.assertEqual(len(data["references"]), 1)
        self.assertEqual(data["cleaned_ascii"], "A --> B")


if __name__ == "__main__":
    unittest.main()
