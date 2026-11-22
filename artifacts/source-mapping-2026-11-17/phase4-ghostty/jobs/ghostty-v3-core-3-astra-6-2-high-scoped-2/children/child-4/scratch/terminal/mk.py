from pathlib import Path
import json, collections
D=Path('/tmp/terminal'); scopes=[dict(node=a[0],scope=a[1:]) for a in [s.split() for s in (D/'scopes').read_text().splitlines()]]
paths=dict(t='Terminal',ss='ScreenSet',s='Screen',pl='PageList',p='page',sel='Selection',r='render',gs='kitty/graphics_storage',ts='Tabstops',vt='stream_terminal',m='main'); paths={k:'src/terminal/'+v+'.zig' for k,v in paths.items()}|dict(io='src/termio/Termio.zig')
roles=dict(d='declaration',i='implementation',u='use'); direct=collections.defaultdict(list); children=collections.defaultdict(list)
for line in (D/'ranges').read_text().splitlines():
 if line.startswith('#'):continue
 n,k,*ranges=line.split(); n='n'+n
 if k.startswith('+'):children[n]=['n'+x[1:] for x in [k]+ranges];continue
 for seq in ranges:
  span,r=seq.split(':'); lo,hi=map(int,span.split('-'));direct[n].append((paths[k],lo,hi,set(r)))
def resolve(n):
 result=direct[n][:]
 for c in children[n]:result+=resolve(c)
 return result
all_maps=[]
for node in scopes:
 n=node['node']; byfile=collections.defaultdict(list)
 for f,x,y,r in resolve(n):byfile[f].append((x,y,r))
 for f,rs in sorted(byfile.items()):
  L=[]; lines=Path(f).read_text().splitlines()
  for x,y,r in sorted(rs):
   assert 0<x<=y<=len(lines)
   if L and (L[-1][1]>=x or (L[-1][1]==x-1 and L[-1][2]==r)):
    L[-1][1]=max(y,L[-1][1]); L[-1][2]=L[-1][2]|r
   else:L.append([x,y,r])
  for x,y,r in L:all_maps.append(dict(node=n,path=f,startLine=x,endLine=y,role=[roles[k] for k in 'dui' if k in r]))
(D/'subset.json').write_text(json.dumps(dict(diagrams=[dict(diagramId='d1',nodes=scopes,mappings=all_maps)],notes='d1/n65: tracking preserves locations while their content survives. Pins on pruned content can be reset and marked garbage.')))
