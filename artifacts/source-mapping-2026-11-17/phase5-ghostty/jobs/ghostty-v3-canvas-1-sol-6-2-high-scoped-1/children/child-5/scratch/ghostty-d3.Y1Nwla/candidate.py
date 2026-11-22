import json, pathlib, collections, fnmatch
P = dict(G='src/renderer/generic.zig', R='src/renderer.zig', S='src/Surface.zig', A='src/App.zig', T='src/renderer/Thread.zig', ST='src/renderer/State.zig', TS='src/terminal/render.zig', IM='src/renderer/image.zig', MO='src/renderer/Metal.zig', GL='src/renderer/OpenGL.zig', MF='src/renderer/metal/Frame.zig', OF='src/renderer/opengl/Frame.zig', IOS='src/renderer/metal/IOSurfaceLayer.zig', GS='src/font/SharedGridSet.zig', FG='src/font/SharedGrid.zig', IO='src/termio/Termio.zig', SH='src/termio/stream_handler.zig', EM='src/apprt/embedded.zig', GTK='src/apprt/gtk/class/render_surface.zig', GA='src/apprt/gtk/class/application.zig', GM='src/apprt/gtk/class/surface.zig')
roles={'d':'declaration','u':'use','i':'implementation'}
scope=['subsystem relationship behavior','entity structure subsystem','structure relationship behavior','structure relationship behavior','structure relationship behavior','relationship behavior','structure guarantee','entity behavior relationship','behavior relationship guarantee','behavior guarantee','behavior relationship guarantee','behavior guarantee','subsystem behavior relationship','entity subsystem behavior relationship','subsystem structure relationship','behavior subsystem relationship','behavior relationship','behavior relationship guarantee','entity behavior relationship','behavior guarantee relationship']
a=collections.defaultdict(list)
def add(n,p,rs,lines):
 for rg in lines.split():
  se=tuple(map(int,rg.split('-'))); a[n].append((P.get(p,p),se[0],se[-1],{roles[r] for r in rs}))
def union(n,*nodes):
 for k in nodes: a[n]+=a[k]
# Teardown and direct draw.
add(20,'S','di','829'); add(20,'S','ui','833-855'); add(20,'T','di','175-189 722-731'); add(20,'T','ui','220-234 253-257'); add(20,'G','di','841-874 904-974 1074-1086 1244-1256'); add(20,'G','ui','330-339'); add(20,'src/renderer/DisplayLink.zig','di','120-146'); add(20,'IOS','di','42-48'); add(20,'MO','ui','139-146'); add(20,'GL','ui','208-214')
add(19,'S','di','922-929'); add(19,'G','di','1712-1739'); add(19,'G','i','1794-1807 1907-1910'); add(19,'EM','du','1001-1006 1988-1992'); add(19,'include/ghostty.h','d','1214'); add(19,'MO','ui','128-129 148-160'); add(19,'IOS','di','125-166'); add(19,'MF','di','105-131'); add(19,'OF','di','51-90')
# Schedule and resize.
add(18,'S','ui','632-636 711-721'); add(18,'IO','ui','314-322 335-349 702-716 736-754'); add(18,'SH','di','40-42 114-119'); add(18,'T','ui','75-80 231-237 474-493 537-542 572-585'); add(18,'G','ui','1371-1375 1408-1428 1479-1493 1555-1567'); add(18,'ST','di','13-20 36-105'); add(18,'src/termio/Exec.zig','u','1493-1495 1516-1518 1806-1811')
add(17,'S','di','2574-2579 2600-2649'); add(17,'IO','du','524-528 561-564'); add(17,'src/renderer/message.zig','d','45-46'); add(17,'T','du','290 301-303 404 487-493'); add(17,'G','di','2248-2304'); add(17,'G','ui','1843-1866 2630-2651'); add(17,'GL','di','216-236'); add(17,'MO','di','199-217')
add(16,'T','di','27-64 69-101 127-164 231-257 289-444 460-688'); add(16,'src/renderer/message.zig','d','9-74'); add(16,'G','du','946-956 1074-1086 1107-1188 1273-1312'); add(16,'G','u','1371-1375 1716-1731'); union(16,17)
# Presentation.
add(14,'G','di','1016-1072 1712-2067'); add(14,'MO','di','78-129 199-217 236-243 377-387'); add(14,'MF','di','29-131'); add(14,'IOS','di','50-123'); add(14,'src/renderer/metal/RenderPass.zig','di','58-229'); add(14,'GL','di','216-225 273-298 438-449'); add(14,'OF','di','24-90'); add(14,'src/renderer/opengl/RenderPass.zig','di','51-144'); add(14,'IM','ui','70-191 778-811'); add(14,'src/apprt/surface.zig','ui','186-207'); add(14,'A','ui','161-167 273-281 291-294 531-550 597-613'); add(14,'S','ui','1154 1777-1787'); add(14,'src/apprt/gtk/App.zig','ui','56-68'); add(14,'GA','ui','569-576 772 2877-2882'); add(14,'GM','di','831-838'); add(14,'GTK','di','149-205 307-436 446-451')
# Locking and snapshot construction.
add(12,'G','du','1371-1375 1420-1421 1555-1567'); add(12,'ST','di','74-80'); add(12,'TS','di','362-370 868-883 1416-1484 1546-1567'); add(12,'TS','i','2843-2864')
add(11,'G','du','1371-1375 1399-1409 1420-1421 1479-1562'); add(11,'ST','d','19-34 107-128'); add(11,'ST','di','135-140'); add(11,'TS','di','919-1414 2652-2900'); add(11,'TS','ui','802-826 2114-2216'); add(11,'IM','di','253-390 397-486 666-695')
add(10,'G','dui','1371-1375 1420-1477'); add(10,'src/terminal/Terminal.zig','di','3521-3530'); add(10,'src/terminal/Screen.zig','di','1718-1737'); add(10,'src/terminal/PageList.zig','di','3344-3365'); add(10,'src/terminal/kitty/graphics_storage.zig','di','1227-1365')
add(9,'S','ui','632-636'); add(9,'G','du','1371-1375 1408-1428 1479-1500'); add(9,'ST','di','13-20 36-80'); add(9,'TS','di','939-1027 1155-1283 1399-1414'); add(9,'IO','ui','702-711'); add(9,'src/termio/Exec.zig','u','1516-1518 1808-1811')
add(13,'G','du','1371-1375 1479-1487 1508-1526 1564-1567'); add(13,'G','ui','1581-1705 1868-1905 1950-2000 2623-3672 3674-3691'); add(13,'TS','i','1173-1198 1290-1397'); add(13,'src/renderer/cursor.zig','di','34-68'); add(13,'src/renderer/cell.zig','di','42-154 168-203'); add(13,'src/font/main.zig','d','21-25 43-51'); add(13,'src/font/shape.zig','di','19-58 70-94'); add(13,'src/font/shaper/run.zig','di','41-396'); add(13,'src/font/shaper/harfbuzz.zig','di','114-260'); add(13,'src/font/shaper/coretext.zig','di','303-544'); add(13,'src/font/shaper/noop.zig','di','69-118'); add(13,'src/font/shaper/web_canvas.zig','di','63-203'); add(13,'src/font/shaper/Cache.zig','di','47-87'); add(13,'FG','di','41-64 377-464'); add(13,'IM','di','70-191 253-390 397-486 666-695 778-811'); add(13,'MO','di','346-375'); add(13,'GL','di','409-436')
add(8,'S','ui','597-605 631-636'); add(8,'T','ui','72-76 151-164 572-580'); add(8,'G','di','1371-1710'); union(8,9,10,11,12,13)
# Graphics choices and resource ownership.
add(7,'R','di','16-19 35-45'); add(7,'src/build_config.zig','d','36-43'); add(7,'src/renderer/backend.zig','di','4-17'); add(7,'MO','d','20-38'); add(7,'GL','d','15-34'); add(7,'G','du','90-109')
add(6,'A','d','57-58'); add(6,'A','i','126-132 136-151'); add(6,'S','ui','564-588'); add(6,'src/renderer/Options.zig','d','7-9'); add(6,'R','d','39-45'); add(6,'G','u','712-721 870-871'); add(6,'MO','di','42-71 131-146 179-196 220-234 245-255'); add(6,'GL','di','47-96 199-214 273-298'); add(6,'src/renderer/metal/Device.zig','di','34-66'); add(6,'src/renderer/opengl/Device.zig','di','37-74 102-105')
add(5,'A','d','53-55'); add(5,'A','i','119-124 130 141-146'); add(5,'GS','di','38-48 88-154 411-431'); add(5,'FG','di','41-64 83-128 377-464'); add(5,'S','ui','528-534 580-588 627-631 870-871 2536-2572'); add(5,'src/renderer/Options.zig','d','14-15'); add(5,'T','ui','397-400'); add(5,'G','d','204-207'); add(5,'G','ui','731-741 818-821 865-871 1314-1358 1889-1905 3477-3537 3674-3691')
add(4,'G','d','172-228 250-272 302-320 356-393'); add(4,'G','di','321-354 395-469 725-729 759-761 818-836 865-871 914-943 1244-1256'); add(4,'G','u','1645-1665 1868-1905'); add(4,'src/renderer/cell.zig','di','42-127'); add(4,'IM','di','16-103 778-811'); add(4,'src/font/main.zig','d','21-25'); add(4,'src/font/shape.zig','d','19-36'); add(4,'src/font/shaper/Cache.zig','di','47-87')
add(3,'G','d','274-281'); add(3,'G','ui','841-847 1381-1392 1479-1493 1564-1567 2630-2636'); add(3,'src/terminal/main.zig','d','51'); add(3,'TS','di','289-399 885-899 919-1027 1399-1484 2652-2900'); add(3,'TS','i','1029-1128 1136-1299')
# Parent coordination, then inherit in-scope responsibility coverage.
add(15,'S','d','92-102'); add(15,'S','ui','597-605 631-637 753-759'); add(15,'R','d','22-23'); add(15,'T','d','3'); add(15,'T','di','113-173 191-257'); union(15,16,17,18,19,20)
add(2,'R','di','16-25 35-45'); add(2,'S','d','44-45 92-102'); add(2,'S','ui','564-605 631-637'); add(2,'G','d','90-116 118-170 274-296 3692-3693'); add(2,'G','di','712-874 904-974 1186-1190 1244-1256'); union(2,3,4,5,6,7,8,14)
add(1,'R','d','1-8'); add(1,'S','d','74-102'); add(1,'S','ui','477-483 564-605 631-637 711-721 753-759'); union(1,2,15)
# Consolidate overlaps, preserving exact covered lines and role assignments.
entries=[]
for n in range(1,21):
 lines=collections.defaultdict(dict)
 for p,s,e,rs in a[n]:
  items=pathlib.Path(p).read_bytes().splitlines(); assert 1<=s<=e<=len(items),(p,s,e,len(items)); assert not fnmatch.fnmatch(p,'*/build/*')
  for i in range(s,e+1): lines[p].setdefault(i,set()).update(rs)
 for p,ls in sorted(lines.items()):
  start=end=0; rr=None
  for i in sorted(ls):
   if start and i!=end+1:
    entries.append({'node':f'n{n}','path':p,'startLine':start,'endLine':end,'role':sorted(rr)}); start=0
   if not start: start=i; rr=set()
   rr.update(ls[i])
   end=i
  if start: entries.append({'node':f'n{n}','path':p,'startLine':start,'endLine':end,'role':sorted(rr)})
res={'diagrams':[{'diagramId':'d3','nodes':[{'node':f'n{i}','scope':s.split()} for i,s in enumerate(scope,1)],'mappings':entries}], 'notes':'d3 n14/n19: Metal synchronously presents when sync is true. OpenGL ignores that flag at frame completion and hands an exported frame to GTK for presentation. The native macOS layer callback can also invoke drawFrame(true) directly, without going through Surface.draw.'}
print(json.dumps(res,separators=(',',':')))
