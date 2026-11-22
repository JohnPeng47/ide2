from pathlib import Path
from collections import defaultdict
import json,re
work=Path('/tmp/d4work')
paths=dict(E='termio/Exec',B='termio/backend',T='termio/Termio',S='Surface',M='termio',C='Command',F='os/flatpak',P='pty',V='terminal/Terminal',I='renderer/State',H='termio/Thread',A='apprt/surface',G='App'); paths={k:'src/'+p+'.zig' for k,p in paths.items()}
roles=dict(d='declaration',i='implementation',u='use')
ns=[{'node':'n'+r[0],'scope':r[1:]} for l in (work/'scopes').read_text().splitlines() if (r:=l.split())]
parents={1:[2,12],2:[3,9,10,11],3:[4,5,6,8],6:[7],12:[13],13:[14,16,18,19],14:[15],16:[17],19:[20,26],20:[21,23,24],21:[22],24:[25]}
store=defaultdict(lambda:defaultdict(list)); maps=[]
for s in (work/'compact').read_text().splitlines():
 n,*parts=s.split(); n=int(n)
 for p in parts:
  key,items=p.split(':'); file=paths[key]; total=len(Path(file).read_text().splitlines())
  for item in items.split(','):
   r,a,b=re.fullmatch(r'([udi]+)(\d+)(?:-(\d+))?',item).groups(); a=int(a); b=int(b or a); assert 0<a<=b<=total; store[n][file].append((a,b,set(r)))
for n in reversed(range(1,27)):
 for child in parents.get(n,[]):
  for p,v in store[child].items():store[n][p]+=v
 for p,v in sorted(store[n].items()):
  merged=[]
  for a,b,r in sorted(v,key=lambda t:t[:2]):
   if merged and a<=merged[-1][1]+1:
    x,y,z=merged.pop();merged.append((x,max(y,b),z|r))
   else: merged.append((a,b,r))
  for a,b,r in merged:maps.append({'node':f'n{n}','path':p,'startLine':a,'endLine':b,'role':[v for k,v in roles.items() if k in r]})
res={'diagramId':'d4','nodes':ns,'mappings':sorted(maps,key=lambda m:int(m['node'][1:]))}
(work/'candidate.json').write_text(json.dumps({'diagrams':[res],'notes':''},separators=(',',':')));print(len(maps))
