from pathlib import Path
from collections import defaultdict
from itertools import groupby
import json
w=Path('/tmp/d5work'); alias=dict(T='Terminal',S='Screen',K='ScreenSet',L='PageList',P='page',Q='Selection',R='c/grid_ref_tracked',C='compress/Page',M='mem',H='hyperlink',Y='style'); alias={k:f'src/terminal/{v}.zig' for k,v in alias.items()};alias.update(I='src/termio/Termio.zig',D='src/datastruct/intrusive_linked_list.zig'); role=dict(d='declaration',i='implementation',u='use');scope=dict(s='structure',b='behavior',e='entity',g='guarantee',r='relationship',y='subsystem'); texts={p:Path(p).read_text().splitlines() for p in alias.values()}; dic={}; out={'diagramId':'d5','nodes':[],'mappings':[]}
for line in (w/'map.txt').read_text().splitlines():
 n,s,*ranges=line.split(); dic[n]=ranges;out['nodes'].append({'node':n,'scope':[scope[c] for c in s]})
def get(n):
 for r in dic[n]:
  if r.startswith('+'): yield from get('n'+r[1:]);continue
  a,lr,ro=r.split(':');p=alias[a];l,h=map(int,lr.split('-'));assert 1<=l<=h<=len(texts[p]);yield p,l,h,ro
with (w/'ranges.readback').open('w') as f:
 for n in dic:
  hit=defaultdict(dict)
  for p,l,h,ro in get(n):
   for i in range(l,h+1): hit[p][i]=hit[p].get(i,set())|set(ro)
  for p,data in hit.items():
   for _,grp in groupby(enumerate(sorted(data)),key=lambda v:v[1]-v[0]):
    lines=[i for _,i in grp];rr=set.union(*(data[i] for i in lines));out['mappings'].append(dict(node=n,path=p,startLine=lines[0],endLine=lines[-1],role=[role[k] for k in 'dui' if k in rr]));f.write(f'{n} {p}\n');f.writelines(f'{i:5} {texts[p][i-1]}\n' for i in lines)
assert len(dic)==29; (w/'d5.json').write_text(json.dumps(out));print('d5 mappings:',len(out['mappings']))
