"""Replay the concrete coverage questions from Herdr w3M:p68 on matched inputs.
These are explicit source-line probes, not an exhaustive semantic correctness score.
Counts are direct node mappings; evidence elsewhere in the canvas is reported separately.
"""
import collections
import json
from pathlib import Path

here=Path(__file__).resolve().parent
plan=json.loads((here/'plan.json').read_text())
p2dir=here.parent/'phase2-ghostty'
p2=json.loads((p2dir/'plan.json').read_text())
keys={c['key'] for c in plan['cases']}
# Each part requires one of its alternative line locations; all parts are needed.
probes=[
 {'id':'font-reference-count','cases':['canvas-1','canvas-2'],'diagram':'d1','node':'n6','claim':'Shared, reference-counted font grids','parts':[
  [('src/font/SharedGridSet.zig',115)], [('src/font/SharedGridSet.zig',422)], [('src/font/SharedGridSet.zig',428)]]},
 {'id':'shaping-call','cases':['canvas-1','canvas-2'],'diagram':'d3','node':'n13','claim':'Snapshot + shaping + atlas -> cells, selection, cursor, images','parts':[
  [('src/renderer/generic.zig',3030),('src/renderer/generic.zig',3299)]]},
 {'id':'glyph-cache-and-atlas','cases':['canvas-1','canvas-2'],'diagram':'d3','node':'n13','claim':'Same broad rendering node: glyph cache lookup and atlas selection','parts':[
  [('src/font/SharedGrid.zig',395)],[('src/font/SharedGrid.zig',409)]]},
 {'id':'resize-handoff','cases':['canvas-1','canvas-2'],'diagram':'d1','node':'n28','claim':'drainMailbox -> io.queueWrite; coalesces resize requests','parts':[
  [('src/termio/Thread.zig',397)],[('src/termio/Thread.zig',445)]]},
 {'id':'device-ownership','cases':['canvas-1','canvas-2'],'diagram':'d1','node':'n7','claim':'App-owned GPU device borrowed by renderers','parts':[
  [('src/Surface.zig',568)],[('src/Surface.zig',581)]]},
 {'id':'mutex-io-and-renderer','cases':['core-2'],'diagram':'d1','node':'n19','claim':'Mutex protects referenced terminal state and shared presentation inputs','parts':[
  [('src/termio/Termio.zig',709)],[('src/renderer/generic.zig',1420)]]},
 {'id':'windows-read-and-process','cases':['core-2'],'diagram':'d1','node':'n45','claim':'Windows: one read loop reads and processes output','parts':[
  [('src/termio/Exec.zig',1793)],[('src/termio/Exec.zig',1806)]]},
 {'id':'active-screen-selection','cases':['core-2'],'diagram':'d1','node':'n60','claim':'active: *Screen chooses the current screen','parts':[
  [('src/terminal/ScreenSet.zig',108)]]},
 {'id':'three-derived-configurations','cases':['core-2'],'diagram':'d1','node':'n92','claim':'Surface, Termio, and Renderer maintain their own derived configuration','parts':[
  [('src/Surface.zig',506),('src/Surface.zig',1823)],
  [('src/Surface.zig',708),('src/Surface.zig',1876),('src/termio/Termio.zig',466)],
  [('src/Surface.zig',577),('src/renderer/generic.zig',2171)]]},
]

def covers(ranges, location):
 p,n=location
 return any(m['path']==p and m['startLine']<=n<=m['endLine'] for m in ranges)

rows=[];sample_rows=[];qualitative=[]
for phase,folder,jobs in [('phase-2',p2dir,[j for j in p2['jobs'] if j['caseId'] in keys]),('phase-3',here,plan['jobs'])]:
 for job in jobs:
  out=folder/'jobs'/job['key'];status=out/'status.json'
  if not status.exists() or json.loads(status.read_text())['status']!='finished':continue
  inp=json.loads((folder/(job['caseId']+'-input.json')).read_text())
  result=json.loads((out/'mapping.json').read_text());all_ranges=[m for d in result['diagrams'] for m in d['mappings']]
  condition=job.get('conditionId','sol-'+job['effort']+'_baseline')
  sample_rows.append({'phase':phase,'key':job['key'],'caseId':job['caseId'],'condition':condition,'fontFiles':sorted({m['path'] for m in all_ranges if m['path'].startswith('src/font/')})})
  if job['caseId'].endswith('core-2'):
   targets=[('readonly-local-interactions','d1','n35')]
  elif '-canvas-' in job['caseId']:
   targets=[('runtime-hosting-and-events','d1','n10')]
  else:targets=[]
  for topic,did,nid in targets:
   ranges=[m for d in result['diagrams'] if d['diagramId']==did for m in d['mappings'] if m['node']==nid]
   qualitative.append({'topic':topic,'key':job['key'],'condition':condition,'node':did+'/'+nid,'ranges':ranges})
  for probe in probes:
   if job['caseId'].removeprefix('ghostty-v3-') not in probe['cases']:continue
   ranges=[m for d in result['diagrams'] if d['diagramId']==probe['diagram'] for m in d['mappings'] if m['node']==probe['node']]
   parts=[any(covers(ranges,location) for location in part) for part in probe['parts']]
   anywhere=[any(covers(all_ranges,location) for location in part) for part in probe['parts']]
   label=next(n['label'] for d in inp['diagrams'] if d['diagramId']==probe['diagram'] for n in d['nodes'] if n['ref']==probe['node'])
   rows.append({'phase':phase,'key':job['key'],'caseId':job['caseId'],'condition':condition,'probe':probe['id'],'node':probe['diagram']+'/'+probe['node'],'label':label,'coveredParts':parts,'directAllParts':all(parts),'anywhereAllParts':all(anywhere),'ranges':ranges,'mappingFile':str(out/'mapping.json')})
groups=collections.defaultdict(list)
for row in rows:groups[row['probe'],row['condition']].append(row)
summary=[{'probe':probe,'condition':condition,'completed':len(values),'direct':sum(r['directAllParts'] for r in values),'anywhere':sum(r['anywhereAllParts'] for r in values)} for (probe,condition),values in groups.items()]
report={'sourcePane':'w3M:p68','commit':plan['commit'],'method':'Pinned source-line probes of specific previous findings, comparing exact inputs. Presence can come from a broad range; neither semantic correctness nor precision is certified. Direct evidence and whole-output evidence are separate.','probes':probes,'summary':summary,'samples':sample_rows,'details':rows,'qualitativeExamples':qualitative}
(here/'p68-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
for probe in probes:
 print(probe['id'], ' | '.join(f"{r['condition']}: {r['direct']}/{r['completed']} direct ({r['anywhere']} anywhere)" for r in summary if r['probe']==probe['id']))
