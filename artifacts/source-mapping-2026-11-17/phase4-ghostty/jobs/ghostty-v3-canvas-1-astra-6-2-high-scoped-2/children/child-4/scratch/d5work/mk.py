from pathlib import Path
import json,hashlib
sc=['E S R U','S','S','S R','E S R U','S R G','S B G','S B R G','E S U','S R','S R','S R G','S','S','E S R U','S','S R','B R G','S R G','S R','S R','S B G R','E S R U','S G','S R','S R G','S R','S R','S']
S=dict(S='structure',R='relationship',E='entity',U='subsystem',G='guarantee',B='behavior');nodes=[dict(node='n'+str(i+1),scope=[S[s] for s in c.split()]) for i,c in enumerate(sc)]
# Direct ranges; nested responsibility unions are evaluated in postorder below.
files={'T':'terminal/Terminal','S':'terminal/Screen','K':'terminal/ScreenSet','L':'terminal/PageList','P':'terminal/page','Q':'terminal/Selection','C':'terminal/compress/Page','M':'terminal/mem','H':'terminal/hyperlink','Y':'terminal/style','X':'termio/Termio','G':'terminal/c/grid_ref_tracked','D':'datastruct/intrusive_linked_list','Tab':'terminal/Tabstops','Mode':'terminal/modes','Ansi':'terminal/ansi','Key':'terminal/kitty/key','Img':'terminal/kitty/graphics_storage'}
spec='''
24 P:d157-176 i245-258,268-275,289-292,325-331,1907-1928 di30-82 L:i335-352,757-773,783-789
25 P:d178-180,2215-2225 i268-287,1101-1105,1120-1133
26 P:d182-186,2396-2417 i274-287,1107-1133
27 P:d90-100,202-213 i302-309,1603-1640,1707-1715
28 P:d18,114-116,197-200,215-223,2419-2421 i293-301,310-318,1410-1430,1467-1478,1496-1505,1529-1533 Y:d676-680 H:d20-23,209-217 T:u2401-2419
29 P:d188-195,225-232,2046-2049,2060-2084 i319-323 u1796-1802
23 P:d147-162 di239-331,1907-1943 L:u783-795 C:u42-50 +24,25,26,27,28,29
22 C:d1-24,42-57 i99-104,118-141,143-163 L:d79-91 i262-273,290-299,5553-5558,5590-5608,5619-5632 M:i147-156,166-180,182-198,214-248,278-308,318-330,343-358
21 L:d62,79-96 i98-108,785-789 P:d157-176 C:d42-57 +22,23
20 L:d56-77,93,407-419 i751-773,783-805,942-954,4193-4206 D:i26-38 +21
19 L:d51-63,404-405 i783-795,4061-4080,4102-4127,4193-4199,4225-4232 D:di4-38,59-88 +20
18 L:d354-356,7800-7810 i681-688,710-719,3347,3364-3379,3790-3794,3844-3856,4061,4130-4156,6310-6326 S:ui329-345,936-946,974-979,3063-3071,3095-3097 Q:ui131-149
17 L:d354-357,472-487,505,518-533 i681-705,710-719,3347,3364-3379 +18
16 L:d359-365,401-402,466-470,507-511,7601-7616 i648-679,691-700,4061-4080,4087-4089,4102-4127
15 S:d44-45 i315-337,361-367 u1719-1737,2234-2239,2310-2322 L:di648-708,727-742,978-988,1278-1285,1294-1315 +16,17,19
14 S:d77-100,119-141 i348-356,361-364,482-489 Img:d72-75,152-155
13 S:d64-75,220-232 i482-486 T:u2756-2777 Key:d5-17 Ansi:d100-109
12 S:d58-62 i3063-3106 Q:d24-25,32-52 i70-82,129-149 L:d354-357,472-473 i6310-6334
11 S:d195-199 i329-345,913-931,936-946,974-979 L:di7800-7818 P:i1120-1133
10 S:d52-56,143-199,209-218 T:ui2703-2754 +11
9 S:d1,37-56 di315-367 i441-489 u1719-1737,2234-2253,2310-2338 T:u4968-4979 +10,12,13,14,15
8 K:d1-8,17-21,30-31 i38-67,74-102 T:ui5680-5683,5689-5715,5743-5747,5868-5876 S:ui315-327,361-367
7 K:d33-36 i51,69-72,90-102 G:ui16-32,94-98 T:u4912-4916,4999-5025,5045-5047
6 K:d23-31 i43-53,104-109 T:u5680-5683,5743-5747
5 T:d48-49 i344-369,395-397 u5680-5683,5689-5715,5743-5747 K:di1-8,17-109 +6,7,8,9
4 T:d86-87,268-279 i384-392,459-478 S:d143-152
3 T:d70-77,83-84,105-106,153-175,232-251 i377-383,395-400,5570-5583,5618-5631 Mode:d16-28
2 T:d56-68,253-266 i366-376,4912-4921,4935-4948,5053-5074 Tab:d1-10 X:u304-306
1 X:d40-43 i272-306,322,335-337,354-356 T:d1-4 di344-404 i1893-1904,1910-1924,2258-2267,2300-2314,2401-2419,4968-4989,5868-5911 +2,3,4,5
'''
from collections import defaultdict
R=dict(d='declaration',u='use',i='implementation')
data={};direct={};roles='dui'
import re
for row in spec.strip().splitlines():
 n,*parts=row.split();n=int(n);m=defaultdict(list);direct[n]=[];f=None
 for part in parts:
  if part.startswith('+'):
   for k in map(int,part[1:].split(',')):
    for p,rs in data[k].items():m[p]+=rs
   continue
  if ':' in part:f,part=part.split(':');f=f'src/{files[f]}.zig'
  r,sp=re.fullmatch(r'([dui]+)([0-9,-]+)',part).groups();
  for seg in sp.split(','):
   a,*b=map(int,seg.split('-'));b=b[0] if b else a;m[f].append((a,b,r));direct[n].append((f,a,b,r))
 data[n]=m
mp=[]
for i in range(1,30):
 for p,tups in sorted(data[i].items()):
  # Merge overlaps and adjacency but keep gaps. Multiple roles permitted.
  m=[]; ln=len(Path(p).read_text().splitlines())
  for a,b,r in sorted(set(tups)):
   assert 1<=a<=b<=ln,(p,a,b)
   if m and a<=m[-1][1]+1:m[-1][1]=max(m[-1][1],b);m[-1][2].update(r)
   else:m.append([a,b,set(r)])
  for a,b,rr in m:mp.append(dict(node=f'n{i}',path=p,startLine=a,endLine=b,role=[R[r] for r in roles if r in rr]))
d=dict(diagramId='d5',nodes=nodes,mappings=mp)
Path('/tmp/d5work/d5.json').write_text(json.dumps(d,separators=(',',':')))
Path('/tmp/d5work/spec.txt').write_text(spec)
print('nodes',len(nodes),'mappings',len(mp),'bytes',Path('/tmp/d5work/d5.json').stat().st_size)
