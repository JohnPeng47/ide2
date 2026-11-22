import re,json,pathlib
from collections import defaultdict
p=pathlib.Path('/tmp/terminal-mapping'); source=dict(T='Terminal',S='Screen',K='ScreenSet',L='PageList',P='page',Q='Selection',C='compress/Page',R='c/grid_ref_tracked',M='mem',H='hyperlink',Y='style');source={k:'src/terminal/'+v+'.zig' for k,v in source.items()}|dict(I='src/termio/Termio.zig',J='src/datastruct/intrusive_linked_list.zig'); scopes=[{'node':'n'+i,'scope':s} for i,*s in map(str.split,(p/'scope').read_text().splitlines())]; data={}; refs={}; roles=dict(d='declaration',i='implementation',u='use');
for l in (p/'ranges').read_text().splitlines():
 n,*atoms=l.split();n=int(n); data[n]=defaultdict(dict);refs[n]=[]
 for token in atoms:
  if token.startswith('@'):refs[n].append(int(token[1:]));continue
  key,rs=token.split(':');f=source[key];count=len(pathlib.Path(f).read_text().splitlines())
  for r in rs.split(','):
   role,a,b=re.fullmatch(r'([diu]+)(\d+)-(\d+)',r).groups();a,b=int(a),int(b);assert 1<=a<=b<=count,(r,f)
   for j in range(a,b+1): data[n][f].setdefault(j,set()).update(roles[x] for x in role)
for n in sorted(data,reverse=True):
 for child in refs[n]:
  for f,lines in data[child].items():
   for j,role in lines.items(): data[n][f].setdefault(j,set()).update(role)
maps=[]
for n in data:
 for f,lines in data[n].items():
  prev=-1
  for j,role in sorted(lines.items()):
   if prev+1==j and set(maps[-1]['role'])==role:maps[-1]['endLine']=j
   else:maps.append(dict(node=f'n{n}',path=f,startLine=j,endLine=j,role=sorted(role)))
   prev=j
out={'diagrams':[dict(diagramId='d5',nodes=scopes,mappings=maps)],'notes':''};(p/'d5.json').write_text(json.dumps(out,separators=(',',':'))+'\n');print('scopes:',len(scopes),'ranges:',len(maps))
