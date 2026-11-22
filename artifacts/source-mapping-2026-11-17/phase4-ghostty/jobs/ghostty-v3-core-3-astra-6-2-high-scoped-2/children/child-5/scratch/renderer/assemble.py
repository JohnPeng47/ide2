from pathlib import Path
from collections import defaultdict
import json,re,itertools
p=Path('/tmp/renderer'); sc={x.split()[0]:x.split()[1:] for x in (p/'scopes').read_text().splitlines()}; out={}; lines={}
for x in (p/'ranges').read_text().splitlines():
 a,*b=x.split()
 if a.isdecimal():
  m=out[a]=defaultdict(dict)
  for inc in b:
   for file,nums in out[inc[1:]].items():
    for k,v in nums.items():m[file][k]=set(v)|m[file].get(k,set())
  continue
 f='src/'+a+'.zig'; lines.setdefault(f,Path(f).read_text().splitlines())
 for r in b:
  l,h,roles=re.fullmatch(r'(\d+)(?:-(\d+))?([uid]+)',r).groups(); l=int(l);h=int(h or l); assert h<=len(lines[f]) and l<=h
  for n in range(l,h+1):m[f].setdefault(n,set()).update(roles)
# prune external draw-layer code inherited in updateFrame (retain image placement prep)
for f,lo,hi in [('src/renderer/generic.zig',1950,2000),('src/renderer/image.zig',116,191)]:
 for n in range(lo,hi+1):out['69'][f].pop(n,None)
# emit grouped contiguous roles; coalesce connected evidence, preserving combined roles
nodes=[];maps=[];roles={'d':'declaration','u':'use','i':'implementation'}
for a in sorted(sc,key=int):
 nodes.append({'node':'n'+a,'scope':sc[a]})
 for f,nums in out[a].items():
  for _,g in itertools.groupby(enumerate(sorted(nums)),lambda t:t[1]-t[0]):
   ns=[n for i,n in g]; rt=set.union(*(nums[n] for n in ns)); maps.append({'node':'n'+a,'path':f,'startLine':ns[0],'endLine':ns[-1],'role':[v for k,v in roles.items() if k in rt]})
(p/'subset.json').write_text(json.dumps({'diagrams':[{'diagramId':'d1','nodes':nodes,'mappings':maps}],'notes':''},separators=(',',':')))
print(len(nodes),len(maps))
