import json,pathlib
sc={n:s for n,*s in (row.split() for row in open('/tmp/terminal/scope'))}; m={k:{} for k in sc}
paths={'T':'src/terminal/Terminal.zig','SS':'src/terminal/ScreenSet.zig','S':'src/terminal/Screen.zig','L':'src/terminal/PageList.zig','P':'src/terminal/page.zig','Sel':'src/terminal/Selection.zig','V':'src/terminal/stream_terminal.zig','Lib':'src/lib_vt.zig','M':'src/terminal/main.zig','IO':'src/termio/Termio.zig','RS':'src/renderer/State.zig','R':'src/terminal/render.zig'}
rows='''54 T D56-68 D253-266 I366-376
55 T D70-87 D167-182 D268-279 I377-387
57 SS D1-8 DI38-53 DI74-88 DI90-102
57 T U5680-5683 UI5689-5715 U5758-5762 UI5783-5785
58 SS D23-31 I47-52 DI104-109
58 T U5680-5683 UI5740-5747 DI2301-2314 I2401-2409
56 T D48-49 UI356-370
56 SS D17-36 DI55-67
60 S D52-65 D74-75
61 S D77-98 D100-119 U348-356 DI3017-3051 UI3095-3097
63 L D51-63 D88-91 D404-405 D465-470 DI4061-4089 I4110-4128 I4225-4236
64 P D147-162 D173-186 D2215-2231 D2394-2427 DI1101-1118 DI1120-1133
64 L D88-91 U7812-7818
65 L D472-487 D7785-7810 I681-688 I701-708 DI710-719 DI6309-6334 DI1682-1692 I1813-1825 D4061-4062 I4130-4156
65 S D58-62 D195-199 D315-319 UI329-345 DI3063-3071 I3095-3097
65 Sel DI129-149
62 S D44-50 UI315-346 U361-367
62 L D1-4 DI648-708 DI977-988
59 S D1-1 DI315-367 DI983-993 I1012-1018 UI1034-1044
59 T U3400-3408 UI3439-3456 UI3466-3471
59 S DI1139-1150
53 T D1-4 DI1893-1904 UI2207-2213 DI2272-2277 UI2292-2298 DI2301-2314 I2401-2409 DI4275-4324
53 V U635-682
53 S DI1929-1936 I2026-2035
52 M D60-61
52 Lib U96-98
52 IO D40-46
52 RS D19-20
52 R U939-947
52 T DI344-404 DI406-430'''
roles={'D':'declaration','U':'use','I':'implementation'}
for line in rows.splitlines():
 n,p,*ranges=line.split(); n='n'+n; p=paths[p]; d=m[n].setdefault(p,{})
 for r in ranges:
  role=r.rstrip('0123456789-'); a,b=map(int,r[len(role):].split('-')); assert 0<a<=b<=len(pathlib.Path(p).read_text().splitlines());
  for i in range(a,b+1): d.setdefault(i,set()).update(role)
for n,children in [(53,[54,55]),(56,[57,58]),(62,[63,64,65]),(59,[60,61,62]),(52,[53,56,59])]:
 out=m['n'+str(n)];
 for c in children:
  for p,d in m['n'+str(c)].items():
   for i,v in d.items(): out.setdefault(p,{}).setdefault(i,set()).update(v)
result=[]
for n,files in m.items():
 for p,d in files.items():
  intervals=[]
  for i,v in sorted(d.items()):
   if intervals and intervals[-1][1]+1==i: intervals[-1][1]=i; intervals[-1][2].update(v)
   else: intervals.append([i,i,set(v)])
  for a,b,v in intervals: result.append(dict(node=n,path=p,startLine=a,endLine=b,role=[val for key,val in roles.items() if key in v]))
json.dump(dict(diagrams=[dict(diagramId='d1',nodes=[dict(node=n,scope=v) for n,v in sc.items()],mappings=result)],notes=''),open('/tmp/terminal/subset.json','w'))
