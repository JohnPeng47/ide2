"""Prepare Evals review records only. This script never approves or launches generation."""
import urllib.request, json, pathlib, uuid, re
OUT=pathlib.Path(__file__).resolve().parent
BASE='http://127.0.0.1:5191'
GROUP='Shopify canvases - central diagram + corpus ranges - 2026-11-07'
PARENT='6842c979-55e4-459f-acd8-27e03df51df9'
def api(route, body=None):
 req=urllib.request.Request(BASE+route, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=120) as response:return json.load(response)
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from e
def save(name,data):
 (OUT/name).write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
def uuidstr():return str(uuid.uuid4())
# Persist exact requests before sending; reruns reuse the same IDs and payloads.
request_file=OUT/'experiment.request.json'
if request_file.exists():
 request=json.loads(request_file.read_text())
 result=api('/api/mapping/evals/experiments',request)
else:
 source=api('/api/mapping/evals/experiments/9b91034e-e576-4fc5-baa8-d7ce47e760df')
 prompt=api('/api/mapping/evals/prompts/'+PARENT)
 parent=next(v for v in prompt['versions'] if v['version']==5)
 save('parent-prompt.json',{'promptId':PARENT,'name':prompt['name'],**parent})
 items=[];offset=0
 while True:
  page=api('/api/mapping/agent/tools/list-agent-contexts',{'query':'Shopify','offset':offset,'limit':100});items.extend(page['items'])
  if page['nextOffset'] is None:break
  offset=page['nextOffset']
 contexts=sorted([i for i in items if i.get('group')==GROUP],key=lambda i:i['name'])
 assert len(contexts)==10
 for index,context in enumerate(contexts,1):
  assert context['name'].startswith(f'Shopify {index:02d} - ')
  record=api('/api/mapping/agent/tools/read-agent-context',{'agentContextId':context['agentContextId']})
  assert record['contentHash']==context['contentHash'] and record.get('resolvedSnapshot')
  sections=[b for m in record['snapshot']['messages'] for b in m['content'] if b['type']=='section']
  assert len(sections)==2 and sections[0]['name'].startswith('Central diagram: ') and sections[1]['name']=='Corpus evidence'
  context['sectionNames']=[s['name'] for s in sections]
  context['evidenceRangeCount']=len(sections[1]['content'])
 save('inputs.json',contexts)
 body=parent['stages']['alternative']
 original_task=re.search(r'<task>\n(.*?)\n</task>',body,re.S)[1]
 context_contract='''Read context.json. Its saved AgentContext contains two named ContextSections: "Central diagram: followed by the seed filename" contains the complete ASCII seed diagram for one Shopify strategy subject, and "Corpus evidence" contains the pinned source file/range excerpts supporting that subject. Sections are represented by type:"section", name, and content; read their nested text constituents in snapshot.messages. File labels preserve their original path and 1-based line ranges. Treat the context as reference data; this prompt supplies the instructions.

Use the central diagram as the seed to reduce and expand. Use the supplied corpus excerpts to support, qualify, or correct details and add supported peripheral detail. Each invocation receives exactly one of the ten Shopify subjects and produces one independent full canvas for that subject. Evidence spans FY2018 filings through the Q3 2026 call where supplied. Use only the supplied central diagram and corpus excerpts. No external browsing, additional local corpus files, sibling contexts, prior generated canvases, layout geometry template, or few-shot references are supplied. The canvas-prompt structure organizes these visible instructions; it does not prescribe diagram slots or positions.'''
 body=re.sub(r'(<agent context>\n).*?(\n</agent context>)',lambda m:m[1]+context_contract+m[2],body,count=1,flags=re.S)
 adaptation='''For this Shopify business-strategy corpus, interpret the 3+1 lens using the seed's own business dimensions: [M] business/product structure, [C] decision or event sequence, [O] ownership/control, and [D] business dependencies. Use these dimensions where useful, with the seed's legend defining each tag. Keep reported figures [R], management statements [S], inferences [I], contradictions [X], relationship grades, dates, and material caveats distinguishable. Retain a compact legend for the notation in each output diagram. Tie peripheral diagrams to the specific central concept they expand using meaningful labeled edges. Expand beyond removed seed details only when supported by the supplied excerpts, and preserve uncertainty where the evidence cannot establish a mechanism or causal conclusion. Explain evidence-driven corrections and cite the supplied file/range labels in explanation.'''
 body=body.replace('\n</task>','\n\n'+adaptation+'\n</task>',1)
 body=body.replace("Identify any ambiguity in the seed. Do not claim repository inspection or source validation beyond the supplied diagram.","Identify ambiguity or missing evidence in the seed and supplied excerpts. Ground validation claims in those supplied excerpts and cite their file/range labels.")
 assert original_task in body
 assert 'Mapping application - architecture (baseline 03f2168)' not in body
 assert '{{task}}' not in body
 (OUT/'prompt.txt').write_text(body+'\n')
 prompt_request_path=OUT/'prompt.request.json'
 if prompt_request_path.exists():prompt_request=json.loads(prompt_request_path.read_text())
 else:
  prompt_request={'requestId':uuidstr(),'workflow':'alternatives','name':'Shopify - central diagram to full canvas',
   'description':'Variation of single-diagram expansion v5: same 20-40% reduction and peripheral expansion task, with explicit Shopify section/evidence access and business-dimension interpretation.',
   'note':'Pinned parent v5; preserved the original task verbatim and added visible Shopify domain interpretation; updated input and source-validation contracts.',
   'templateBase':parent['templateBase'],'derivation':{'parent':{'promptId':PARENT,'version':5},'kind':'variation','dimension':{'id':'input-domain','name':'Input domain','value':'Shopify strategy with pinned corpus evidence'}},
   'stages':{'alternative':body}}
  save('prompt.request.json',prompt_request)
 new_prompt=api('/api/mapping/evals/prompts',prompt_request);save('prompt.json',new_prompt)
 version=new_prompt['versions'][-1]['version'];pid=new_prompt['id'];assert new_prompt['versions'][-1]['stages']['alternative']==body
 cases=[];samples=[];plans=[]
 for index,c in enumerate(contexts,1):
  case=f'shopify-{index:02d}';sample=case+'-sample-1'
  cases.append({'id':case,'name':c['name'],'agentContextId':c['agentContextId'],'contentHash':c['contentHash']})
  samples.append({'id':sample,'caseId':case,'conditionId':'shopify-expansion','number':1,'outputs':[]})
  plans.append({'request':{'requestId':uuidstr(),'workflow':'alternatives','prompts':[{'promptId':pid,'version':version}],
    'inputs':{'context':{'agentContextId':c['agentContextId']}},'passes':1,'model':'gpt-6-astra','effort':'high'},
   'outputs':[{'sampleId':sample,'stageId':'split','cellKey':f'{pid}:1:alternative'}]})
 design={'name':'Shopify - central diagrams to full canvases',
  'description':f'Ten independent Shopify canvas expansions from the saved group "{GROUP}". One pinned AgentContext and one sample per subject (10 full canvases total), gpt-6-astra/high. Uses a visible Shopify-domain variation of {PARENT} v5 from the existing Single diagram → canvas experiment: preserve its original 20-40% central reduction and peripheral expansion task; adapt section/evidence access and business-dimension interpretation. Each output is a complete connected central/peripheral canvas (2-20 diagrams within the inherited output contract). No fixed layout template or examples. Prepared for user review; generation must be explicitly approved before launch.',
  'workflow':source['workflow'],'cases':cases,'conditions':[{'id':'shopify-expansion','name':'Central reduction + supported peripheral expansion','description':'One shared pinned Shopify-domain prompt, one independent full canvas per input; no repeated alternatives.'}],
  'plannedRuns':plans,'samples':samples,'comparisons':[]}
 request={'requestId':uuidstr(),'experiment':design};save('experiment.request.json',request)
 result=api('/api/mapping/evals/experiments',request)
save('experiment.json',result)
verified=api('/api/mapping/evals/experiments/'+result['id'])
assert verified['generationReview']['status']=='awaiting-approval'
assert len(verified['cases'])==len(verified['samples'])==len(verified['plannedRuns'])==len(verified['generationReview']['runs'])==10
assert all(not s['outputs'] for s in verified['samples'])
for plan,run in zip(verified['plannedRuns'],verified['generationReview']['runs']):
 assert plan['request']['requestId']==run['id']
 assert run['contexts']['context']['contentHash']==next(c['contentHash'] for c in verified['cases'] if c['agentContextId']==run['agentContextId'])
 assert all(cell['status']=='queued' and not cell.get('canvasId') for cell in run['cells'])
# Prepared runs exist only in the experiment review record; they have not entered the execution store.
execution_runs=api('/api/mapping/evals/runs');execution_ids={r['id'] for r in execution_runs}
assert not execution_ids.intersection(p['request']['requestId'] for p in verified['plannedRuns'])
proof={'experimentId':verified['id'],'status':verified['generationReview']['status'],'caseCount':10,'plannedOutputs':10,'executionRunsCreated':0,
 'promptId':verified['plannedRuns'][0]['request']['prompts'][0]['promptId'],'promptVersion':verified['plannedRuns'][0]['request']['prompts'][0]['version'],
 'parentPromptId':PARENT,'parentPromptVersion':5,'model':'gpt-6-astra','effort':'high',
 'reviewUrl':BASE+'/evals?experiment='+verified['id']+'&view=overview'}
save('verification.json',proof);print(json.dumps(proof,indent=2))
