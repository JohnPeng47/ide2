"""Count pinned source lines actually returned by read/bash; deduplicate within each run."""
import collections, json, re, shlex, subprocess
from pathlib import Path
BASE=Path(__file__).resolve().parent
plan=json.loads((BASE/'inputs.json').read_text());repo=plan['repositoryPath'];commit=plan['sourceCommit']
EXT={'.ts','.tsx','.js','.jsx','.mjs','.cjs','.css','.scss','.html','.py','.rs','.go','.sh','.vue','.svelte','.sql','.c','.cpp','.h','.java','.kt','.swift','.m','.nix','.ps1','.bat'}
all_paths=subprocess.check_output(['git','ls-tree','-rz','--name-only',commit],cwd=repo).decode().strip('\0').split('\0')
paths=[p for p in all_paths if Path(p).suffix in EXT]
proc=subprocess.Popen(['git','cat-file','--batch'],cwd=repo,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
source={}
for p in paths:
 proc.stdin.write((commit+':'+p+'\n').encode());proc.stdin.flush()
 header=proc.stdout.readline();size=int(header.split()[2]);data=proc.stdout.read(size);assert proc.stdout.read(1)==b'\n'
 lines=data.decode('utf8').split('\n')
 if lines[-1]=='':lines.pop()
 source[p]=lines
proc.stdin.close();proc.wait()
eligible=set(json.loads((BASE/'eligible-paths.json').read_text()))&source.keys()
# Restrict unnamed search hits to paths/directories explicitly named in the command.
def expand_braces(s):
 m=re.search(r'\{([^{}]*,[^{}]*)\}',s)
 if not m:return [s]
 return [x for part in m[1].split(',') for x in expand_braces(s[:m.start()]+part+s[m.end():])]
def targets(command):
 expanded=expand_braces(command)
 result=set()
 for s in expanded:
  tokens=re.findall(r'[\w./*?@+-]+',s)
  for p in source:
   if p in s:result.add(p);continue
   if any('/' in token and not token.startswith('/') and '*' not in token and '?' not in token and p.startswith(token.rstrip('/')+'/') for token in tokens):result.add(p)
 return result

def analyze(number):
 transcript=BASE/f'sample-{number}'/'transcript.jsonl';calls={};seen=collections.defaultdict(set);audits=[]
 for entry_no,line in enumerate(transcript.read_text().splitlines(),1):
  m=json.loads(line).get('message',{})
  for c in m.get('content',[]) if isinstance(m.get('content'),list) else []:
   if c.get('type')=='toolCall':calls[c['id']]=c
  if m.get('role')!='toolResult' or m.get('isError'):continue
  call=calls[m['toolCallId']];name=call['name'];args=call['arguments'];text='\n'.join(c.get('text','') for c in m.get('content',[]));returned=text.split('\n');before=sum(map(len,seen.values()))
  if name=='read':
   p=args['path'];start=args.get('offset',1)-1
   if p.startswith('/'):p=p.split('/checkout/',1)[-1]
   if p not in source:continue
   # Only count complete source lines actually present, excluding tool footers/truncation.
   for i,row in enumerate(returned):
    if start+i>=len(source[p]) or row!=source[p][start+i]:break
    seen[p].add(start+i+1)
  elif name=='bash':
   command=args['command'];candidates=targets(command)
   for row in returned:
    # rg/grep -n with filenames, and grep context lines.
    m=re.match(r'(.+?)[\-:](\d+)[\-:](.*)$',row)
    if m:
     p,num,code=m.groups();p=p.removeprefix('./');num=int(num)
     if p in source and 0<num<=len(source[p]) and source[p][num-1]==code:seen[p].add(num);continue
    m=re.match(r'\s*(\d+)(?::|\t)(.*)$',row)
    if m:
     num=int(m[1]);code=m[2]
     matches=[p for p in candidates if 0<num<=len(source[p]) and source[p][num-1]==code]
     if len(matches)==1:seen[matches[0]].add(num)
     continue
    # Unnumbered rg/grep with an explicit filename.
    m=re.match(r'([^:]+):(.*)$',row)
    if m and m[1].removeprefix('./') in source:
     p=m[1].removeprefix('./');matches=[i+1 for i,v in enumerate(source[p]) if v==m[2]]
     if len(matches)==1:seen[p].add(matches[0])
   # cat/sed/head output: exact contiguous runs tied to named source paths.
   # An informative anchor plus matching neighbours avoids counting listings or boilerplate.
   index=collections.defaultdict(list)
   for p in candidates:
    for i,v in enumerate(source[p]):
     if len(v.strip())>=15:index[v].append((p,i))
   for oi,row in enumerate(returned):
    matches=[]
    for p,si in index.get(row,[]):
     a=0
     while oi-a>0 and si-a>0 and returned[oi-a-1]==source[p][si-a-1]:a+=1
     b=1
     while oi+b<len(returned) and si+b<len(source[p]) and returned[oi+b]==source[p][si+b]:b+=1
     if a+b>=3:matches.append((a+b,p,si-a,si+b))
    if not matches:continue
    longest=max(x[0] for x in matches);best=[x for x in matches if x[0]==longest]
    if len(best)==1:
     _,p,start,end=best[0];seen[p].update(range(start+1,end+1))
  audits.append({'entry':entry_no,'tool':name,'newLines':sum(map(len,seen.values()))-before,'command':args.get('command'),'path':args.get('path')})
 seen={p:v for p,v in seen.items() if v}
 total=sum(len(source[p]) for p in eligible);covered=sum(len(v) for p,v in seen.items() if p in eligible)
 result={'sample':number,'runId':plan['cases'][number-1]['runId'],'eligibleSourceLines':total,'sourceLinesSeen':covered,'percent':covered/total*100,'sourceFilesSeen':len(seen),'allSourceLinesSeen':sum(map(len,seen.values())),'outsideEligiblePaths':[p for p in seen if p not in eligible],'perFile':{p:sorted(v) for p,v in sorted(seen.items())},'toolAudit':audits}
 (BASE/f'sample-{number}'/'source-coverage.json').write_text(json.dumps(result,indent=2)+'\n')
 return result
runs=[analyze(i) for i in range(1,4)]
union=collections.defaultdict(set)
for run in runs:
 for p,lines in run['perFile'].items():
  if p in eligible:union[p].update(lines)
total=sum(len(source[p]) for p in eligible);summed=sum(r['sourceLinesSeen'] for r in runs);unique=sum(map(len,union.values()))
result={'commit':commit,'repositoryPath':repo,'eligibleSourceFiles':len(eligible),'eligibleSourceLines':total,'allTrackedSourceFiles':len(source),'allTrackedSourceLines':sum(map(len,source.values())),'meanSourceLinesSeen':summed/3,'meanPercent':summed/(3*total)*100,'summedPerRunLines':summed,'unionSourceLinesSeen':unique,'unionPercent':unique/total*100,'runs':[{k:v for k,v in r.items() if k not in ['perFile','toolAudit']} for r in runs],'method':'Physical source lines including comments/blanks, read and shell outputs; repeated file/line pairs deduplicated per run. Average coverage = sum of three run coverages / (3 × eligible source lines). Union deduplicates across all runs. Only complete returned lines count; listings, wc counts, prompts, JSON configs and generated diagrams excluded.'}
(BASE/'source-coverage.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
