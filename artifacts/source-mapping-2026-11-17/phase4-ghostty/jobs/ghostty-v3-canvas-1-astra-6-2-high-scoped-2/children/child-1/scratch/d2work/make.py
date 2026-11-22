from pathlib import Path
import json,re
from collections import defaultdict
p=Path('/tmp/d2work'); nm={k:'src/'+v+'.zig' for k,v in (l.split() for l in (p/'paths').read_text().splitlines())}; roles={'d':'declaration','u':'use','i':'implementation'}; spec={int(a):b for a,*b in (l.split() for l in (p/'spec').read_text().splitlines())}; scopes={int(a):s for a,*s in (l.split() for l in (p/'scopes').read_text().splitlines())}
def expand(n):
 for token in spec[n]:
  if token.startswith('+'):yield from expand(int(token[1:]));continue
  k,nums=token.split(':');
  for part in nums.split(','):
   r,a,b=re.fullmatch(r'([dui]+)([0-9]+)(?:-([0-9]+))?',part).groups();yield nm[k],int(a),int(b or a),r
D={'diagramId':'d2','nodes':[],'mappings':[]};verify={}
for n in range(1,30):
 key='n'+str(n);D['nodes'].append(dict(node=key,scope=scopes[n]));
 groups=defaultdict(list)
 for f,a,b,r in expand(n):groups[f].append((a,b,r))
 for f,entries in groups.items():
  src=Path(f).read_text().splitlines();blocks=[]
  for a,b,r in sorted(entries):
   assert 0<a<=b<=len(src);verify.update({(f,i):src[i-1] for i in range(a,b+1)})
   if blocks and a<=blocks[-1][1]:blocks[-1][1]=max(b,blocks[-1][1]);blocks[-1][2].update(r)
   else:blocks.append([a,b,set(r)])
  for a,b,rr in blocks:D['mappings'].append(dict(node=key,path=f,startLine=a,endLine=b,role=[v for k,v in roles.items() if k in rr]))
(p/'d2.json').write_text(json.dumps(D,separators=(',',':')));(p/'checked').write_text('\n'.join(f'{f}:{i}: {v}' for (f,i),v in sorted(verify.items())));print(len(D['mappings']),len(verify))
