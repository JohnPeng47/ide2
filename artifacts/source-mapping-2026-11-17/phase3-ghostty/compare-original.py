"""Extend the previous pane's v2 -> v3 comparison on its 68 unchanged canvas nodes.
Core diagrams 1/2 have no identical v2 whole-input baseline. Canvas surrounding
context differs between v2 (3 diagrams) and v3/v4 (5), so this is observational.
"""
import collections
import json
from pathlib import Path
import statistics

here=Path(__file__).resolve().parent;old=here.parent;previous=old/'phase2-ghostty'
p2=json.loads((previous/'plan.json').read_text());p3=json.loads((here/'plan.json').read_text());v2=json.loads((old/'v2-plan.json').read_text())
original=json.loads((old/'canvas-ghostty-input.json').read_text());diagram_ids={'d1','d3'}
for number in [1,2]:
 current=json.loads((here/f'ghostty-v3-canvas-{number}-input.json').read_text())
 assert current['repo']['commit']==original['repo']['commit']
 for did in diagram_ids:
  before=next(d for d in original['diagrams'] if d['diagramId']==did);after=next(d for d in current['diagrams'] if d['diagramId']==did)
  assert before['ascii']==after['ascii']
  assert [(n['ref'],n['label'],n['line']) for n in before['nodes']]==[(n['ref'],n['label'],n['line']) for n in after['nodes']]
node_count=sum(len(d['nodes']) for d in original['diagrams'] if d['diagramId'] in diagram_ids);assert node_count==68
rows=[];groups=collections.defaultdict(list)
for version,directory,jobs in [('v2',old,[j for j in v2['jobs'] if j['caseId']=='canvas-ghostty']),('v3',previous,[j for j in p2['jobs'] if j['caseId'] in ['ghostty-v3-canvas-1','ghostty-v3-canvas-2']]),('v4',here,[j for j in p3['jobs'] if j['kind']=='canvas'])]:
 for job in jobs:
  folder=directory/'jobs'/job['key'];file=folder/'mapping.json'
  if not file.exists():continue
  m=json.loads(file.read_text());ranges=[(d['diagramId'],x) for d in m['diagrams'] if d['diagramId'] in diagram_ids for x in d['mappings']];nodes={(did,x['node']) for did,x in ranges};sizes=[x['endLine']-x['startLine']+1 for _,x in ranges]
  unique=collections.defaultdict(set)
  for _,x in ranges:unique[x['path']].update(range(x['startLine'],x['endLine']+1))
  group=version+'/'+job.get('conditionId','sol-'+job['effort'])
  row={'group':group,'key':job['key'],'mappedNodes':len(nodes),'nodes':node_count,'ranges':len(ranges),'rangeSizes':sizes,'uniqueSourceLines':sum(map(len,unique.values()))};rows.append(row);groups[group].append(row)
summary=[]
for group,items in groups.items():
 sizes=[n for r in items for n in r['rangeSizes']];mapped=sum(r['mappedNodes'] for r in items)
 summary.append({'group':group,'outputs':len(items),'mappedNodeObservations':mapped,'nodeObservations':node_count*len(items),'rangesPerMappedNode':sum(r['ranges'] for r in items)/mapped if mapped else 0,'medianLinesPerRange':statistics.median(sizes) if sizes else 0,'meanUniqueSourceLines':statistics.mean(r['uniqueSourceLines'] for r in items)})
(here/'original-comparison.json').write_text(json.dumps({'method':'Same 68 Core/Renderer canvas nodes (ASCII and node references checked identical), same Ghostty commit. v2 has different surrounding canvas and shared scratch behavior. Core diagrams 1/2 have no identical v2 baseline.','summary':summary,'samples':rows},indent=2)+'\n')
print(json.dumps(summary,indent=2))
