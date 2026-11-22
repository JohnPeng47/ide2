import json,uuid,sys,urllib.request,urllib.error
from pathlib import Path
d=Path(__file__).resolve().parent; root=d.parent
def load(p):return json.loads(Path(p).read_text())
def save(p,x):Path(p).write_text(json.dumps(x,indent=2)+'\n')
def uid():return str(uuid.uuid4())
def api(route,body=None):
 req=urllib.request.Request('http://127.0.0.1:5191/api/mapping/evals'+route,None if body is None else json.dumps(body).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req) as f:return json.load(f)
 except urllib.error.HTTPError as e:raise ValueError(e.read().decode()) from e
keys=['modular','call','ownership','data']; names=load(d/'names.json')
if not (d/'ids.json').exists():
 save(d/'ids.json',{'prompts':{k:uid() for k in keys},'contexts':{k:uid() for k in keys},'runs':{k:[uid(),uid()] for k in keys},'update':uid(),'approval':uid()})
ids=load(d/'ids.json')
PARENT={'promptId':'a46e491f-784a-4c4e-9b6e-a85356723da3','version':2}
if sys.argv[1]=='prompts':
 pv=next(v for v in api('/prompts/'+PARENT['promptId'])['versions'] if v['version']==2)
 rec={}
 for k in keys:
  text=(d/f'{k}.txt').read_text(); name=f'Expand core canvas · {names[k]}'
  r=api('/prompts',dict(requestId=ids['prompts'][k],name=name,workflow='alternatives',templateBase=pv['templateBase'],stages={'alternative':text},
    derivation={'kind':'variation','parent':PARENT,'dimension':{'id':'relationship-view','name':'Relationship view','value':names[k]}}))
  assert r['id']==ids['prompts'][k] and r['versions'][0]['stages']['alternative']==text
  rec[k]={'promptId':r['id'],'version':1,'name':name}
 save(d/'prompt-receipts.json',rec); print('prompts saved')
if sys.argv[1]=='experiment':
 eid=load(root/'ids.json')['experiment']; rec=load(d/'prompt-receipts.json'); ctx=load(d/'contexts.json')
 cur=api('/experiments/'+eid)
 design={k:cur[k] for k in ['name','description','tags','workflow','phases','cases','conditions','samples','plannedRuns','comparisons','inputLineage']}
 if any(p['id']=='expand' for p in design['phases']): sys.exit('already added')
 design['description']+=' An expand phase restructures sample 1 of each view (existing few-shot variant) into a canvas with a per-view version of the recursive expand prompt (Restructure core component into canvas v2), two samples each.'
 design['workflow']['stages'].append({'id':'expand','name':'Expand canvas','dependsOn':['core']})
 design['phases'].append({'id':'expand','name':'Expand canvas','description':'Each view\'s core tree (existing few-shot examples, sample 1) becomes a one-diagram canvas, restructured by the expand prompt rewritten for that view: vertical depth follows the view\'s own relation, and the before/after example is redrawn in that view.'})
 design['conditions'].append({'id':'expand-per-view','name':'Per-view expand prompt','description':'Restructure core component into canvas v2 with framing, example and expansion wording rewritten for each 3+1 view.'})
 for k in keys:
  c=ctx[k]; cid=f'ghostty-{k}-canvas'
  design['cases'].append({'id':cid,'name':f'{names[k]} · core tree','agentContextId':c['agentContextId'],'contentHash':c['contentHash']})
  design['inputLineage'].append({'caseId':cid,'agentContextId':c['agentContextId'],'sources':[c['source']]})
  for n,rid in enumerate(ids['runs'][k],1):
   sid=f'{cid}-{n}'
   design['samples'].append({'id':sid,'phaseId':'expand','caseId':cid,'conditionId':'expand-per-view','number':n,'attempt':1,'outputs':[]})
   design['plannedRuns'].append({'request':{'requestId':rid,'workflow':'alternatives','prompts':[{'promptId':rec[k]['promptId'],'version':1}],'inputs':{'context':{'agentContextId':c['agentContextId']}},'passes':1,'model':'gpt-6-astra','effort':'high'},'outputs':[{'sampleId':sid,'stageId':'expand','cellKey':rec[k]['promptId']+':1:alternative'}]})
 r=api('/experiments',{'requestId':ids['update'],'experimentId':eid,'expectedRevision':cur['revision'],'experiment':design})
 save(d/'plan.json',{'experimentId':eid,'revision':r['revision'],'review':r['generationReview']['status']})
 print(r['revision'],r['generationReview']['status'],len(r['generationReview']['runs']))
