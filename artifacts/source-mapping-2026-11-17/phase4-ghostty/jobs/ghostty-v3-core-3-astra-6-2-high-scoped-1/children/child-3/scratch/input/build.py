from pathlib import Path
import json
from collections import defaultdict
from itertools import groupby
base=Path('/tmp/input'); allr={}; roles={'D':'declaration','U':'use','I':'implementation'}
for row in (base/'ranges').read_text().splitlines():
 h,*args=row.split()
 if h.isdigit():
  table=allr[int(h)]=defaultdict(lambda: defaultdict(set))
  for a in args:
   for p,lines in allr[int(a[1:])].items():
    for l,role in lines.items():table[p][l].update(role)
 else:
  p='src/'+h+'.zig'; s=Path(p).read_text().splitlines()
  for a in args:
   role,rs=a.split(':');
   for r in rs.split(','):
    lo,hi=map(int,r.split('-'));assert 0<lo<=hi<=len(s)
    for l in range(lo,hi+1): table[p][l].update(role)
nodes=[];mappings=[]
for line in (base/'scopes').read_text().splitlines():
 n,*scope=line.split();nodes.append(dict(node=n,scope=scope));table=allr[int(n[1:])]
 for p,entries in table.items():
  for _,g in groupby(enumerate(sorted(entries)), key=lambda item:(item[1]-item[0],entries[item[1]])):
   lines=[l for _,l in g]; rr=sorted(entries[lines[0]],key='DUI'.index)
   mappings.append(dict(node=n,path=p,startLine=lines[0],endLine=lines[-1],role=[roles[c] for c in rr]))
(base/'candidate.json').write_text(json.dumps(dict(diagrams=[dict(diagramId='d1',nodes=nodes,mappings=mappings)],notes='')))
