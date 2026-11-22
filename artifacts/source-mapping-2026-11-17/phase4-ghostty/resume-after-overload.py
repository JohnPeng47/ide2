import fcntl,json,pathlib,subprocess,tempfile,time
here=pathlib.Path(__file__).resolve().parent
def run_one(key):
    with tempfile.TemporaryDirectory(prefix='mapping-phase4-',dir=pathlib.Path.home()/'.cache') as scratch:
        return subprocess.run(['bwrap','--die-with-parent','--bind','/','/','--dev-bind','/dev','/dev','--proc','/proc','--tmpfs','/tmp','--setenv','TMPDIR',scratch,'node','--import','tsx',str(here/'worker.ts'),key],cwd=here).returncode
key='ghostty-v3-core-3-sol-6-2-high-scoped-1-attempt-3'
time.sleep(15)
for delay in (60,120,None):
    if run_one(key)==0:break
    if delay is None:raise SystemExit(1)
    subprocess.run(['node','--import','tsx','retry-overload.ts',key],cwd=here,check=True)
    key=next(j['key'] for j in json.loads((here/'resume-plan.json').read_text())['jobs'] if 'core-3-sol' in j['key'] and j['number']==1)
    time.sleep(delay)
with (here/'launch.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
raise SystemExit(subprocess.call(['python','-u','launch.py','--all'],cwd=here))
