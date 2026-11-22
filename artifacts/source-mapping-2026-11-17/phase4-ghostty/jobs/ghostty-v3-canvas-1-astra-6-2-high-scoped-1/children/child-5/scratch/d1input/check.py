import json,pathlib
from collections import defaultdict
p=pathlib.Path('/tmp/d1input'); ns=[]; ms=[]; defs={}; cache={}
name='S A T IT R RM IM MB G Z E GA GS GC B K M P TP'.split(); paths='Surface App termio/Termio termio/Thread renderer/Thread renderer/message termio/message termio/mailbox renderer/generic renderer/size apprt/embedded apprt/gtk/App apprt/gtk/class/surface apprt/gtk/class/application input/Binding input/key_encode input/mouse_encode input/paste terminal/paste'.split(); fmap=dict(zip(name,['src/'+s+'.zig' for s in paths])); scopes=dict(zip('sebrgy','structure entity behavior relationship guarantee subsystem'.split())); roles=dict(zip('dui','declaration use implementation'.split()))
for l in (p/'map').read_text().splitlines():
 n,s,*xs=l.split(); defs[n]=xs; ns.append(dict(node=n,scope=[scopes[x] for x in s]))
def ranges(n):
 for x in defs[n]:
  if x[0]=='+': yield from ranges('n'+x[1:]);continue
  f,data=x.split(':',1); path=fmap[f]; cache.setdefault(path,pathlib.Path(path).read_text().splitlines())
  for el in data.split(','):
   ran,r=el.split(':'); a,b=map(int,ran.split('-')); assert 1<=a<=b<=len(cache[path]); yield path,a,b,r
for n in defs:
 data=defaultdict(dict)
 for f,a,b,r in ranges(n):
  for i in range(a,b+1): data[f].setdefault(i,set()).update(r)
 for f,lines in data.items():
  import itertools
  for _,v in itertools.groupby(enumerate(sorted(lines)),lambda it:(it[1]-it[0],frozenset(lines[it[1]]))):
   val=[i for _,i in v]; a,b=val[0],val[-1]; ms.append(dict(node=n,path=f,startLine=a,endLine=b,role=[roles[x] for x in 'dui' if x in lines[a]]))
frag=dict(diagramId='d1',nodes=ns,mappings=ms); (p/'fragment.json').write_text(json.dumps(frag)); print(len(ms),'checked ranges');print(fmap)
