from pathlib import Path
import json,uuid,sys,urllib.request,urllib.error
d=Path(__file__).resolve().parent
root=d.parent.parent
def load(p):return json.loads(Path(p).read_text())
def save(p,x):Path(p).write_text(json.dumps(x,indent=2)+'\n')
def uid():return str(uuid.uuid4())
def api(route,body=None):
 req=urllib.request.Request('http://127.0.0.1:5191/api/mapping/evals'+route,None if body is None else json.dumps(body).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req) as f:return json.load(f)
 except urllib.error.HTTPError as e:raise ValueError(e.read().decode()) from e
stages=['core','p1','p2']
phase=sys.argv[1]
idx=3 if phase=='p3' else stages.index(phase)
old=d.parent/'core-to-canvas-2026-11-17'
seeds=load(old/'contexts-receipt.json')
if not (d/'ids.json').exists():
 save(d/'ids.json',{'experiment':uid(),'prompt':uid(),'stages':{s:{'update':uid(),'approval':uid(),'contexts':{c['key']:uid() for c in seeds},'runs':{c['key']:[uid() for _ in range(1 if s=='core' else 3)] for c in seeds}} for s in stages}})
ids=load(d/'ids.json')
stage=ids['stages'][phase]
names=['Core discovery','P1 · Generate canvas','P2 · Expand canvas']
eid=ids['experiment']
if idx==0:
 parent=api('/prompts/0b3af2dd-ba89-4032-936a-40070a3e167e')
 v=next(v for v in parent['versions'] if v['version']==4)
 p=api('/prompts',dict(requestId=ids['prompt'],name='Breadth-first core discovery',workflow='alternatives',templateBase=v['templateBase'],stages={'alternative':(d/'core-prompt.txt').read_text()},derivation={'kind':'variation','parent':{'promptId':parent['id'],'version':4},'dimension':{'id':'core-decomposition','name':'Core decomposition','value':'Breadth before depth'}}))
 pid=p['id']; version=1
 original=api('/experiments/08ccc7fa-8ea6-4cfa-b0b7-8819b7fcbf35')
 prepared=[next(c for c in original['cases'] if c['agentContextId']==s['parent']) for s in seeds]
 design=dict(name='Breadth-first core to canvas',description='Four breadth-first core trees, three P1 canvases per core tree, and three P2 expansions per repository from its first P1 canvas. Astra/high throughout.',tags=['core-discovery','canvas'],workflow={'id':'core-to-canvas','name':'Core discovery and canvas expansion','version':1,'stages':[{'id':s,'name':n,'dependsOn':stages[i-1:i] if i else []} for i,(s,n) in enumerate(zip(stages,names))]},phases=[{'id':s,'name':n} for s,n in zip(stages,names)],cases=[],inputLineage=[],conditions=[{'id':s,'name':n} for s,n in zip(stages,names)],samples=[],plannedRuns=[],comparisons=[])
else:
 pid=load(old/'prompt-receipt.json')['id'];version=min(idx,2)
 prompt=next(v for v in api('/prompts/'+pid)['versions'] if v['version']==version)
 assert prompt['stages']['alternative']==(old/('prompt.txt' if idx==1 else 'prompt-v2.txt')).read_text()
 current=api('/experiments/'+eid)
 design={k:current[k] for k in ['name','description','tags','workflow','phases','cases','conditions','samples','plannedRuns','comparisons','inputLineage']}
 prepared=load(d/(phase+'-contexts.json'))
 if phase=='p3':
  selection=load(d/'selection.json')['selections']
  chosen={r['repository']:r for r in selection}
  name='P3 · Second expansion'
  design['workflow']['stages'].append({'id':phase,'name':name,'dependsOn':['p2']})
  design['conditions'].append({'id':phase,'name':'Recursive expansion'})
  design['phases'].append({'id':phase,'name':name,'description':'An Astra/high reviewer selected one of three P2 canvases per repository. Each selected checkpoint feeds three independent expansions with the E14 recursive prompt v2.'})
  design['description']+=' A second recursive expansion generates three canvases per reviewer-selected P2 seed.'
for s,c in zip(seeds,prepared):
 key=s['key']; caseId=key+'-'+phase
 design['cases'].append({'id':caseId,'name':s['name'].split(' · ')[0] if idx==0 else s['name'].split(' · ')[0]+' · '+('core tree' if idx==1 else 'P1 sample 1' if idx==2 else 'P2 sample '+str(chosen[key]['sample'])),'agentContextId':c['agentContextId'],'contentHash':c['contentHash']})
 if idx:design['inputLineage'].append({'caseId':caseId,'agentContextId':c['agentContextId'],'sources':[c['source']]})
 for n,rid in enumerate(stage['runs'][key],1):
  sid=caseId+'-'+str(n)
  design['samples'].append({'id':sid,'phaseId':phase,'caseId':caseId,'conditionId':phase,'number':n,'attempt':1,'outputs':[]})
  design['plannedRuns'].append({'request':{'requestId':rid,'workflow':'alternatives','prompts':[{'promptId':pid,'version':version}],'inputs':{'context':{'agentContextId':c['agentContextId']}},'passes':1,'model':'gpt-6-astra','effort':'high'},'outputs':[{'sampleId':sid,'stageId':phase,'cellKey':pid+':1:alternative'}]})
req={'requestId':eid if not idx else stage['update'],'experiment':design}
if idx:req.update(experimentId=eid,expectedRevision=current['revision'])
r=api('/experiments',req)
assert r['id']==eid and len(r['generationReview']['runs'])==(12 if idx else 4)
save(d/(phase+'-plan.json'),{'experimentId':eid,'revision':r['revision'],'promptId':pid,'version':version})
print(r['id'],phase,r['revision'])
