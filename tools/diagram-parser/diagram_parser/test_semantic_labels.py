"""Regression coverage for the independently reviewed round 2 failures."""

from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import unittest

from diagram_parser.tree_parser import parse_tree

ROOT = Path(__file__).resolve().parent


class SemanticLabelTests(unittest.TestCase):
    def labels(self, source, **options):
        return [node.label for node in parse_tree(source, strict=True, **options).nodes]

    def test_paired_route_cleans_labels_and_retains_drawing(self):
        source = "Root\n+-- Source --------+\n|                  |\n+-- Bystander      |\n`-- Target <-------+"
        result = parse_tree(source, strict=True)
        self.assertEqual([n.label for n in result.nodes], ["Root", "Source", "Bystander", "Target"])
        self.assertEqual([n.parent_id for n in result.nodes], [None, 0, 0, 0])
        for node in result.nodes[1:]:
            self.assertEqual(len(node.decorations), 1)
            decoration = node.decorations[0]
            self.assertEqual(source.splitlines()[decoration.line - 1][decoration.column - 1:], decoration.text)
            self.assertEqual(node.raw_lines, [source.splitlines()[node.line - 1]])
        self.assertEqual(self.labels(result.render()), [n.label for n in result.nodes])

    def test_literal_mode_keeps_wire_suffixes(self):
        source = "Root\n+-- Source ----+\n`-- Target <---+"
        result = parse_tree(source, strict=True, label_mode="literal")
        self.assertEqual([n.label for n in result.nodes], ["Root", "Source ----+", "Target <---+"])
        self.assertTrue(all(not n.decorations for n in result.nodes))

    def test_unpaired_symbols_and_named_references_are_preserved(self):
        labels = ["C++", "a | b", "literal |", "literal ---+", "reference ---> Target", "literal <---+"]
        # Separate blocks prevent the two literal suffixes from suggesting a route.
        for label in labels:
            with self.subTest(label=label):
                self.assertEqual(self.labels("Root\n`-- " + label), ["Root", label])
        self.assertEqual(self.labels("Root\n+-- Ref ----+\n+-- x |\n`-- Target <--+"),
                         ["Root", "Ref", "x |", "Target"])

    def test_route_cannot_cross_fences_or_prose(self):
        self.assertEqual(self.labels("```text\nA\n`-- Out ----+\n```\n```text\nB\n`-- In <----+\n```"),
                         ["A", "Out ----+", "B", "In <----+"])
        self.assertEqual(self.labels("A\n`-- Out ----+\n\nB\n`-- In <----+"),
                         ["A", "Out ----+", "B", "In <----+"])

    def test_unicode_and_reverse_routes(self):
        self.assertEqual(self.labels("Root\n├── Source ───┐\n└── Target ←──┘"), ["Root", "Source", "Target"])
        self.assertEqual(self.labels("Root\n+-- Target <---+\n`-- Source ----+"), ["Root", "Target", "Source"])

    def test_detached_lists_are_prose_with_explicit_override(self):
        source = "Root\n`-- Child\n\nINVARIANTS\n----------\n\n* Statement one.\n* Statement two."
        result = parse_tree(source, strict=True)
        self.assertEqual([n.label for n in result.nodes], ["Root", "Child"])
        self.assertEqual([r.kind for r in result.lines if r.line in {4, 7, 8}], ["prose"] * 3)
        self.assertEqual(self.labels(source, list_policy="include"),
                         ["Root", "Child", "INVARIANTS", "Statement one.", "Statement two."])
        self.assertEqual(self.labels(source, mode="tree"),
                         ["Root", "Child", "INVARIANTS", "Statement one.", "Statement two."])

    def test_pure_lists_nested_lists_and_explicit_appendices_are_trees(self):
        self.assertEqual(self.labels("Root\n* A\n  * B\n* C"), ["Root", "A", "B", "C"])
        self.assertEqual(self.labels("Root\n+-- A\n\n|   * B\n`-- C"), ["Root", "A", "B", "C"])
        self.assertEqual(self.labels("Root\n+-- A\n\nINVARIANTS\n----------\n+-- B"),
                         ["Root", "A", "INVARIANTS", "B"])
        self.assertEqual(self.labels("Root\n+-- A\n\n* prose\n\nNext\n+-- B"), ["Root", "A", "Next", "B"])

    def test_round_2_matches_independent_clean_label_oracle(self):
        directory = ROOT / "round_2"
        summary = json.loads((directory / "parse_summary.json").read_text())
        fixtures = {d["id"]: d for d in json.loads((directory / "independent_expected.json").read_text())["diagrams"]}
        for entry in summary["entries"]:
            with self.subTest(generator=entry["generator"]):
                raw = (directory / entry["source"]).read_bytes()
                fixture = fixtures[entry["id"]]
                self.assertEqual(sha256(raw).hexdigest(), fixture["source_sha256"])
                result = parse_tree(raw.decode(), strict=True)
                actual = [{"line": n.line, "label": n.label,
                           "parent_line": result.nodes[n.parent_id].line if n.parent_id is not None else None,
                           "depth": n.depth, "column": n.column, "branch_column": n.branch_column,
                           "children_lines": [result.nodes[c].line for c in n.children]}
                          for n in result.nodes]
                self.assertEqual(actual, fixture["nodes"])
                self.assertEqual([r.raw for r in result.lines], raw.decode().splitlines())
                self.assertEqual(self.labels(result.render()), [n.label for n in result.nodes])
                self.assertEqual(sum(len(n.decorations) for n in result.nodes), 14 if entry["generator"] == "sol_3" else 0)

    def test_legacy_label_and_list_options_reproduce_round_2(self):
        directory = ROOT / "round_2"
        for entry in json.loads((directory / "parse_summary.json").read_text())["entries"]:
            with self.subTest(generator=entry["generator"]):
                original = json.loads((directory / entry["parsed"]).read_text())
                result = parse_tree((directory / entry["source"]).read_text(), strict=True,
                                    label_mode="literal", list_policy="include")
                self.assertEqual([n.label for n in result.nodes], [n["label"] for n in original["nodes"]])
                self.assertEqual([n.parent_id for n in result.nodes], [n["parent_id"] for n in original["nodes"]])

    def test_cli_exposes_both_policies(self):
        source = "Root\n+-- From ---+\n`-- To <----+\n\n* note"
        command = [sys.executable, str(ROOT / "tree_parser.py"), "--strict"]
        semantic = subprocess.run(command, input=source, text=True, capture_output=True)
        literal = subprocess.run(command + ["--label-mode", "literal", "--list-policy", "include"],
                                 input=source, text=True, capture_output=True)
        self.assertEqual(semantic.returncode, 0, semantic.stderr)
        self.assertEqual(literal.returncode, 0, literal.stderr)
        self.assertEqual([n["label"] for n in json.loads(semantic.stdout)["nodes"]], ["Root", "From", "To"])
        self.assertEqual([n["label"] for n in json.loads(literal.stdout)["nodes"]], ["Root", "From ---+", "To <----+", "note"])


if __name__ == "__main__":
    unittest.main()
