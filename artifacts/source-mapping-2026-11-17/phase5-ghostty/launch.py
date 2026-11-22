"""Bounded jobs; no silent retry of a started model call. One launch per registered sample."""
import concurrent.futures
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile

here = Path(__file__).resolve().parent
root = here.parents[2]
plan_file = here / 'resume-plan.json'
if not plan_file.exists():
    plan_file = here / 'plan.json'
plan = json.loads(plan_file.read_text())

def worker(key):
    with tempfile.TemporaryDirectory(prefix='mapping-phase5-', dir=Path.home()/'.cache') as scratch:
        return subprocess.run(['bwrap', '--die-with-parent', '--bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc',
            '--tmpfs', '/tmp', '--setenv', 'TMPDIR', scratch, 'node', '--import', 'tsx', str(here/'worker.ts'), key], cwd=root).returncode

def finished(job):
    receipt = here/'jobs'/job['key']/'status.json'
    return receipt.exists() and json.loads(receipt.read_text())['status'] == 'finished'

mode = sys.argv[1:]
if mode == ['--preflight']:
    sys.exit(worker('--preflight'))
if mode not in [['--pilot'], ['--all'], ['--remaining']]:
    sys.exit('Expected --preflight, --pilot, --all or --remaining')
lock = (here/'launch.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
jobs = sorted(plan['jobs'], key=lambda j: (j['number'], j['caseId'], j['conditionId']))
if mode == ['--pilot']:
    jobs = [j for j in jobs if j['key'] in plan['pilot']]
if mode == ['--remaining']:
    jobs = [j for j in jobs if not (here/'jobs'/j['key']/'started.json').exists()]
pending = iter(j for j in jobs if not finished(j))
failed = False
with concurrent.futures.ThreadPoolExecutor(max_workers=plan['mainConcurrency']) as workers:
    running = {}
    while True:
        while not failed and len(running) < plan['mainConcurrency']:
            job = next(pending, None)
            if job is None:
                break
            running[workers.submit(worker, job['key'])] = job['key']
        if not running:
            break
        done, _ = concurrent.futures.wait(running, timeout=1, return_when=concurrent.futures.FIRST_COMPLETED)
        # Workers abort their lead on child failure. Stop scheduling even before
        # the root process exits and retains its failure receipt.
        for key in running.values():
            receipt=here/'jobs'/key/'children'/'subagents.json'
            if receipt.exists() and any(c['status']=='failed' for c in json.loads(receipt.read_text())):
                failed=True
        for future in done:
            key = running.pop(future)
            if future.result():
                failed = True
                print('Stopped new launches after', key, flush=True)
print('Completed', sum(finished(j) for j in jobs), 'of', len(jobs), flush=True)
sys.exit(int(failed))
