"""Audit child suggestions against final mappings, without asserting suggestions are correct.
Also retain the reproducible pre-validation draft in the observed filename-error case.
"""
import ast
import collections
import json
from pathlib import Path
import re

here=Path(__file__).resolve().parent
plan=json.loads((here/'plan.json').read_text())
def intervals(items):
 out=[]
 for lo,hi in sorted(items):
  if out and lo<=out[-1][1]+1:out[-1]=(out[-1][0],max(hi,out[-1][1]))
  else:out.append((lo,hi))
 return out

def subtract(a,b):
 result=[]
 for lo,hi in intervals(a):
  cursor=lo
  for start,end in intervals(b):
   if end<cursor:continue
   if start>hi:break
   if start>cursor:result.append((cursor,min(start-1,hi)))
   cursor=max(cursor,end+1)
   if cursor>hi:break
  if cursor<=hi:result.append((cursor,hi))
 return result

def mappings(output):
 for d in output.get('diagrams',[]):
  for m in d.get('mappings',[]):yield (d['diagramId'],m['node'],m['path']),(m['startLine'],m['endLine'])

rows=[]
for job in plan['jobs']:
 folder=here/'jobs'/job['key']
 if not (folder/'mapping.json').exists():continue
 final=json.loads((folder/'mapping.json').read_text());suggested=collections.defaultdict(list);saved=collections.defaultdict(list);unparsed=[]
 for key,span in mappings(final):saved[key].append(span)
 for f in sorted(folder.glob('children/child-*/response.json')):
  text=json.loads(f.read_text())['text'].strip()
  text=re.sub(r'^```(?:json)?\s*|\s*```$','',text)
  try:
   output=json.loads(text)
   for key,span in mappings(output):suggested[key].append(span)
  except (ValueError,KeyError,TypeError):unparsed.append(f.parent.name)
 omissions=[];suggestion_lines=missing_lines=0
 for key,spans in suggested.items():
  missing=subtract(spans,saved[key]);suggestion_lines+=sum(b-a+1 for a,b in intervals(spans));missing_lines+=sum(b-a+1 for a,b in missing)
  if missing:omissions.append({'diagram':key[0],'node':key[1],'path':key[2],'childSuggested':intervals(spans),'finalSelected':intervals(saved[key]),'omittedIntervals':missing})
 checks=[json.loads(line) for line in (folder/'validation-checks.jsonl').read_text().splitlines()]
 filename_errors=[c['candidate'] for c in checks if not c['valid'] and c['candidate'].strip().startswith('/')]
 rows.append({'key':job['key'],'condition':job['conditionId'],'parsedChildren':len(list(folder.glob('children/child-*/response.json')))-len(unparsed),'unparsedChildren':unparsed,'suggestedNodeFileLines':suggestion_lines,'omittedSuggestionLines':missing_lines,'nodesWithOmittedSuggestions':len({(x['diagram'],x['node']) for x in omissions}),'filenameValidationErrors':filename_errors,'omissions':omissions})

# Recover this draft by reading literal AST assignments only; never execute the shell/model script.
key='ghostty-v3-canvas-2-sol-high_sol-medium-2'
folder=here/'jobs'/key
if (folder/'events.jsonl').exists():
 for line in (folder/'events.jsonl').read_text().splitlines():
  event=json.loads(line)
  command=event.get('args',{}).get('command','')
  if event.get('type')!='tool_execution_start' or event.get('toolName')!='bash' or 'cat > /tmp/make_mapping.py' not in command:continue
  script=command.split("<<'PY'\n",1)[1].split('\nPY\n',1)[0];tree=ast.parse(script);aliases={};data={}
  for statement in tree.body:
   if not isinstance(statement,ast.Assign) or len(statement.targets)!=1:continue
   target=statement.targets[0]
   if isinstance(target,ast.Name) and target.id=='aliases':aliases=ast.literal_eval(statement.value)
   if isinstance(target,ast.Subscript) and isinstance(target.value,ast.Name) and target.value.id=='data':data[ast.literal_eval(target.slice)]=ast.literal_eval(statement.value)
  diagrams=[]
  for diagram,text in data.items():
   selected=[]
   for line in text.strip().splitlines():
    node,refs=line.split('=')
    for ref in refs.split(','):
     alias,span=ref.split(':');lo,hi=map(int,span.split('-'));selected.append({'node':'n'+node,'path':aliases[alias],'startLine':lo,'endLine':hi})
   diagrams.append({'diagramId':diagram,'mappings':selected})
  evidence=here/'analysis-evidence';evidence.mkdir(exist_ok=True)
  (evidence/(key+'-draft.json')).write_text(json.dumps({'diagrams':diagrams,'notes':'Recovered exactly from literal mappings in the logged draft script; original draft was not submitted as JSON to the validator.'},indent=2)+'\n')
  (evidence/(key+'-draft-source.txt')).write_text(command+'\n')
  count=sum(len(d['mappings']) for d in diagrams)
  for row in rows:
   if row['key']==key:row['recoveredDraftRanges']=count;row['finalRanges']=sum(len(d['mappings']) for d in json.loads((folder/'mapping.json').read_text())['diagrams'])

result={'method':'Compare unioned child-returned ranges with final ranges for the SAME diagram/node/file. Omission is a change in suggestions, not automatically an error: children are not structurally or semantically certified. Filename-validation errors and the recovered literal draft provide a concrete audit of one submission-loss sequence.','samples':rows}
(here/'retention-analysis.json').write_text(json.dumps(result,indent=2)+'\n')
for row in rows:print(row['key'],'omitted suggestion lines',row['omittedSuggestionLines'],'/',row['suggestedNodeFileLines'],'filename errors',len(row['filenameValidationErrors']),f"draft {row['recoveredDraftRanges']} -> final {row['finalRanges']}" if 'recoveredDraftRanges' in row else '')
