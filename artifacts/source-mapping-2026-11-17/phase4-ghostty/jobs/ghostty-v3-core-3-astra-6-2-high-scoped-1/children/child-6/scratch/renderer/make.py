import json, collections,re,pathlib
P=pathlib.Path('/tmp/renderer')
roles={'D':'declaration','U':'use','I':'implementation'}
short={'G':'renderer/generic','T':'renderer/Thread','R':'terminal/render','S':'renderer/State'}
scopes={}; base=collections.defaultdict(list); include=collections.defaultdict(list)
for l in (P/'ranges').read_text().splitlines():
 a,*b=l.split()
 if re.fullmatch(r'n\d+',a):
  n=a; scopes[n]=b
 elif a.startswith('+'): include[n]=['n'+j[1:] for j in [a]+b]
 else:
  p='src/'+short.get(a,a); p=p+('' if '.' in p else '.zig'); size=len(pathlib.Path(p).read_text().splitlines());
  for j in b:
   ran,rs=j.split(':');lo,hi=map(int,ran.split('-'));assert 1<=lo<=hi<=size,(p,size,j);base[n].append((p,lo,hi,rs))
def fill(n):return base[n]+[r for k in include[n] for r in fill(k)]
def flatten(rs):
 out=[]
 for p,a,b,r in sorted(rs):
  if out and out[-1][0]==p and a<=out[-1][2]:
   prev=out.pop();out.append((p,prev[1],max(prev[2],b),prev[3]+r))
  else:out.append((p,a,b,r))
 return out
nodes=[{'node':n,'scope':s} for n,s in scopes.items()];m=[dict(node=n,path=p,startLine=a,endLine=b,role=[roles[x] for x in roles if x in r]) for n in scopes for p,a,b,r in flatten(fill(n))];doc={'diagrams':[{'diagramId':'d1','nodes':nodes,'mappings':m}],'notes':''};(P/'candidate.json').write_text(json.dumps(doc,separators=(',',':')));print(len(m),'renderer branch ranges');
