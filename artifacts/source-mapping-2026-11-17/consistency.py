import json,pathlib,itertools,statistics
D=pathlib.Path(__file__).parent;plan=json.loads((D/'v2-plan.json').read_text());groups={}
for j in plan['jobs']:
 p=D/'jobs'/j['key']/'mapping.json'
 if not p.exists():continue
 o=json.loads(p.read_text());nodes={}
 for d in o['diagrams']:
  for m in d['mappings']:nodes.setdefault((d['diagramId'],m['node']),set()).update((m['path'],n) for n in range(m['startLine'],m['endLine']+1))
 groups.setdefault((j['caseId'],j['effort']),[]).append((j['number'],nodes))
rows=[]
for (case,effort),samples in groups.items():
 if len(samples)!=3:continue
 for (a,A),(b,B) in itertools.combinations(samples,2):
  common=A.keys()&B.keys();union=A.keys()|B.keys()
  iou=lambda n:len(A.get(n,set())&B.get(n,set()))/len(A.get(n,set())|B.get(n,set()))
  rows.append(dict(caseId=case,effort=effort,a=a,b=b,mappedNodeJaccard=len(common)/len(union) if union else 1,sourceLineIoU=statistics.mean(iou(n) for n in union) if union else 1,commonNodeSourceIoU=statistics.mean(iou(n) for n in common) if common else 0))
(D/'consistency.json').write_text(json.dumps(rows,indent=2)+'\n')
for kind in ['core','canvas']:
 for e in ['low','medium','high']:
  rs=[r for r in rows if r['caseId'].startswith(kind+'-') and r['effort']==e]
  if rs:print(kind,e,len(rs),'pairs',*(f'{k}={statistics.mean(r[k] for r in rs):.3f}' for k in ['mappedNodeJaccard','sourceLineIoU','commonNodeSourceIoU']))
