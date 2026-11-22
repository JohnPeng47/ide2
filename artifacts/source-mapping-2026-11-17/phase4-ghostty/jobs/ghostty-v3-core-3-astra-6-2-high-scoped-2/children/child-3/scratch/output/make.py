import re,json
from pathlib import Path
from collections import defaultdict
p=Path('/tmp/output')
paths=dict(zip('SEPC T B J H G M R Y V X A Q K L'.replace(' ',''),'''Surface termio/Exec pty Command termio/Termio termio/backend termio/Thread termio/stream_handler terminal/Terminal termio/mailbox renderer/Thread renderer/generic terminal/stream terminal/Parser App apprt/surface apprt/gtk/class/application apprt/embedded'''.split()))
m=defaultdict(lambda:defaultdict(lambda:defaultdict(set))); rr=dict(d='declaration',i='implementation',u='use'); nodes=[]
for l in (p/'scopes').read_text().splitlines():
 n,*sc=l.split(); nodes.append(dict(node='n'+n,scope=sc))
for l in (p/'ranges').read_text().splitlines():
 n,k,*vals=l.split()
 if k=='+':
  for child in vals:
   for path,lines in m[child].items():
    for i,r in lines.items():m[n][path][i].update(r)
 else:
  path='src/'+paths[k]+'.zig'; L=Path(path).read_text().splitlines()
  for v in vals:
   a,b,r=re.fullmatch(r'(\d+)-(\d+)([udi]+)',v).groups(); assert 1<=int(a)<=int(b)<=len(L)
   for i in range(int(a),int(b)+1):m[n][path][i].update(r)
out=[]
for n in sorted(m,key=int):
 for f,lines in sorted(m[n].items()):
  a=b=0
  for i in sorted(lines):
   if a and b+1==i: b=i; roles.update(lines[i]); continue
   if a:out.append(dict(node='n'+n,path=f,startLine=a,endLine=b,role=[rr[x] for x in sorted(roles)]))
   a=b=i;roles=set(lines[i])
  if a:out.append(dict(node='n'+n,path=f,startLine=a,endLine=b,role=[rr[x] for x in sorted(roles)]))
(p/'candidate.json').write_text(json.dumps(dict(diagrams=[dict(diagramId='d1',nodes=nodes,mappings=out)],notes='d1 n42: nextSlice is the normal path; an active inspector processes the bytes individually. d1 n47: render notification is issued while locked, before parsing; visibility, display realization and synchronized output can defer frame work.')))
