from pathlib import Path
import json,itertools,collections,re
aliases={}
for group,items in {'':'S:Surface A:App PT:pty API:termio','termio/':'T:Termio E:Exec B:backend I:Thread H:stream_handler M:mailbox MSG:message O:Options','renderer/':'R:Thread G:generic RS:State Z:size RM:message','terminal/':'V:stream P:Parser APC:apc DCS:dcs L:Terminal SS:ScreenSet SC:Screen PL:PageList CW:kitty/clipboard_write CG:kitty/clipboard_grants','apprt/':'AS:surface GTK:gtk/class/application GA:gtk/App EMB:embedded'}.items():
 for item in items.split():
  k,v=item.split(':');aliases[k]='src/'+group+v+'.zig'
scopes=dict(e='entity',s='structure',b='behavior',x='subsystem',r='relationship',g='guarantee');roles=dict(d='declaration',u='use',i='implementation')
wd=Path('/tmp/termio-mapping'); defs={};nodes=[]
for line in (wd/'d2.txt').read_text().splitlines():
 n,s,*items=line.split();nodes.append(dict(node='n'+n,scope=[scopes[k] for k in s]));defs[n]=items
sources={p:Path(p).read_text().splitlines() for p in aliases.values()};reads=collections.defaultdict(set)
def entries(n):
 for item in defs[n]:
  if item.startswith('+'):yield from entries(item[1:]);continue
  a,s=item.split(':');p=aliases[a]
  for r in s.split(','):
   l,h,rr=re.fullmatch(r'(\d+)(?:-(\d+))?([dui]+)',r).groups();l=int(l);h=int(h or l);assert 1<=l<=h<=len(sources[p]);reads[p].update(range(l,h+1));yield p,l,h,rr
maps=[]
for n in defs:
 table=collections.defaultdict(lambda:collections.defaultdict(set))
 for p,l,h,rr in entries(n):
  for i in range(l,h+1):table[p][i].update(rr)
 for p,lines in table.items():
  for _,run in itertools.groupby(enumerate(sorted(lines)),lambda v:v[1]-v[0]):
   indices=[j for _,j in run];rr=set.union(*(lines[i] for i in indices));maps.append(dict(node='n'+n,path=p,startLine=indices[0],endLine=indices[-1],role=[roles[k] for k in roles if k in rr]))
candidate=dict(diagrams=[dict(diagramId='d2',nodes=nodes,mappings=maps)],notes='d2/n23: With the inspector active the parser receives next(byte), not nextSlice. d2/n24: yieldToDemand is a bounded opportunistic handoff. d2/n28: Ordering excludes concurrent parsing during a successful resize, but a Terminal.resize error after backend.resize is not rolled back at the PTY.')
(wd/'d2.json').write_text(json.dumps(candidate,separators=(',',':')));print(len(maps),'ranges.');(wd/'evidence.txt').write_text('\n'.join(f'{p}:{i}: {sources[p][i-1]}' for p in reads for i in sorted(reads[p])))
