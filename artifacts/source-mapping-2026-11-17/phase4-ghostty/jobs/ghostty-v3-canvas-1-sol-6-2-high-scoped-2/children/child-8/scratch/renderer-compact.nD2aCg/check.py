from pathlib import Path
import json, re, subprocess, itertools
p=Path(__file__).with_name('records')
lines=p.read_text().splitlines()
mods={
 'n1':('R:1-8:d S:74-102:d S:474-484:d S:536-562:ui S:623-637:ui RT:39-53:di','R:1-8:d S:74-102:d S:474-484:d S:536-562:ui RT:39-53:di'),
 'n2':(' G:260-269:d',''),
 'n3':(' G:1562-1567:u',''),
 'n4':('G:712-729:di G:759-761:ui G:816-829:ui G:865-901:dui G:914-943:dui G:1232-1256:dui G:1771-1783:ui G:1811-1905:ui G:2046-2168:dui G:2171-2191:ui','G:712-729:di G:759-761:ui G:816-829:ui G:865-901:dui G:911-943:dui G:1232-1256:dui G:1771-1905:ui G:2046-2191:dui'),
 'n5':('S:81-84:d S:528-534:ui S:580-589:u S:627-631:u S:870-871:ui S:2536-2572:dui Opt:14-15:d Msg:29-43:d','S:81-84:d S:528-534:ui S:580-589:u S:627-631:u S:870-871:ui S:2536-2572:dui Msg:29-43:d'),
 'n6':(' M:179-197:ui M:219-234:ui',' M:179-234:ui'),
 'n7':('R:16-19:d R:35-45:dui S:44-45:du G:90-109:du BC:34-43:du B:4-17:di M:20-38:d O:15-34:d','R:16-19:d R:35-45:dui S:44-45:du G:90-109:du BC:34-43:du B:4-17:di M:20-31:d O:15-26:d'),
 'n8':(' G:1410-1419:i',''),
 'n9':(' S:592-595:i',''),
 'n10':(' PL:7385-7397:dui',' PL:7388-7397:dui'),
 'n11':('G:1399-1409:d G:1420-1421:u G:1479-1562:ui','G:1399-1421:du G:1479-1562:ui'),
 'n12':(' G:1645-1659:u',''),
 'n13':(' G:1484-1487:u',''),
 'n14':('G:321-354:dui G:876-901:dui G:1016-1072:dui G:1712-2067:dui G:2158-2168:dui G:2432-2555:dui G:3674-3691:dui G:1206-1215:di','G:321-354:dui G:876-901:dui G:1016-1072:dui G:1206-1215:di G:1712-2067:dui G:2158-2168:dui G:2432-2555:dui G:3674-3691:dui'),
 'n15':(' T:749-812:dui',''),
 'n16':('T:116-164:dui T:200-200:d T:220-257:ui','T:116-164:dui T:200-257:dui'),
 'n17':('T:290-290:d T:301-303:ui T:404-404:ui','T:290-303:du T:404-404:ui'),
 'n18':('IO:312-328:ui IO:335-349:ui','IO:312-349:ui'),
 'n19':(' G:1794-1807:ui G:1907-1909:ui',' G:1794-1807:ui G:1907-1909:ui'),
 'n20':('T:220-234:ui T:253-257:ui','T:220-257:ui'),
}
remove={
'n4':'Cache:32-87:di G:759-761:ui M:219-234:dui O:252-271:dui',
'n5':'A:123-131:ui G:865-871:ui G:2973-2989:u',
'n6':'G:823-825:u G:870-873:ui',
'n11':'S:1712-1717:ui',
'n13':'F:16-28:d F:43-51:di FG:224-250:dui',
'n14':'G:2158-2168:dui T:402-402:ui GApp:692-698:d MT:44-103:dui',
'n15':'O:197-214:dui',
'n16':'S:2574-2579:dui DL:148-174:dui',
'n17':'Size:28-44:dui',
'n19':'O:197-206:di',
'n20':'G:1273-1298:ui ML:42-48:dui O:92-96:di',
}
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
tracked=set(subprocess.check_output(['git','ls-files'],text=True).splitlines()); aliases={}; nodes={}; roles={'d':'declaration','u':'use','i':'implementation'}; scope=dict(zip('sebrgx','structure entity behavior relationship guarantee subsystem'.split())); file_lines={}; count=0
for l in lines:
 if not l: continue
 k,s,*refs=l.split()
 if not refs:
  assert s in tracked and not set(s.split('/')) & {'build','docs','tests','test','deps','vendor','scripts','examples','node_modules','fixtures'}; aliases[k]=s; file_lines[s]=len(Path(s).read_text().splitlines()); continue
 assert k not in nodes and s and all(c in scope for c in s) and len(s)==len(set(s))
 nodes[k]=(s,refs)
 for ref in refs:
  if ref.startswith('+'): continue
  a,x,r=ref.split(':'); lo,hi=map(int,(x.split('-'))); path=aliases[a]
  assert 1<=lo<=hi<=file_lines[path],(k,ref,file_lines[path]); assert r and all(c in roles for c in r); count+=1
assert set(nodes)=={f'n{k}' for k in range(1,21)}
def expand(node):
 out={}
 for x in nodes[node][1]:
  if x.startswith('+'):
   for k,v in expand(x[1:]).items(): out.setdefault(k,set()).update(v)
  else:
   a,lines,r=x.split(':'); lo,hi=map(int,lines.split('-'))
   for line in range(lo,hi+1): out.setdefault((aliases[a],line),set()).update(r)
 return out
mapping=[]
for n in nodes:
 pmap=expand(n)
 for (path,r),g in itertools.groupby(sorted(pmap),(lambda k:(k[0],''.join(x for x in roles if x in pmap[k])))):
  last=None
  for _,j in g:
   if last is not None and j==last['endLine']+1: last['endLine']=j
   else:
    last=dict(node=n,path=path,startLine=j,endLine=j,role=[roles[k] for k in r]); mapping.append(last)
candidate={'diagrams':[{'diagramId':'d3','nodes':[dict(node=n,scope=[scope[c] for c in s]) for n,(s,_) in nodes.items()],'mappings':mapping}],'notes':'d3 n19: main-thread sync drawing is the embedded/Metal path; GTK/OpenGL exports frames on the renderer thread and composites them on the main thread. OpenGL ignores the sync flag.'}
p.with_name('d3-candidate.json').write_text(json.dumps(candidate))
print('compact records:',count,'expanded JSON ranges:',len(mapping))
