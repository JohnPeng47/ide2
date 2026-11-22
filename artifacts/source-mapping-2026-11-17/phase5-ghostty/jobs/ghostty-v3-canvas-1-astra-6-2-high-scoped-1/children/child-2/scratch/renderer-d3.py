from pathlib import Path
from collections import defaultdict
import json
aliases=dict(R='renderer',G='renderer/generic',S='Surface',V='terminal/render',C='renderer/cell',I='renderer/image',A='App',O='renderer/Options',T='renderer/Thread',M='renderer/Metal',L='renderer/OpenGL',ST='renderer/State',Q='termio/Termio',H='termio/stream_handler')
scopes=dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',x='subsystem'); roles=dict(d='declaration',u='use',i='implementation')
dictnodes={}; parents={}; maps={}; nodes=[]
for l in Path('/tmp/renderer-d3.txt').read_text().splitlines():
 n,sc,*items=l.split(); parents[n]=[]; nodes.append(dict(node=n,scope=[scopes[x] for x in sc])); D=defaultdict(list); maps[n]=D
 for item in items:
  if item.startswith('+'): parents[n].append('n'+item[1:]); continue
  p,rr=item.split(':');p='src/'+aliases.get(p,p).replace('gtk/', 'apprt/gtk/class/')+'.zig';lines=Path(p).read_text().splitlines()
  for t in rr.split(','):
   t0=t.rstrip('dui');role={roles[x] for x in t[len(t0):]};ep=list(map(int,t0.split('-')));a,b=ep[0],ep[-1];assert role and 1<=a<=b<=len(lines),(p,t);D[p].append((a,b,role))
out=[]
for n in reversed(maps):
 D=maps[n]
 for par in parents[n]:
  for p,r in maps[par].items():D[p].extend(r)
 for p,ls in D.items():
  ranges=[]
  for a,b,role in sorted(ls,key=lambda x:(x[0],x[1])):
   if ranges and (ranges[-1][1]>=a or ranges[-1][1]+1==a and ranges[-1][2]==role):
    ranges[-1][1]=max(ranges[-1][1],b);ranges[-1][2].update(role)
   else:ranges.append([a,b,set(role)])
  D[p]=ranges
for n,D in maps.items():
 for p,ls in D.items():
  out.extend(dict(node=n,path=p,startLine=a,endLine=b,role=[x for x in roles.values() if x in role]) for a,b,role in ls)
Path('/tmp/renderer-d3.json').write_text(json.dumps(dict(diagramId='d3',nodes=nodes,mappings=out),separators=(',',':')));print(len(out),'verified-bounds ranges')
