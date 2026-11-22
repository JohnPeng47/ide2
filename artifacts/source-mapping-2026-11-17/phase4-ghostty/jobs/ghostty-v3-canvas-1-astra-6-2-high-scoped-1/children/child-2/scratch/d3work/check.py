import json, pathlib,collections
from itertools import groupby
D=pathlib.Path('/tmp/d3work'); aliases={a:f'src/{p}.zig' for a,p in (l.split() for l in (D/'paths').read_text().splitlines())}; lines={a:pathlib.Path(p).read_text().splitlines() for a,p in aliases.items()}; rows={l.split()[0]:l.split()[1:] for l in (D/'ranges').read_text().splitlines()}; scopes=dict(zip('sebrgy',('structure','entity','behavior','relationship','guarantee','subsystem')));roles=dict(zip('dui',('declaration','use','implementation'))); dia=dict(diagramId='d3',nodes=[],mappings=[])
def expand(n):
 for w in rows[n][1:]:
  if w[0]=='+':yield from expand('n'+w[1:]); continue
  alias,x,r=w.split(':'); st,*en=map(int,x.split('-')); en=(en or [st])[0]; assert 1<=st<=en<=len(lines[alias]),w;yield alias,st,en,set(r)
for n,(scope,*_) in rows.items():
 dia['nodes'].append(dict(node=n,scope=[scopes[s] for s in scope])); pts=collections.defaultdict(list)
 for a,st,en,r in expand(n):pts[a].append((st,en,r))
 for a,ints in pts.items():
  merged=[]
  for st,en,r in sorted(ints,key=lambda x:x[:2]):
   if merged and st<=merged[-1][1]: merged[-1][1]=max(merged[-1][1],en);merged[-1][2]|=r
   else: merged.append([st,en,r.copy()])
  for st,en,r in merged:dia['mappings'].append(dict(node=n,path=aliases[a],startLine=st,endLine=en,role=[roles[s] for s in 'dui' if s in r]))
(D/'diagram.json').write_text(json.dumps(dia)); print(len(dia['nodes']),len(dia['mappings']))
