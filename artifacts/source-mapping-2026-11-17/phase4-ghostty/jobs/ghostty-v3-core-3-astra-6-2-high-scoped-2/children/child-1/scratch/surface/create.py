import re,json,collections,pathlib
P=pathlib.Path('/tmp/surface'); D={}; nodes=[]
for line in (P/'scopes').read_text().splitlines():
 n,*s=line.split();D[int(n)]={};nodes.append(dict(node='n'+n,scope=s))
for line in (P/'ranges').read_text().splitlines():
 n,path,*ranges=line.split(); p='src/'+path+'.zig'; d=D[int(n)].setdefault(p,{}); txt=pathlib.Path(p).read_text().splitlines()
 for r in ranges:
  a,b,c=re.fullmatch('([DUI]+)([0-9]+)(?:-([0-9]+))?', r).groups();b,c=int(b),int(c or b); assert 1<=b<=c<=len(txt)
  for i in range(b,c+1): d.setdefault(i,set()).update(a)
# inherit where child's work is the parent's, using just handoffs for external services.
for n,k in [(5,7),(8,9),(18,19),(20,21),(20,22),(20,23),(12,13),(12,17),(12,18),(12,20),(2,3),(2,4),(2,5)]:
 for p,ls in D[k].items():
  for i,rs in ls.items(): D[n].setdefault(p,{}).setdefault(i,set()).update(rs)
# nav ranges relevant to ownership, not all internal drawing, service loops, or list ops.
for n,k,paths in [(12,14,['termio/Termio','termio/backend']), (12,15,['renderer','renderer/Options']), (12,16,['renderer/Thread','termio/Thread']),(2,8,['App']), (5,6,['Surface','apprt/gtk/class/application'])]:
 for p in ['src/'+s+'.zig' for s in paths]:
  for i,rs in D[k].get(p,{}).items(): D[n].setdefault(p,{}).setdefault(i,set()).update(rs)
m=[]; roles={'D':'declaration','U':'use','I':'implementation'}
for n,ps in D.items():
 for p,ls in ps.items():
  # merge contiguous lines, assign roles belonging to the entire block
  for i,rs in sorted(ls.items()):
   if m and m[-1]['node']==f'n{n}' and m[-1]['path']==p and m[-1]['endLine']==i-1:
    m[-1]['endLine']=i;m[-1]['role']=list(dict.fromkeys(m[-1]['role']+[roles[s] for s in sorted(rs)]))
   else: m.append(dict(node=f'n{n}',path=p,startLine=i,endLine=i,role=[roles[s] for s in sorted(rs)]))
out={'diagrams':[{'diagramId':'d1','nodes':nodes,'mappings':m}],'notes':'d1/n11: App.device is optional (?*renderer.Device) and initialized lazily. d1/n18: Surface stores DerivedConfig by value, not a Config pointer. This does not imply every member is a deep copy: .title = config.title (Surface.zig:424); it is tested for null at 1023.'}; (P/'candidate.json').write_text(json.dumps(out,separators=(',',':')));print(len(m),'ranges')
