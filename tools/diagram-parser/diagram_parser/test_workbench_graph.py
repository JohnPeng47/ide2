"""Source-line parent oracle and crossing-wire regressions for the user example."""
from pathlib import Path
import unittest

from diagram_parser.graph_parser import _ordered_pairs, parse_graph
from diagram_parser.test_graph_parser import named_edges, signature


class WorkbenchGraphTests(unittest.TestCase):
    def test_all_parents_and_references(self):
        source = (Path(__file__).parent / "fixtures/workbench_renderer.txt").read_text()
        result = parse_graph(source, strict=True)
        self.assertFalse(result.diagnostics)
        self.assertEqual([(n.kind, n.text) for n in result.nodes], [
            ("tree", "Workbench renderer"),
            ("tree", "TextModel [shared by editors displaying this document]"),
            ("text", "skip editor"), ("text", "skip editor")])
        # Transcribed from the supplied connectors, independently of parsed IDs.
        expected = {
            1: None, 3: 1, 4: 3, 5: 4, 6: 5, 7: 6, 8: 6, 10: 4, 11: 10,
            12: 11, 13: 11, 14: 13, 15: 14, 16: 15, 17: 15, 19: 10,
            20: 19, 21: 20, 23: 21, 25: 21, 26: 25, 27: 25, 28: 25,
            30: 21, 31: 30, 32: 31, 34: 30, 35: 34, 36: 35, 37: 36,
            38: 36, 40: 30, 54: 1, 56: 54, 57: 54, 59: 54, 61: 59,
            62: 61, 63: 61, 64: 61, 65: 64, 67: 59, 68: 67, 69: 67,
            71: 59, 72: 71, 74: 59, 75: 74, 77: 75, 78: 77, 79: 77, 80: 77,
            42: None, 44: 42, 45: 44, 46: 45, 47: 45, 49: 42,
            50: 49, 51: 50, 52: 51,
        }
        actual = {item.line: tree.nodes[item.parent_id].line if item.parent_id is not None else None
                  for node in result.nodes if (tree := node.tree) for item in tree.nodes}
        self.assertEqual(actual, expected)
        self.assertCountEqual(named_edges(result), [
            ("propagate dimensions", "layout(width, height, top, left)"),
            ("wrapping may change", "ViewModel [per editor]"),
            ("ITextModel", "TextModel [shared by editors displaying this document]"),
            ("no: enqueue", "EditorRenderingCoordinator"),
            ("rendering callbacks", "queued editor renderings"),
            ("disconnected DOM?", "skip editor"), ("nothing dirty?", "skip editor"),
        ])
        cleaned = parse_graph(result.cleaned_ascii, strict=True)
        self.assertEqual(signature(result), signature(cleaned))
        self.assertEqual(result.cleaned_ascii, cleaned.cleaned_ascii)
        self.assertFalse(cleaned.repairs)

    def test_crossing_does_not_join_sources(self):
        result = parse_graph("A ----+\n      |\nB ----|----> C\n      |\n      v\n      D", strict=True)
        self.assertCountEqual(named_edges(result), [("A", "D"), ("B", "C")])
        self.assertTrue(all((3, 7) in edge.wire_cells for edge in result.references))
        self.assertFalse(result.diagnostics)

    def test_parallel_bundle_drift_preserves_order(self):
        self.assertEqual(_ordered_pairs([72, 74, 76], [73, 75, 77], 2),
                         [(72, 73), (74, 75), (76, 77)])
        self.assertEqual(_ordered_pairs([72, 74], [73], 2), [])

    def test_dedent_keeps_earlier_parallel_tree_available(self):
        result = parse_graph("Left        Right\n|-- a       |-- x\n|   `-- b   |   `-- y\n`-- c       `-- z")
        self.assertEqual([n.text for n in result.nodes], ["Left", "Right"])
        self.assertEqual([(t.label, t.parent_id) for t in result.nodes[0].tree.nodes],
                         [("Left", None), ("a", 0), ("b", 1), ("c", 0)])
        self.assertEqual([(t.label, t.parent_id) for t in result.nodes[1].tree.nodes],
                         [("Right", None), ("x", 0), ("y", 1), ("z", 0)])


if __name__ == "__main__":
    unittest.main()
