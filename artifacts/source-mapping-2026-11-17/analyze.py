import json,pathlib,statistics,collections,sys,datetime
D=pathlib.Path(__file__).parent
v2='--v2' in sys.argv
plan=json.loads((D/('v2-plan.json' if v2 else 'plan.json')).read_text());rows=[]
for j in plan['jobs']:
 p=D/'jobs'/j['key']; s=p/'status.json'
 if not s.exists():continue
 status=json.loads(s.read_text());row={**j,**status}
 if status['status']=='finished':
  inp=json.loads((D/(j['caseId']+'-input.json')).read_text());out=json.loads((p/'mapping.json').read_text());response=json.loads((p/'response.json').read_text())
  lengths=[];mapped=set();ranges=set();nodes={}
  checks=p/'validation-checks.jsonl'
  validations=[json.loads(l) for l in checks.read_text().splitlines()] if checks.exists() else []
  row.update(validationCalls=len(validations),invalidCandidates=sum(not v['valid'] for v in validations))
  runpath=D.parent.parent/'.diagrams-local/canvas-domain-model/eval-runs'/(j['runId']+'.json')
  if runpath.exists():
   run=json.loads(runpath.read_text());cell=run['cells'][0]
   if cell.get('startedAt') and cell.get('completedAt'):
    row['durationSeconds']=(datetime.datetime.fromisoformat(cell['completedAt'].replace('Z','+00:00'))-datetime.datetime.fromisoformat(cell['startedAt'].replace('Z','+00:00'))).total_seconds()
  for d in inp['diagrams']:
   for n in d['nodes']:nodes[(d['diagramId'],n['ref'])]=n
  for d in out['diagrams']:
   for m in d['mappings']:
    mapped.add((d['diagramId'],m['node']));ranges.add((d['diagramId'],m['node'],m['path'],m['startLine'],m['endLine']));lengths.append(m['endLine']-m['startLine']+1)
  inherited=0
  for d in inp['diagrams']:
   byid={n['id']:n for n in d['nodes']}
   for n in d['nodes']:
    while n:
     if (d['diagramId'],n['ref']) in mapped:inherited+=1;break
     n=byid.get(n.get('parentId'))
  row.update(totalTokens=response.get('usage',{}).get('totalTokens',0),uncachedInput=response.get('usage',{}).get('input',0),cachedInput=response.get('usage',{}).get('cacheRead',0))
  row.update(directCoverage=len(mapped)/len(nodes),resolvedCoverage=inherited/len(nodes),medianRangeLines=statistics.median(lengths) if lengths else 0,maxRangeLines=max(lengths,default=0),duplicateRanges=len(lengths)-len(ranges),usage=response.get('usage'),notes=out['notes'])
 rows.append(row)
groups=[]
for kind in ['core','canvas']:
 for effort in ['low','medium','high']:
  rs=[r for r in rows if r['caseId'].startswith(kind+'-') and r['effort']==effort and r['status']=='finished']
  if not rs:continue
  groups.append(dict(kind=kind,effort=effort,finished=len(rs),**{k:round(statistics.mean(r[k] for r in rs),3) for k in ['directCoverage','resolvedCoverage','ranges','sourceLines','medianRangeLines','maxRangeLines','duplicateRanges','validationCalls','invalidCandidates','durationSeconds','totalTokens','uncachedInput','cachedInput']}))
report={'experimentId':plan['experimentId'],'total':len(plan['jobs']),'statuses':dict(collections.Counter(r['status'] for r in rows)),'groups':groups,'rows':rows}
(D/('v2-analysis.json' if v2 else 'analysis.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='rows'},indent=2))
