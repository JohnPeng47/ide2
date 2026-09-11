"""Structural regression tests and independently rendered, known-answer trees."""

import json
from hashlib import sha256
from pathlib import Path
import random
import subprocess
import sys
import unittest

from diagram_parser.tree_parser import TreeParseError, parse_tree

ROOT = Path(__file__).resolve().parent


def structure(result):
    return [(n.label, n.parent_id) for n in result.nodes]


class ParserTests(unittest.TestCase):
    def assertTree(self, text, expected, **options):
        result = parse_tree(text, **options)
        self.assertEqual(structure(result), expected)
        self.assertEqual([r.line for r in result.lines], list(range(1, len(text.splitlines()) + 1)))
        self.assertEqual([r.raw for r in result.lines], text.splitlines())
        for n in result.nodes:
            self.assertEqual(n.depth, 0 if n.parent_id is None else result.nodes[n.parent_id].depth + 1)
            if n.parent_id is not None:
                self.assertIn(n.id, result.nodes[n.parent_id].children)
        return result

    def test_connector_families(self):
        for join, end, guide in [("+--", "\\--", "|"), ("|--", "`--", "|"),
                                 ("├──", "└──", "│"), ("┣━━", "┗━━", "┃"),
                                 ("╠══", "╚══", "║"), ("+-", "'-", "|"),
                                 ("├─", "╰─", "│"), ("+---->", "\\->", "|"),
                                 ("->", "->", "|"), ("→", "↳", "│")]:
            with self.subTest(join=join):
                self.assertTree(f"Root\n{join} A\n{guide}   {end} B\n{end} C",
                                [("Root", None), ("A", 0), ("B", 1), ("C", 0)], strict=True)

    def test_variable_depth_spacing_and_connector_width(self):
        self.assertTree(" Root\n +---- A\n |  +- B\n |     \\- C\n `- D",
                        [("Root", None), ("A", 0), ("B", 1), ("C", 2), ("D", 0)], strict=True)

    def test_rootless_forest_duplicates_and_blanks(self):
        self.assertTree("+-- Same\n|\n|   \\-- Same\n\n\\-- Same\n    \\-- Same",
                        [("Same", None), ("Same", 0), ("Same", None), ("Same", 2)], strict=True)

    def test_indentation_only(self):
        self.assertTree("Root\n  A\n     B\n  C\nSecond\n  D",
                        [("Root", None), ("A", 0), ("B", 1), ("C", 0), ("Second", None), ("D", 4)], strict=True)

    def test_bullets_numbered_and_mixed(self):
        self.assertTree("Domain\n- A\n  1. B\n  2) C\n+ D\n  • E",
                        [("Domain", None), ("A", 0), ("B", 1), ("C", 1), ("D", 0), ("E", 4)], strict=True)

    def test_guided_bullets_and_short_unicode_joints(self):
        self.assertTree("Root\n+ A\n|  - B\n|  └ C\n\\__ D",
                        [("Root", None), ("A", 0), ("B", 1), ("C", 1), ("D", 0)], strict=True)

    def test_unmarked_interior_heading(self):
        self.assertTree("Root\n+-- A\n|   Section\n|   +-- B\n`-- C",
                        [("Root", None), ("A", 0), ("Section", 1), ("B", 2), ("C", 0)], strict=True)

    def test_unicode_tabs_ansi_and_crlf(self):
        source = "\ufeffRoot\r\n├── \x1b[32mA\x1b[0m\r\n│\t└── B\r\n└── \x1b]8;;https://example.com\x1b\\C\x1b]8;;\x1b\\"
        self.assertTree(source, [("Root", None), ("A", 0), ("B", 1), ("C", 0)], strict=True)
        self.assertTree("Root\n\u00a0\u00a0+-- A\n\u00a0\u00a0\u00a0\u00a0+-- B", [("Root", None), ("A", 0), ("B", 1)])

    def test_label_content_is_not_reinterpreted(self):
        labels = ["A -> B | C", "[0..*; recursive]", "C++ / C#", "`quoted label`",
                  "-negative", "# heading", "1. label", "日本語 / café / 🚀", "--flag", "a  b"]
        source = "Root\n" + "\n".join("+-- " + label for label in labels)
        self.assertTree(source, [("Root", None)] + [(label, 0) for label in labels], strict=True)

    def test_fences_quotes_multiple_diagrams(self):
        source = "Here is the tree:\n\n```text\nRoot\n+-- A\n```\nExplanation.\n\n~~~ascii\nOther\n`-- B\n~~~\n"
        self.assertTree(source, [("Root", None), ("A", 0), ("Other", None), ("B", 2)], strict=True)
        self.assertTree("> ```text\n> Root\n> +-- A\n> ```", [("Root", None), ("A", 0)], strict=True)
        self.assertTree("````text\nRoot\n+-- A\n````", [("Root", None), ("A", 0)], strict=True)

    def test_prose_and_unrelated_code_not_nodes(self):
        source = "# Domain\nAn introductory paragraph.\n\nRoot\n+-- A\n\nNOTES\n  Explanatory text.\n"
        self.assertTree(source, [("Root", None), ("A", 0)], strict=True)
        self.assertTree("```python\nprint('not a tree')\n```\n```tree\nRoot\n+-- A\n```",
                        [("Root", None), ("A", 0)], strict=True)

    def test_notes_can_be_real_root_or_node(self):
        self.assertTree("Notes\n+-- A", [("Notes", None), ("A", 0)], strict=True)
        self.assertTree("# Real root\n  Notes\n    x", [("# Real root", None), ("Notes", 0), ("x", 1)], mode="tree")

    def test_outer_frame(self):
        self.assertTree("+-------------+\n| Root        |\n| +-- A       |\n| |   `-- B   |\n| `-- C       |\n+-------------+",
                        [("Root", None), ("A", 0), ("B", 1), ("C", 0)], strict=True)

    def test_wrapped_label_policy(self):
        text = "Root\n+-- Ready / Generating /\n|   Applied / Error\n`-- End"
        p = self.assertTree(text, [("Root", None), ("Ready / Generating / Applied / Error", 0), ("End", 0)])
        self.assertEqual(p.nodes[1].end_line, 3)
        self.assertEqual(p.diagnostics[0].code, "joined_continuation")
        self.assertTree(text, [("Root", None), ("Ready / Generating /", 0), ("Applied / Error", 1), ("End", 0)], continuation="nodes")
        with self.assertRaises(TreeParseError):
            parse_tree(text, strict=True)

    def test_irregular_dedent_reports_recovery(self):
        p = self.assertTree("Root\n+-- A\n    +-- B\n  +-- C\n`-- D",
                            [("Root", None), ("A", 0), ("B", 1), ("C", 1), ("D", 0)])
        self.assertEqual([d.code for d in p.diagnostics], ["irregular_dedent"])

    def test_empty_unclosed_and_limits(self):
        self.assertFalse(parse_tree("\n |\n").nodes)
        with self.assertRaises(TreeParseError) as caught:
            parse_tree("```text\nRoot\n+-- A", strict=True)
        self.assertEqual(len(caught.exception.result.nodes), 2)
        for options in [{"max_chars": 1}, {"max_nodes": 1}, {"tab_size": 0}, {"mode": "bad"}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                parse_tree("Root\n+-- A", **options)
        with self.assertRaises(TypeError):
            parse_tree(b"Root")

    def test_deep_tree_is_not_recursive(self):
        source = "Root\n" + "\n".join(" " * (i * 2) + "+-- n" + str(i) for i in range(1100))
        result = parse_tree(source, strict=True)
        self.assertEqual(result.nodes[-1].depth, 1100)
        self.assertEqual(len(result.to_dict()["nodes"]), 1101)
        self.assertEqual(len(parse_tree(result.render()).nodes), 1101)

    def test_original_tree(self):
        result = parse_tree((ROOT / "original_tree.txt").read_text())
        self.assertEqual(len(result.nodes), 125)
        self.assertEqual([result.nodes[i].label for i in result.roots], ["MappingScreen"])
        root = result.nodes[0]
        self.assertEqual([result.nodes[i].label for i in root.children],
                         ["ScreenHeader", "MappingWorkspace", "NewDiagramModal [conditional]", "UITestingControls"])
        self.assertEqual([d.code for d in result.diagnostics], ["joined_continuation"])
        self.assertEqual(structure(parse_tree(result.render())), structure(result))

    def test_six_generated_trees_every_label_and_edge(self):
        corpus = json.loads((ROOT / "corpus_expected.json").read_text())
        self.assertEqual(len(corpus["fixtures"]), 6)
        for fixture in corpus["fixtures"]:
            with self.subTest(generator=fixture["name"]):
                raw = (ROOT / fixture["path"]).read_bytes()
                self.assertEqual(sha256(raw).hexdigest(), fixture["sha256"], "Generated input was changed")
                # Round 1's archived oracle explicitly included detached prose bullets.
                result = parse_tree(raw.decode(), strict=True, list_policy="include")
                actual = [{"line": n.line, "label": n.label,
                           "parentLine": result.nodes[n.parent_id].line if n.parent_id is not None else None}
                          for n in result.nodes]
                self.assertEqual(actual, fixture["expected"])
                self.assertEqual(len(result.lines), len(raw.decode().splitlines()))
                self.assertEqual(structure(parse_tree(result.render(), strict=True)), structure(result))

    def test_generation_prompt_provenance(self):
        prompt = (ROOT / "generation_prompt.txt").read_bytes()
        context = (ROOT / "code_context.md").read_text().rstrip("\n")
        self.assertEqual(prompt.decode(), "Here is some source code context:\n" + context +
                         "\n\nGenerate an ascii tree depiciting the domain model representative of the above source code context\n"
                         "Write the generated diagrams to diagram_parser/\n")
        receipts = json.loads((ROOT / "generated" / "receipts.json").read_text())
        self.assertEqual(sorted(r["model"] for r in receipts), ["gpt-5.6-sol"] * 3 + ["gpt-6-astra"] * 3)
        for receipt in receipts:
            self.assertEqual(receipt["reasoningEffort"], "high")
            self.assertEqual(receipt["exitCode"], 0)
            self.assertEqual(receipt["promptSha256"], sha256(prompt).hexdigest())
            self.assertTrue(receipt["files"])

    def test_cli_json_and_strict_exit_status(self):
        command = [sys.executable, str(ROOT / "tree_parser.py")]
        p = subprocess.run(command, input="Root\n+-- A", text=True, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout)["nodes"][1]["parent_id"], 0)
        p = subprocess.run(command + ["--strict"], input="```text\nRoot", text=True, capture_output=True)
        self.assertEqual(p.returncode, 1)
        self.assertEqual(json.loads(p.stdout)["diagnostics"][0]["code"], "unclosed_fence")


def random_case(seed):
    """Generate a model first, then render it independently of parser/render()."""
    rng = random.Random(seed)
    children = [[]]
    depths = [0]
    for i in range(1, rng.randint(5, 65)):
        candidates = [j for j in range(i) if depths[j] < 7]
        parent = rng.choice(candidates)
        children[parent].append(i)
        children.append([])
        depths.append(depths[parent] + 1)
    order = []
    parents = []
    def visit(node, parent_index):
        index = len(order)
        order.append(node)
        parents.append(parent_index)
        for child in children[node]:
            visit(child, index)
    visit(0, None)
    step = rng.choice([2, 3, 4, 5, 8])
    margin = rng.randrange(4)
    root_offset = rng.choice([0, 2, 4])
    joins = ["+--", "\\--", "|--", "`--", "├──", "└──", "┣━", "╚═", "+-", "->", "↳"]
    labels = {i: f"Node {i} [0..*] -> Target | value" for i in order}
    rows = [" " * margin + labels[0]]
    for i in order[1:]:
        depth = depths[i]
        prefix = " " * (margin + root_offset)
        for _ in range(depth - 1):
            prefix += rng.choice([" " * step, rng.choice(["|", "│", "┃", "║"]) + " " * (step - 1)])
        if rng.random() < 0.15:
            rows.append(prefix.rstrip())
        label = labels[i]
        if rng.random() < 0.2:
            label = "\x1b[36m" + label + "\x1b[0m"
        rows.append(prefix + rng.choice(joins) + " " * rng.randint(1, 3) + label + " " * rng.randrange(4))
    if rng.random() < 0.5:
        rows = ["Here is the requested model:", "```text", *rows, "```", "End of explanation."]
    if rng.random() < 0.2:
        rows = ["> " + row for row in rows]
    return rng.choice(["\n", "\r\n"]).join(rows), [(labels[i], p) for i, p in zip(order, parents)]


class KnownAnswerFuzzTests(unittest.TestCase):
    def test_two_thousand_structural_variants(self):
        for seed in range(2000):
            with self.subTest(seed=seed):
                text, expected = random_case(seed)
                result = parse_tree(text, strict=True)
                self.assertEqual(structure(result), expected)
                self.assertEqual(structure(parse_tree(result.render(), strict=True)), expected)


if __name__ == "__main__":
    unittest.main()
