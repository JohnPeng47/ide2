import json,pathlib
sc=['behavior relationship subsystem','structure entity behavior relationship subsystem','entity behavior relationship','structure behavior relationship guarantee','behavior relationship','entity behavior guarantee','entity behavior relationship','structure entity behavior relationship subsystem','entity','structure behavior relationship','behavior relationship subsystem','entity behavior relationship','behavior relationship guarantee subsystem','structure behavior relationship','behavior relationship','behavior guarantee']
a='''36 S:UI633-636,711-721 E:UI139-145,1478-1495,1696-1705,1789-1811 T:UI312-328,335-351,702-762 ST:I831-931,1553-1593 H:UI188-199,208-247,327-332,353-384,516-553,1000-1035 A:UI532-542,161-167,272-274,293-293 AP:UI192-206 W:UI349-366 E:UI459-467 H:UI114-119,138-154 R:UI474-493,570-580 B:UI76-86 T:UI456-463 M:UI63-72,100-108
37 S:UI687-701,711-721 B:D22-25,UI39-48 W:UI266-272 T:UI367-371,389-400 E:D1-4,44-45,587-609,DI49-61,UI86-104,129-156,196-230 @38 @39 @40
38 S:UI651-659,687-696 E:UI86-104,763-769,829-853,871-875,DI897-1095 P:D19-23,I134-151,344-346,419-425,439-455 C:DI163-176,I178-209,223-233,236-261,305-309,418-436
39 E:UI139-145,D1305-1318,1359-1384,1403-1413,I1431-1443,1462-1505,1516-1520,1522-1539,1551-1579,1685-1717 T:UI705-716,740-754
40 E:UI139-145,1083-1088,DI1778-1826 T:UI705-716,740-754
41 T:D40-50,DI702-716,UI740-754 S:UI633-636
42 T:D64-66,UI312-328,335-349,740-754 H:D96-96,UI188-199 ST:D588-607,DI722-739,I831-931,939-948,1002-1009,1553-1593 Pa:I257-285
43 H:D19-96,DI101-119,138-154,160-199,208-394,I396-414,516-557,866-911,1000-1035,1235-1286 T:UI312-328,335-349,714-716,740-762 ST:UI722-730,1577-1593
44 H:DI19-1958
45 H:D19-29,65-96,I188-199,208-306,329-352,369-384,396-446,516-553,1235-1286,1357-1386 T:UI312-328,335-349
46 H:UI151-154,329-332,523-532,866-911,925-928 T:UI314-318,756-762,456-463 M:I57-108 W:UI272-273,289-296,307-314,349-367,453-471 B:UI76-86 E:UI129-131,148-154,I403-469
47 S:UI717-720 T:UI314-322,705-716 H:D40-42,DI114-119 R:UI232-232,474-493,537-542,556-580
48 H:UI236-236,358-365,555-557,1000-1035 @49 @50 GTK:I57-59 GTC:I572-576,1322-1325 EM:I269-271,1732-1736
49 S:UI573-573,711-721 T:UI314-322 H:D31-32,UI138-149,1028-1035 AP:DI186-207 A:D49-51,577-581,DI596-613,UI273-274,293-293
50 A:DI161-167,272-306,531-550 S:DI1015-1241
51 A:DI531-550'''
files=dict(S='Surface',E='termio/Exec',T='termio/Termio',W='termio/Thread',B='termio/backend',P='pty',C='Command',H='termio/stream_handler',ST='terminal/stream',Pa='terminal/Parser',M='termio/mailbox',A='App',AP='apprt/surface',R='renderer/Thread',GTK='apprt/gtk/App',GTC='apprt/gtk/class/application',EM='apprt/embedded'); rmap=dict(D='declaration',U='use',I='implementation'); import re,collections
rec={}; inh={};
for l in a.splitlines():
 n,*t=l.split(); dic=rec[int(n)]=collections.defaultdict(lambda:collections.defaultdict(set)); parents=inh[int(n)]=[]
 for item in t:
  if item.startswith('@'):parents.append(int(item[1:]));continue
  f,ss=item.split(':'); file='src/'+files[f]+'.zig'; role=None
  for ra in ss.split(','):
   k,b,e=re.fullmatch('([DUI]*)(\\d+)-(\\d+)',ra).groups(); role=k or role
   for i in range(int(b),int(e)+1):dic[file][i].update(role)
def expanded(n):
 d=rec[n]
 for ch in inh[n]:
  for f,vals in expanded(ch).items():
   for i,rr in vals.items():d[f][i]|=rr
 return d
nodes=[];mappings=[]
for n,s in enumerate(sc,36):
 node='n%d'%n;nodes.append(dict(node=node,scope=s.split()));
 for p,vals in expanded(n).items():
  b=0;r=();prev=0
  for i in sorted(vals):
   if i!=prev+1 or vals[i]!=r:
    if b:mappings.append(dict(node=node,path=p,startLine=b,endLine=prev,role=[v for k,v in rmap.items() if k in r]))
    b=i;r=vals[i]
   prev=i
  if b:mappings.append(dict(node=node,path=p,startLine=b,endLine=prev,role=[v for k,v in rmap.items() if k in r]))
for m in mappings: assert m['endLine']<=len(pathlib.Path(m['path']).read_text().splitlines())
open('/tmp/output/d1-36-51.json','w').write(json.dumps(dict(diagrams=[dict(diagramId='d1',nodes=nodes,mappings=mappings)],notes='')))
