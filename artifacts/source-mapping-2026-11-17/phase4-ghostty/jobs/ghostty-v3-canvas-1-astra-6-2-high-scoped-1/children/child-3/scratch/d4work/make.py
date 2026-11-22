from pathlib import Path
import itertools,json
w=Path('/tmp/d4work'); pathnames='X termio/Exec T termio/Termio B termio/backend Q termio O termio/Options S Surface A App H termio/Thread C Command F os/flatpak P pty Z terminal/Terminal R renderer/State M apprt/surface'.split(); paths={k:'src/'+v+'.zig' for k,v in zip(pathnames[::2],pathnames[1::2])}; scopes=dict(zip('sebgry',['structure','entity','behavior','guarantee','relationship','subsystem'])); roles=dict(zip('dui',['declaration','use','implementation'])); rows={x[0][1:]:x[1:] for x in map(str.split,(w/'map').read_text().splitlines())}; wanted=dict(map(str.split,(w/'scopes').read_text().splitlines())); assert all(v[0]==wanted['n'+n] for n,v in rows.items());
def emit(n):
 for tok in rows[n][1:]:
  if tok[0]=='+':
   child,_,filt=tok[1:].partition('@');yield from (r for r in emit(child) if not filt or r[0] in filt)
  else:
   k,span,role=tok.split(':'); a,b=map(int,span.split('-')); assert 1<=a<=b;yield k,a,b,role
res={'diagramId':'d4','nodes':[],'mappings':[]};
for n in rows:
 res['nodes'].append({'node':'n'+n,'scope':[scopes[c] for c in rows[n][0]]}); ranges={}
 for k,a,b,role in emit(n):
  by=ranges.setdefault(k,{});
  for i in range(a,b+1):by.setdefault(i,set()).update(role)
 for k,by in ranges.items():
  lines=Path(paths[k]).read_text().splitlines();assert max(by)<=len(lines)
  for _,run in itertools.groupby(enumerate(sorted(by)),key=lambda x:x[1]-x[0]):
   ids=[y for _,y in run]; merged=set.union(*(by[i] for i in ids));res['mappings'].append({'node':'n'+n,'path':paths[k],'startLine':ids[0],'endLine':ids[-1],'role':[v for c,v in roles.items() if c in merged]})
(w/'d4.json').write_text(json.dumps(res,separators=(',',':')));print(len(res['mappings']))
