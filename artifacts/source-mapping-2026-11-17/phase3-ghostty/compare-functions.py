"""Check ten named functions highlighted in the earlier review, including full bodies.
Explicit symbol/file pairs avoid claiming that the lightweight sym.py heuristic
measures implementation completeness. Coverage is measured on the named node.
"""
import collections
import json
from pathlib import Path
import re
import subprocess

here=Path(__file__).resolve().parent
plan=json.loads((here/'plan.json').read_text());previous=here.parent/'phase2-ghostty';p2=json.loads((previous/'plan.json').read_text())
keys={c['key'] for c in plan['cases']}
case=json.loads((here/(plan['cases'][0]['key']+'-input.json')).read_text());repo=case['repo']['repositoryPath'];commit=case['repo']['commit']
symbol_files={**{s:'src/Surface.zig' for s in ['keyCallback','mouseButtonCallback','cursorPosCallback','scrollCallback','queueIo','needsConfirmQuit','handleMessage']},'drawFrame':'src/renderer/generic.zig','unlockDemand':'src/renderer/State.zig','renderCallback':'src/renderer/Thread.zig'}
cache={}
def source(p):
 if p not in cache:cache[p]=subprocess.check_output(['git','-C',repo,'show',commit+':'+p],text=True).splitlines()
 return cache[p]

def bounds(p,symbol):
 lines=source(p)
 starts=[i for i,l in enumerate(lines) if re.match(r'\s*(?:pub\s+)?(?:inline\s+)?fn\s+'+re.escape(symbol)+r'\s*\(',l)]
 assert len(starts)==1,(p,symbol,starts)
 start=starts[0];depth=0;begun=False
 for i in range(start,len(lines)):
  line=lines[i]
  if line.lstrip().startswith('\\\\'):continue
  # Strip string/character literals before line comments; braces there are not syntax.
  line=re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', '',line).split('//',1)[0]
  for char in line:
   if char=='{':depth+=1;begun=True
   elif char=='}':
    depth-=1
    if begun and depth==0:return {'path':p,'startLine':start+1,'endLine':i+1}
 raise AssertionError((p,symbol,'unclosed'))

definitions={s:bounds(p,s) for s,p in symbol_files.items()}
rows=[]
for phase,folder,jobs in [('phase-2',previous,[j for j in p2['jobs'] if j['caseId'] in keys and j['effort'] in ['medium','high']]),('phase-3',here,plan['jobs'])]:
 for job in jobs:
  directory=folder/'jobs'/job['key'];receipt=directory/'status.json'
  if not receipt.exists() or json.loads(receipt.read_text())['status']!='finished':continue
  inp=json.loads((folder/(job['caseId']+'-input.json')).read_text());mapping=json.loads((directory/'mapping.json').read_text())
  by=collections.defaultdict(list)
  for d in mapping['diagrams']:
   for m in d['mappings']:by[d['diagramId'],m['node']].append(m)
  for d in inp['diagrams']:
   for node in d['nodes']:
    for symbol,definition in definitions.items():
     if not re.search(r'\b'+symbol+r'\b',node['label']):continue
     ranges=[m for m in by[d['diagramId'],node['ref']] if m['path']==definition['path']]
     selected=set()
     for m in ranges:selected.update(range(max(m['startLine'],definition['startLine']),min(m['endLine'],definition['endLine'])+1))
     total=definition['endLine']-definition['startLine']+1
     rows.append({'phase':phase,'key':job['key'],'condition':job.get('conditionId','sol-'+job['effort']+'_baseline'),'caseId':job['caseId'],'node':d['diagramId']+'/'+node['ref'],'label':node['label'],'symbol':symbol,'definition':definition,'declarationStart':definition['startLine'] in selected,'fullDefinition':len(selected)==total,'selectedDefinitionLines':len(selected),'definitionLines':total,'ranges':ranges})
groups=collections.defaultdict(list)
for row in rows:groups[row['condition']].append(row)
summary=[{'condition':condition,'observations':len(values),'declarationStart':sum(r['declarationStart'] for r in values),'fullDefinition':sum(r['fullDefinition'] for r in values),'meanDefinitionLineCoverage':sum(r['selectedDefinitionLines']/r['definitionLines'] for r in values)/len(values)} for condition,values in groups.items()]
report={'method':'Ten explicit symbol/file pairs mentioned in the previous discussion; match literal symbol in a node label, then check direct mapped ranges. Full definition requires every line from fn declaration through its matching closing brace. Comments/strings are excluded from brace parsing. Does not measure downstream callees or semantic precision.','commit':commit,'definitions':definitions,'summary':summary,'details':rows}
(here/'function-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'definitions':definitions,'summary':summary},indent=2))
