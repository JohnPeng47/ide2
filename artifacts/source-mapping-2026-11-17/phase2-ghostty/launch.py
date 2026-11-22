"""Run each paid sample in its own mount namespace. A nonzero exit stops new launches."""
import concurrent.futures
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

here = Path(__file__).resolve().parent
root = here.parents[2]
plan = json.loads((here / "plan.json").read_text())

def worker(key):
    with tempfile.TemporaryDirectory(prefix="mapping-phase2-", dir=Path.home()/".cache") as scratch:
        command = ["bwrap", "--die-with-parent", "--bind", "/", "/", "--dev-bind", "/dev", "/dev", "--proc", "/proc",
                   "--tmpfs", "/tmp", "--setenv", "TMPDIR", scratch, "node", "--import", "tsx", str(here/"worker.ts"), key]
        return subprocess.run(command, cwd=root).returncode

if sys.argv[1:] == ["--preflight"]:
    sys.exit(worker("--preflight"))
if sys.argv[1:] != ["--all"]:
    sys.exit("Expected --preflight or --all")
lock = (here/"launch.lock").open("a")
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
def finished(job):
    receipt = here/"jobs"/job["key"]/"status.json"
    return receipt.exists() and json.loads(receipt.read_text())["status"] == "finished"

jobs = sorted(plan["jobs"], key=lambda j: (j["number"], j["caseId"][-1], j["effort"], j["kind"]))
pending = iter(j for j in jobs if not finished(j))
failed = False
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
    running = {}
    while True:
        while not failed and len(running) < 6:
            job = next(pending, None)
            if job is None:
                break
            running[workers.submit(worker, job["key"])] = job["key"]
        if not running:
            break
        done, _ = concurrent.futures.wait(running, return_when=concurrent.futures.FIRST_COMPLETED)
        for future in done:
            key = running.pop(future)
            if future.result():
                failed = True
                print("Stopped new launches after", key, flush=True)
print("Completed", sum(finished(j) for j in jobs), "of", len(jobs), flush=True)
sys.exit(int(failed))
