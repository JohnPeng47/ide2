"""Validate every generated node/edge against reviewed expectations; save JSON output."""

from hashlib import sha256
import json
from pathlib import Path

try:
    from .tree_parser import parse_tree
except ImportError:
    from tree_parser import parse_tree

ROOT = Path(__file__).resolve().parent


def main():
    corpus = json.loads((ROOT / "corpus_expected.json").read_text())
    report = []
    output = ROOT / "parsed"
    output.mkdir(exist_ok=True)
    for fixture in corpus["fixtures"]:
        source = (ROOT / fixture["path"]).read_bytes()
        if sha256(source).hexdigest() != fixture["sha256"]:
            raise ValueError(f"Generated source changed: {fixture['path']}")
        # Preserve this historical corpus's explicit bullet-list interpretation.
        result = parse_tree(source.decode("utf-8"), strict=True, list_policy="include")
        actual = [{"line": n.line, "label": n.label,
                   "parentLine": result.nodes[n.parent_id].line if n.parent_id is not None else None}
                  for n in result.nodes]
        if actual != fixture["expected"]:
            raise ValueError(f"Labels or parent-child edges differ: {fixture['path']}")
        (output / (fixture["name"] + ".json")).write_text(json.dumps(result.to_dict(), indent=2, ensure_ascii=False) + "\n")
        entry = {"generator": fixture["name"], "file": fixture["path"], "sha256": fixture["sha256"],
                 "nodes": len(result.nodes), "edges": len(result.nodes) - len(result.roots),
                 "roots": len(result.roots), "sourceLines": len(result.lines),
                 "diagnostics": len(result.diagnostics), "allLabelsAndEdgesMatch": True}
        report.append(entry)
        print(f"{fixture['name']}: {entry['nodes']} nodes, {entry['edges']} edges, no diagnostics — PASS")
    original = parse_tree((ROOT / "original_tree.txt").read_text())
    (output / "original.json").write_text(json.dumps(original.to_dict(), indent=2, ensure_ascii=False) + "\n")
    (ROOT / "validation_report.json").write_text(json.dumps({"generated": report,
        "original": {"nodes": len(original.nodes), "roots": len(original.roots),
                     "diagnostics": [d.__dict__ for d in original.diagnostics]},
        "scope": "Exact labels and parent-child edges for six independent outputs; not a statistical reliability estimate."}, indent=2) + "\n")


if __name__ == "__main__":
    main()
