"""Add a review-only Phase 2. Never approve, launch, or mutate canvas outputs."""
import json, pathlib, uuid, urllib.request, urllib.error
OUT=pathlib.Path(__file__).resolve().parent
BASE='http://127.0.0.1:5191/api/mapping/evals'
ID='2c9f0ce0-2b7e-42cb-aa4d-a2302f13fd08'
def api(path,body=None):
 req=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from e
def save(name,value): (OUT/name).write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
task='''Okay we are gonna add inter-canvas links between the different canvases. A note on the topology of the inter-canvas connections:
- while the canvas interface is consisdered a flat structure, u should consider the relative importance of canvases as a graph navigational problem with the starting root node at the first diagram, and optimizing for minimum distance between both importance and compositional hierarchy

Take the Shopify Company Map diagram and re-generate / modify it so that it has *some* connection to the other canvases via an inter-canvas jump.'''
contract='''Review draft only; no generation is scheduled for this phase.

Inputs: the exact saved Phase 1 output checkpoints for all ten subjects, with Shopify Company Map (01) as the root. Pin the completed output set before preparing execution. Buyer Network (04) currently has no successful output; resolve that missing input before running the full ten-canvas phase.

Interpretation for review: modify the Company Map central diagram into a navigational starting point. Keep important canvases close to the root and route finer detail through its containing subject where useful. Make all included canvases reachable from the root; use selective direct links and explain choices, rather than assuming every canvas needs a direct root link. Navigational importance is not a causal or evidential claim. Preserve evidence tags, relation grades, dates, uncertainty, and the meaning of existing canvases.

Links: create actual inter-canvas jumps on meaningful single-line text spans, using 1-based inclusive line/startColumn/endColumn and the current source revision. Target the saved canvas representation ID; include a target diagram or concept focus when useful. Recalculate spans after text changes and preserve existing jumps when replacing a jump list.

Output: one frozen output containing the entire linked canvas set, ordered with Company Map first, including unchanged target canvases so every jump resolves inside the saved output. Preserve the original Phase 1 outputs as baselines. Include a short rationale for the topology and check reachability from the root and validity of every link span and target. No layout template or few-shot examples. No new external evidence.

Execution gap: the existing Alternatives generation schema produces one canvas and has no inter-canvas jump output contract. The multi-canvas Evals viewer exists, but the generator/executor must be connected to it before this draft can become a runnable plan. Do not submit this task through the single-canvas Alternatives schema.'''
(OUT/'task.v1.txt').write_text(task+'\n\n'+contract+'\n')
old=api('/experiments/'+ID);save('experiment.before.json',old)
runs=api('/runs');by_id={r['id']:r for r in runs}
inputs=[]
for sample in old['samples']:
 for output in sample['outputs']:
  run=by_id[output['runId']];cell=next(c for c in run['cells'] if c['key']==output['cellKey'])
  inputs.append({'sampleId':sample['id'],'caseId':sample['caseId'],**output,**{k:cell.get(k) for k in ['status','canvasId','checkpointId']}})
save('phase-1-inputs.json',inputs)
assert not old.get('phases'), 'Already phased: reread and deliberately merge rather than overwrite.'
keys=['name','description','workflow','cases','conditions','plannedRuns','samples','comparisons']
design={k:old[k] for k in keys if k in old}
design['phases']=[{'id':'phase-1','name':'Independent canvas generation','description':'Original ten independent Shopify canvas expansions; original prompt versions, pinned inputs, run IDs and outputs retained.'},{'id':'phase-2','name':'Inter-canvas navigation — draft','description':task+'\n\n'+contract}]
for sample in design['samples']:sample['phaseId']='phase-1'
for comparison in design['comparisons']:comparison['phaseId']='phase-1'
# No placeholder run or misleading single-subject case: this is one future aggregate output.
request={'requestId':str(uuid.uuid4()),'experimentId':ID,'expectedRevision':old['revision'],'experiment':design}
save('experiment.request.json',request)
result=api('/experiments',request);save('experiment.json',result)
verified=api('/experiments/'+ID)
assert len(verified['phases'])==2
assert verified['plannedRuns']==old['plannedRuns']
assert [{k:v for k,v in s.items() if k!='phaseId'} for s in verified['samples']]==[{k:v for k,v in s.items() if k!='phaseId'} for s in old['samples']]
assert {r['id'] for r in api('/runs')}==set(by_id), 'Unexpected concurrent run change; inspect before claiming no new runs.'
proof={'experimentId':ID,'revision':verified['revision'],'phase2':'draft','phase2RunsCreated':0,'phase1SuccessfulOutputs':sum(i['status']=='finished' for i in inputs),'phase1MissingOutputs':[i['caseId'] for i in inputs if i['status']!='finished'],'reviewUrl':BASE.replace('/api/mapping/evals','')+'/evals?experiment='+ID+'&view=overview&phase=phase-2'}
save('verification.json',proof);print(json.dumps(proof,indent=2))
