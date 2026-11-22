from pathlib import Path
from collections import Counter
import json,urllib.request
d=Path(__file__).resolve().parent
ids=json.loads((d/'ids.json').read_text())
base='http://127.0.0.1:5191/api/mapping/evals/experiments/'+ids['experiment']
def request(url,body=None):
 return json.load(urllib.request.urlopen(urllib.request.Request(url,None if body is None else json.dumps(body).encode(),{'Content-Type':'application/json'})))
experiment=request(base)
overview=request(base+'/overview')
def walk(node):
 yield node
 for child in node.get('children',[]):yield from walk(child)
refs={}
for node in walk(overview['root']):
 for action in node.get('actions',[]):
  if action['label']=='output' and 'sampleId' in node.get('source',{}):
   for ref in action['refs']:refs[ref]=node['source']['sampleId']
counts=Counter()
out={}
for start in range(0,len(refs),4):
 batch=request(base+'/read',{'refs':list(refs)[start:start+4]})
 for r in batch['results']:
  assert r['status']=='ok' and r['value']['kind']=='output'
  result=r['value']['result']
  assert len(result['canvases'])==1
  sid=refs[r['ref']]
  sample=next(s for s in experiment['samples'] if s['id']==sid)
  assert len(sample['outputs'])==1
  phase=sample['phaseId']
  rid=sample['outputs'][0]['runId']
  repo=sample['caseId'].split('-')[0]
  run=json.loads((d.parent.parent/'.diagrams-local/canvas-domain-model/eval-runs'/(rid+'.json')).read_text())
  assert run['status']=='finished' and run['request']['model']=='gpt-6-astra' and run['request']['effort']=='high'
  assert len(run['cells'])==1 and run['cells'][0]['execution']['sessionId']
  assert ids['stages'][phase]['runs'][repo][sample['number']-1]==rid
  counts[phase]+=1
  out[sid]={'runId':rid,'sessionId':run['cells'][0]['execution']['sessionId'],'diagrams':len(result['canvases'][0]['proposed']['document']['scene']['contents'])}
complete={'core':4,'p1':12,'p2':12}
selection={}
if any(s['phaseId']=='p3' for s in experiment['samples']):
 complete['p3']=12
 selection={s['repository']:s for s in json.loads((d/'selection.json').read_text())['selections']}
assert counts==complete and len(set(x['sessionId'] for x in out.values()))==sum(complete.values())
assert len(experiment['inputLineage'])==4*(len(complete)-1)
for edge in experiment['inputLineage']:
 repo,phase=edge['caseId'].split('-')
 prev={'p1':'core','p2':'p1','p3':'p2'}[phase]
 sample=selection[repo]['sample'] if phase=='p3' else 1
 assert len(edge['sources'])==1
 source=edge['sources'][0]
 assert source['experimentId']==ids['experiment'] and source['runId']==ids['stages'][prev]['runs'][repo][sample-1]
 manifest=json.loads((d.parent.parent/'.diagrams-local/canvas-domain-model/canvas-timelines'/(source['runId']+'.json')).read_text())
 assert manifest['steps'][0]['canvases'][0]['checkpointId']==source['checkpointId']
report={'experimentId':ids['experiment'],'verifiedOutputs':counts,'verifiedInputLinks':len(experiment['inputLineage']),'samples':out}
(d/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(counts))
