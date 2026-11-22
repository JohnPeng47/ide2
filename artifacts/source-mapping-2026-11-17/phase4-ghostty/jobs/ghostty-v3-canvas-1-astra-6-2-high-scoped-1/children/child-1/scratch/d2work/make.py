from pathlib import Path
import json
base=Path('/tmp/d2work'); paths={a:'src/'+p+'.zig' for a,p in map(str.split,(base/'aliases').read_text().splitlines())}; scope=dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',y='subsystem'); role=dict(d='declaration',u='use',i='implementation'); specs={}; raw={}; sl=open(base/'scopes').read().split(); scopes=dict(zip(sl[::2],sl[1::2])); nodes=[]; maps=[]
for line in (base/'map').read_text().splitlines():
 n,s,*rest=line.split(); assert scopes[n]==s; nodes.append(dict(node=n,scope=[scope[x] for x in s])); specs[n]=rest

def resolve(n):
 if n in raw:return raw[n]
 spans=set()
 for a in specs[n]:
  if a[0]=='+':spans.update(resolve(a[1:]));continue
  path,span,roles=a.split(':'); l,h=map(int,span.split('-')); path=paths[path]; assert 1<=l<=h<=len(Path(path).read_text().splitlines()); spans.add((path,l,h,roles))
 raw[n]=spans;return spans
for n in specs:
 block=[]
 for path,l,h,roles in sorted(resolve(n)):
  if block and block[-1][0]==path and l<=block[-1][2]:
   block[-1][2]=max(block[-1][2],h); block[-1][3].update(roles)
  else:block.append([path,l,h,set(roles)])
 maps.extend(dict(node=n,path=p,startLine=l,endLine=h,role=[role[r] for r in role if r in rs]) for p,l,h,rs in block)
cand={'diagrams':[{'diagramId':'d2','nodes':nodes,'mappings':maps}],'notes':'d2/n28: the mutex orders a successful resize against parsing. Backend.resize can succeed before a fallible Terminal.resize; the lock is not a transaction across resize errors. d2/n24: yieldToDemand is a bounded fairness heuristic, not an unconditional wait for a renderer snapshot.'}; (base/'d2.json').write_text(json.dumps(cand)); checked=set();
with (base/'ranges.numbered').open('w') as out:
 for n,v in raw.items():
  for p,l,h,rs in sorted(v):
   if (p,l,h) in checked:continue
   out.write(f'\n{p}\n');out.writelines(f'{num}\t{s}\n' for num,s in enumerate(Path(p).read_text().splitlines()[l-1:h],l));checked.add((p,l,h))
print(len(nodes),len(maps),'source ranges walked:',len(checked))
