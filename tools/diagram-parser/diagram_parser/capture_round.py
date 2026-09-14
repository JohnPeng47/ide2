"""Capture frozen-parser output for an independent review; never infer correctness.

Usage: python3 diagram_parser/capture_round.py diagram_parser/round_2
"""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("round_dir", type=Path)
    args = parser.parse_args()
    directory = args.round_dir.resolve()
    manifest = json.loads((directory / "manifest.json").read_text())
    frozen = directory / "tree_parser_snapshot.py"
    if sha256(frozen.read_bytes()).hexdigest() != manifest["parserSha256"]:
        raise ValueError("Frozen parser hash differs from the pre-generation manifest")
    spec = importlib.util.spec_from_file_location("frozen_round_tree_parser", frozen)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    receipts = json.loads((directory / "generated" / "receipts.json").read_text())
    if len(receipts) != 6:
        raise ValueError("Expected exactly six generation receipts")
    output = directory / "parsed"
    output.mkdir(exist_ok=False)
    entries = []
    for receipt in receipts:
        if receipt["promptSha256"] != manifest["promptSha256"]:
            raise ValueError(f"Prompt changed for {receipt['name']}")
        if receipt["exitCode"] != 0 or not receipt["files"]:
            raise ValueError(f"Generation failed for {receipt['name']}")
        for i, filename in enumerate(receipt["files"], 1):
            source_path = ROOT / filename
            raw = source_path.read_bytes()
            key = f"{receipt['name']}_{i}"
            entry = {"id": key, "generator": receipt["name"], "model": receipt["model"],
                     "source": str(source_path.relative_to(directory)), "sourceSha256": sha256(raw).hexdigest(),
                     "parsed": f"parsed/{key}.json", "reviewTable": f"parsed/{key}.review.txt"}
            try:
                result = module.parse_tree(raw.decode("utf-8"), **manifest["parserOptions"])
                parsed = result.to_dict()
                entry.update({"exception": None, "nodes": len(result.nodes),
                              "edges": len(result.nodes) - len(result.roots), "roots": len(result.roots),
                              "diagnostics": parsed["diagnostics"], "strictWouldFail": bool(result.diagnostics),
                              "sourceLines": len(result.lines), "semanticCorrectness": "awaiting_independent_review"})
                table = ["NODE SOURCE_LINE PARENT_SOURCE_LINE DEPTH LABEL (JSON string)"]
                for node in result.nodes:
                    parent = result.nodes[node.parent_id].line if node.parent_id is not None else "ROOT"
                    table.append(f"{node.id:4} {node.line:4} {str(parent):>5} {node.depth:3} {json.dumps(node.label, ensure_ascii=False)}")
                table += ["", "LINES NOT CLASSIFIED AS NODE:"]
                for line in result.lines:
                    if line.kind != "node":
                        table.append(f"{line.line:4} {line.kind:14} node={line.node_id} {json.dumps(line.raw, ensure_ascii=False)}")
                table += ["", "DIAGNOSTICS:", json.dumps(parsed["diagnostics"], ensure_ascii=False, indent=2)]
                (output / f"{key}.review.txt").write_text("\n".join(table) + "\n")
            except (ValueError, UnicodeError) as error:
                parsed = {"exception": f"{type(error).__name__}: {error}"}
                entry.update(parsed)
                entry["strictWouldFail"] = True
            (output / f"{key}.json").write_text(json.dumps(parsed, ensure_ascii=False, indent=2) + "\n")
            entry["parsedSha256"] = sha256((output / f"{key}.json").read_bytes()).hexdigest()
            entries.append(entry)
            print(json.dumps(entry, ensure_ascii=False), flush=True)
    summary = {"round": manifest["round"], "capturedAt": datetime.now(timezone.utc).isoformat(),
               "parserSha256": manifest["parserSha256"], "promptSha256": manifest["promptSha256"],
               "generationCount": len(receipts), "diagramCount": len(entries),
               "parseExceptions": sum(e["exception"] is not None for e in entries),
               "strictDiagnosticFailures": sum(e["strictWouldFail"] for e in entries),
               "semanticFailures": None, "entries": entries}
    (directory / "parse_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
