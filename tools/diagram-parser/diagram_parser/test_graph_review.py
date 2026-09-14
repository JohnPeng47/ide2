"""Independent adversarial checks for the graph layer's tree reuse."""

from pathlib import Path
import unittest

from diagram_parser.graph_parser import parse_graph


HERE = Path(__file__).parent


class GraphReviewTests(unittest.TestCase):
    def test_neighbor_root_aligns_with_its_first_level_branches(self):
        result = parse_graph((HERE / "fixtures/misaligned_neighbor.txt").read_text())
        neighbor = next(node for node in result.nodes if node.text == "GridContent")
        root = neighbor.spans[0]
        first_level = [
            neighbor.spans[item.id]
            for item in neighbor.tree.nodes[1:]
            if item.parent_id == 0
        ]
        self.assertTrue(first_level)
        self.assertTrue(all(span.cleaned_branch_column == root.cleaned_column
                            for span in first_level))
        reparsed = parse_graph(result.cleaned_ascii)
        self.assertEqual(reparsed.cleaned_ascii, result.cleaned_ascii)
        self.assertFalse(reparsed.repairs)

    def test_narrow_but_explicit_nested_depth_is_not_repaired_as_drift(self):
        # The leading guide makes the one-column increase structural rather than
        # accidental alignment noise.  The reused tree parser understands it.
        result = parse_graph("Root\n+- A\n|+- B")
        tree = result.nodes[0].tree
        self.assertEqual([(node.label, node.parent_id) for node in tree.nodes],
                         [("Root", None), ("A", 0), ("B", 1)])
        self.assertNotIn("cleanup_collision", [d.code for d in result.diagnostics])

    def test_reused_tree_labels_preserve_repeated_spaces(self):
        result = parse_graph("Root\n|-- label with  two spaces\n`-- leaf")
        self.assertEqual(len(result.nodes), 1)
        self.assertEqual([node.label for node in result.nodes[0].tree.nodes],
                         ["Root", "label with  two spaces", "leaf"])

    def test_unheaded_dashes_are_text_or_heading_rule_not_a_reference(self):
        label = parse_graph("Root\n|-- horizontal --- separator\n`-- leaf")
        self.assertEqual(len(label.nodes), 1)
        self.assertEqual([node.label for node in label.nodes[0].tree.nodes],
                         ["Root", "horizontal --- separator", "leaf"])
        self.assertFalse(label.diagnostics)

        heading = parse_graph("Legend\n------\n|-- containment\n`-- reference")
        self.assertEqual(len(heading.nodes), 1)
        self.assertEqual([node.label for node in heading.nodes[0].tree.nodes],
                         ["Legend", "containment", "reference"])
        self.assertFalse(heading.diagnostics)


if __name__ == "__main__":
    unittest.main()
