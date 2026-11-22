"""Poll the live experiment, confirm outputs, and retain distinct recovery attempts."""
import datetime, hashlib, json, os, pathlib, subprocess, sys, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[3]
DIRECTORY = pathlib.Path(sys.argv[1]).resolve()
ONCE = '--once' in sys.argv
BASE = os.environ.get('EVALS_BASE_URL', 'http://127.0.0.1:5191')
CONFIG = json.loads((DIRECTORY/'config.json').read_text())

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(file, value):
    target=DIRECTORY/file; temp=target.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2)); temp.replace(target)
def call(script, *args):
    r=subprocess.run(['node','--import','tsx',f'scripts/evals/from-scratch/{script}',str(DIRECTORY),*args],cwd=ROOT,capture_output=True,text=True,timeout=180)
    if r.returncode: raise RuntimeError((r.stdout+r.stderr)[-6000:])
    return r.stdout.strip()
def alive(pid):
    try:
        os.kill(pid,0)
        return pathlib.Path(f'/proc/{pid}/stat').read_text().split()[2] != 'Z'
    except (ProcessLookupError,FileNotFoundError): return False

def restart(reason):
    stamps=sorted((DIRECTORY/'recovery').glob('launch-*.json')) if (DIRECTORY/'recovery').exists() else []
    number=len(stamps)+1
    (DIRECTORY/'recovery').mkdir(exist_ok=True)
    provenance={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'scripts/evals/from-scratch').glob('*')) if p.is_file()}
    with (DIRECTORY/'runner.log').open('ab',buffering=0) as log:
        process=subprocess.Popen(['node','--import','tsx','scripts/evals/from-scratch/run.ts',str(DIRECTORY)],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,close_fds=True)
    save(f'recovery/launch-{number:03}.json',{'pid':process.pid,'at':now(),'reason':reason,'runnerFiles':provenance})
    return process.pid

last_confirmed=-1; last_signature=None; consecutive_errors=0
while True:
    try:
        state=json.loads((DIRECTORY/'state.json').read_text())
        with urllib.request.urlopen(BASE+'/api/mapping/evals/experiments/'+CONFIG['id'],timeout=20) as response: experiment=json.load(response)
        completed=len(state.get('results',{})); audit=None
        if completed!=last_confirmed or state['status']=='finished':
            audit=call('confirm.ts'); last_confirmed=completed
        status={'checkedAt':now(),'status':state['status'],'activeJob':state.get('activeJob'),'activeJobs':state.get('activeJobs',[]),'completed':completed,'jobs':len(state['jobs']),'error':state.get('error'),'runnerAlive':alive(state['pid']),'apiRevision':experiment['revision'],'supervisorPid':os.getpid()}
        if audit: status['confirmation']=json.loads(audit)
        if not status['runnerAlive'] and state['status'] not in ('failed','cancelled','finished'):
            # Resume the coordinator first. Saved responses are replayed, not regenerated.
            status['action']='Restarted crashed coordinator for saved-response replay';status['newRunnerPid']=restart(status['action']);time.sleep(3)
        elif state['status']=='failed' and not status['runnerAlive']:
            error=state.get('error','')
            recoverable=any(text in error for text in ['Model process exited','Generation timed out','Invalid JSON response','Expected one ASCII tree root','Tree must be printable ASCII','Invalid edge anchor','Canvas diagrams must form a connected graph','Generated diagram positions overlap','Expansion requires central','Invalid source paths','Unknown reviewed path','Duplicate point IDs','Duplicate diagram IDs','Invalid point relationship','Invalid selection judge output','did not preserve the 3+1','"invalid_type"','"too_big"','"too_small"','"invalid_format"'])
            if recoverable:
                status['recovery']=json.loads(call('recover.ts'))
                status['action']='Prepared distinct paid recovery attempt under user authorization';status['newRunnerPid']=restart(status['action']);time.sleep(3)
            else:
                status['needsAttention']='Infrastructure or unclassified failure; saved response needs investigation before another paid call.'
        elif state['status']=='cancelled':
            status['needsAttention']='Explicit cancellation retained; no automatic restart.'
        consecutive_errors=0
        save('supervisor-status.json',status)
        signature=(status['status'],tuple(status.get('activeJobs',[])),status.get('activeJob'),completed,status.get('error'),status.get('action'),status.get('needsAttention'))
        if signature!=last_signature: print(json.dumps(status),flush=True);last_signature=signature
        if state['status']=='finished':
            confirmed=json.loads((DIRECTORY/'confirmed-outputs.json').read_text())
            if confirmed['totalConfirmed']!=completed:raise RuntimeError('Final output confirmation count does not match completed jobs')
            retained=[j for j in state['jobs'] if j['key'] in state.get('results',{}) and not j.get('supersededReason')]
            critiques=[j for j in retained if j['stage']=='critique']
            if len(critiques)!=len(state.get('selected',[]))*9:raise RuntimeError('Final whole-phase critique count does not match three phases and three rounds per selected variant')
            save('final-confirmation.json',{'finishedAt':now(),'experimentId':CONFIG['id'],'selectedVariants':state.get('selected'),'confirmedOutputs':completed,'retainedOutputs':len(retained),'supersededCompletedOutputs':completed-len(retained),'improvementCritiques':len(critiques),'judgeScope':'all phase outputs and all final canvases per variant','status':'finished and API-confirmed'})
            break
        if status.get('needsAttention'): break
    except Exception as error:
        consecutive_errors+=1
        status={'checkedAt':now(),'supervisorPid':os.getpid(),'needsAttention':str(error),'consecutiveErrors':consecutive_errors}
        save('supervisor-status.json',status);print(json.dumps(status),flush=True)
        if consecutive_errors>=3:break
    if ONCE:break
    time.sleep(30)
