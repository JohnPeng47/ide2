from pathlib import Path
import json,uuid,urllib.request,urllib.error
d=Path(__file__).resolve().parent
def load(p):return json.loads(Path(p).read_text())
def save(p,x):Path(p).write_text(json.dumps(x,indent=2)+'\n')
def uid():return str(uuid.uuid4())
def api(route,body=None):
 req=urllib.request.Request('http://127.0.0.1:5191/api/mapping/evals'+route,None if body is None else json.dumps(body).encode(),{'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req) as f:return json.load(f)
 except urllib.error.HTTPError as e:raise ValueError(e.read().decode()) from e
views=load(d/'views.json'); keys=['modular','call','ownership','data']
variants=[('examples','Existing few-shot examples','Each view prompt keeps the parent\'s two few-shot examples and their usage notes; only the ownership-specific note to nest operations under their owning part is removed.'),
          ('no-examples','No few-shot examples','Same view prompts with the few-shot block and its usage notes removed.')]
if not (d/'ids.json').exists():
 save(d/'ids.json',{'experiment':uid(),'prompts':{f'{k}-{v}':uid() for k in keys for v,_,_ in variants},'runs':{f'{k}-{v}':uid() for k in keys for v,_,_ in variants}})
ids=load(d/'ids.json')
PARENT={'promptId':'aa99c302-b7f5-46de-80d5-f7224b19cc2b','version':1}
parent=api('/prompts/'+PARENT['promptId']); pv=next(v for v in parent['versions'] if v['version']==1)
assert pv['stages']['alternative']==(d.parent/'breadth-first-core-to-canvas-2026-11-18/core-prompt.txt').read_text()
receipts={}
for k in keys:
 for v,_,_ in variants:
  key=f'{k}-{v}'; text=(d/'prompts'/f'{key}.txt').read_text()
  if v=='examples':
   name=f"Core view · {views[k]['name']}"
   der={'kind':'variation','parent':PARENT,'dimension':{'id':'relationship-view','name':'Relationship view','value':views[k]['name']}}
  else:
   name=f"Core view · {views[k]['name']} · no examples"
   der={'kind':'variation','parent':{'promptId':ids['prompts'][f'{k}-examples'],'version':1},'dimension':{'id':'few-shot-examples','name':'Few-shot examples','value':'None'}}
  r=api('/prompts',dict(requestId=ids['prompts'][key],name=name,workflow='alternatives',templateBase=pv['templateBase'],stages={'alternative':text},derivation=der))
  assert r['id']==ids['prompts'][key] and r['versions'][0]['stages']['alternative']==text
  receipts[key]={'promptId':r['id'],'version':1,'name':name,'contentHash':r['versions'][0]['contentHash']}
save(d/'prompt-receipts.json',receipts)
ctx={'agentContextId':'saved-agent-context-29fbdd95-72d4-4dc1-ad7c-a1b0f8cd7da6','contentHash':'c26f9e1d07185d26d78fd7cf31b447b58604b2cae4a040b1dc623aaaf9e7848a'}
design=dict(name='3+1 Model Core Component',
 description='Ghostty core component decomposed separately along each 3+1 view (modular structure, call, ownership, data dependency), one tree per view. Each view prompt replaces the task section of Breadth-first core discovery v1, which combined modules and ownership. Two variants: with the existing few-shot examples and without any. Astra/high, one sample per view and variant, same pinned Ghostty context as the earlier core run.',
 tags=['core-discovery','3+1'],
 workflow={'id':'core-views','name':'3+1 core views','version':1,'stages':[{'id':'core','name':'Core view','dependsOn':[]}]},
 phases=[{'id':'core','name':'Core views','description':'One ASCII tree per 3+1 view of the Ghostty core.'}],
 cases=[{'id':f'ghostty-{k}','name':views[k]['name'],**ctx} for k in keys],
 conditions=[{'id':v,'name':n,'description':desc} for v,n,desc in variants],
 samples=[],plannedRuns=[],comparisons=[],inputLineage=[])
for v,_,_ in variants:
 for k in keys:
  key=f'{k}-{v}'; sid=f'ghostty-{k}-{v}-1'; p=receipts[key]
  design['samples'].append({'id':sid,'phaseId':'core','caseId':f'ghostty-{k}','conditionId':v,'number':1,'attempt':1,'outputs':[]})
  design['plannedRuns'].append({'request':{'requestId':ids['runs'][key],'workflow':'alternatives','prompts':[{'promptId':p['promptId'],'version':1}],'inputs':{'context':{'agentContextId':ctx['agentContextId']}},'passes':1,'model':'gpt-6-astra','effort':'high'},'outputs':[{'sampleId':sid,'stageId':'core','cellKey':p['promptId']+':1:alternative'}]})
r=api('/experiments',{'requestId':ids['experiment'],'experiment':design})
assert r['id']==ids['experiment']
save(d/'plan.json',{'experimentId':r['id'],'revision':r['revision'],'review':r['generationReview']['status'],'runs':len(r['generationReview']['runs'])})
print(r['id'],r['revision'],r['generationReview']['status'],len(r['generationReview']['runs']))
