"""Run six Codex generators in separate working directories with identical prompts.

Requires an authenticated `codex` CLI. Runs at most three agents concurrently.
Generated files and execution receipts are retained; temporary workspaces are removed.
Use --blind for filesystem isolation from other diagrams and transcripts.
"""

from concurrent.futures import ThreadPoolExecutor
import argparse
from functools import partial
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent


def blind_command(command, workspace):
    """Hide other checkouts/transcripts and remove read-capable generation tools."""
    bubblewrap = shutil.which("bwrap")
    codex = Path(shutil.which("codex")).resolve()
    home = Path.home()
    if not bubblewrap:
        raise RuntimeError("Blind generation requires bubblewrap (bwrap)")
    return [bubblewrap, "--die-with-parent", "--unshare-pid", "--ro-bind", "/", "/",
            "--tmpfs", "/home", "--tmpfs", "/tmp", "--tmpfs", "/mnt",
            "--proc", "/proc", "--dev", "/dev", "--bind", workspace, workspace,
            "--dir", str(home / ".codex"),
            "--ro-bind", str(home / ".codex/auth.json"), str(home / ".codex/auth.json"),
            "--ro-bind", str(codex), "/tmp/tree-generator-codex",
            "--chdir", workspace, "--", "/tmp/tree-generator-codex",
            *command[1:-1], "--disable", "shell_tool", "--disable", "multi_agent",
            "-c", 'web_search="disabled"', "-"]


def capture_final_diagrams(events_path, destination):
    """Keep a model's exact ASCII response when its file-writing tool is unavailable."""
    messages = []
    for line in events_path.read_text().splitlines():
        event = json.loads(line)
        item = event.get("item", {})
        if event.get("type") == "item.completed" and item.get("type") == "agent_message":
            messages.append(item["text"])
    if not messages:
        return []
    blocks = re.findall(r"^```(?:text|ascii|tree|plaintext)?[ \t]*\n(.*?)^```[ \t]*$",
                        messages[-1], re.MULTILINE | re.DOTALL)
    diagrams = [block for block in blocks if re.search(r"(?:[+|`\\]--|├─|└─)", block)]
    files = []
    for i, content in enumerate(diagrams, 1):
        target = destination / "diagrams" / f"response-diagram-{i}.txt"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        files.append(str(target.relative_to(ROOT)))
    if files:
        (destination / "final_response.txt").write_text(messages[-1])
    return files


def generate(job, output_dir=ROOT / "generated", blind=False):
    name, model = job
    destination = output_dir / name
    destination.mkdir(parents=True, exist_ok=False)
    prompt = (ROOT / "generation_prompt.txt").read_bytes()
    with tempfile.TemporaryDirectory(prefix="tree-generator-") as workspace:
        command = [
            "codex", "exec", "--ignore-user-config", "--ephemeral",
            "--skip-git-repo-check", "--sandbox", "workspace-write",
            "-c", 'approval_policy="never"',
            "-c", 'model_reasoning_effort="high"',
            "--model", model, "--cd", workspace, "--json", "-",
        ]
        if blind:
            command = blind_command(command, workspace)
        started = time.time()
        print(f"Starting {name}: {model}, high", flush=True)
        with (destination / "events.jsonl").open("wb") as stdout, (destination / "stderr.log").open("wb") as stderr:
            result = subprocess.run(command, input=prompt, stdout=stdout, stderr=stderr, timeout=1200)
        output = Path(workspace) / "diagram_parser"
        files = []
        if output.exists():
            for path in output.rglob("*"):
                if path.is_file() and not path.is_symlink():
                    target = destination / "diagrams" / path.relative_to(output)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(path, target)
                    files.append(str(target.relative_to(ROOT)))
        receipt = {"name": name, "model": model, "reasoningEffort": "high",
                   "promptSha256": sha256(prompt).hexdigest(), "exitCode": result.returncode,
                   "elapsedSeconds": round(time.time() - started, 2), "files": files}
        if result.returncode == 0 and not files:
            receipt["files"] = capture_final_diagrams(destination / "events.jsonl", destination)
            if receipt["files"]:
                receipt["artifactDelivery"] = "Exact fenced ASCII from final model response; no model-written file was available"
        if blind:
            receipt["isolation"] = "bubblewrap hides other homes, tmp workspaces, mounts and processes; shell, subagents and web search disabled"
        (destination / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt), flush=True)
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "generated",
                        help="New corpus directory under diagram_parser/; existing runs are never overwritten")
    parser.add_argument("--blind", action="store_true", help="Hide other artifacts using bubblewrap and disable read-capable tools")
    args = parser.parse_args()
    output_dir = args.output_dir.resolve()
    if not output_dir.is_relative_to(ROOT):
        parser.error("--output-dir must be under diagram_parser/")
    jobs = [(f"sol_{i}", "gpt-5.6-sol") for i in range(1, 4)]
    jobs += [(f"astra_{i}", "gpt-6-astra") for i in range(1, 4)]
    if any((output_dir / name).exists() for name, _ in jobs):
        parser.error("output directory contains existing runs; choose a new --output-dir")
    with ThreadPoolExecutor(max_workers=3) as pool:
        receipts = list(pool.map(partial(generate, output_dir=output_dir, blind=args.blind), jobs))
    (output_dir / "receipts.json").write_text(json.dumps(receipts, indent=2) + "\n")
    if any(r["exitCode"] or not r["files"] for r in receipts):
        raise SystemExit("One or more generators failed; inspect receipts and logs.")


if __name__ == "__main__":
    main()
