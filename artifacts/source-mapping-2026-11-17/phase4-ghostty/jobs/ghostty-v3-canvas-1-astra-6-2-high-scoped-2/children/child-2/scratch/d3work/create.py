import json,pathlib,collections
P=pathlib.Path
sc={'s':'structure','e':'entity','b':'behavior','r':'relationship','g':'guarantee','y':'subsystem'}
rs={'d':'declaration','u':'use','i':'implementation'}
scope='sbr y'.replace(' ','')
scopes=['sebry','sebr y'.replace(' ',''),'ser','sr','srg','srg','sr','ebr','brg','brg','br','brg','bry','ebry','sebry','br','br','brg','ebr','brg']
N=lambda i:'n'+str(i)
diag={'diagramId':'d3','nodes':[{'node':N(i),'scope':[sc[c] for c in v]} for i,v in enumerate(scopes,1)],'mappings':[]}
a=dict(G='renderer/generic',T='renderer/Thread',S='Surface',A='App',M='renderer/Metal',O='renderer/OpenGL',R='renderer',ST='renderer/State',TR='terminal/render',I='renderer/image',IO='termio/Termio',MSG='renderer/message',Opt='renderer/Options',Grid='font/SharedGrid',Set='font/SharedGridSet',C='renderer/cell',Mf='renderer/metal/Frame',Of='renderer/opengl/Frame',Gtk='apprt/gtk/class/render_surface',Layer='renderer/metal/IOSurfaceLayer')
rows=collections.defaultdict(list)
def setnode(n,text):
 for t in text.split():
  k,r,sp=t.split(':'); path='src/'+a.get(k,k)+'.zig'
  for bounds in sp.split(','):
   j=[int(z) for z in bounds.split('-')]; rows[n].append((path,j[0],j[-1],set(r)))
def union(n,*children):
 for m in children: rows[n]+=list(rows[m])
setnode(3,'''G:d:274-281 G:ui:841,846-847,1381-1392,1484-1487,1564-1567 terminal/main:d:51 TR:d:282-334 TR:i:885-899,1029-1039,1242-1279''')
setnode(4,'''G:d:172-192,204-228,254-258,271-272,302-320,365-393 G:i:321-353,395-469,725-729,759-762,816-836,841,865-873,914-943,1244-1256 G:u:1868-1880 C:d:42-74 I:d:15-57 I:i:60-68,76-103,778-811 font/main:d:22-23 font/shape:d:19-36''')
setnode(5,'''A:d:53-55 A:i:123-124,130,136-146 S:ui:477-484,528-534,580-584,624-630,870-871,2536-2547,2555-2572 Opt:d:14-15 G:d:204-205 G:ui:731-741,818-821,1317-1358,1889-1905,3491-3501 MSG:d:29-43 T:i:397-400 Grid:d:41-64 Set:i:94-154,411-431 Grid:i:379-412,434-464''')
setnode(7,'''R:d:16-19 R:di:35-45 M:d:20-31 O:d:15-26''')
setnode(6,'''A:d:57-58 A:i:131,136-139,148-151 S:ui:477-484,564-570,580-588 Opt:d:7-9 G:ui:712-721,823-825,870-871 M:d:42-48 M:i:56-71,131-146 O:di:47-96 renderer/metal/Device:i:34-66 renderer/opengl/Device:i:37-74,102-105'''); union(6,7)
setnode(9,'''ST:d:13-20 ST:di:67-72 S:i:633-636 G:d:1371-1375 G:ui:1420-1427,1484-1500 TR:i:941-947,983-1027,1199-1204,1399-1414''')
setnode(10,'''G:d:1371-1375 G:ui:1420-1421,1429-1477 terminal/Terminal:i:3521-3530 terminal/Screen:i:1719-1730 terminal/PageList:i:3347-3365 terminal/kitty/graphics_storage:i:1240-1249,1305-1365''')
setnode(11,'''G:d:1371-1375 G:ui:1399-1406,1420-1421,1479-1487,1502-1545,1555-1562 ST:d:26-34 ST:i:135-140 TR:di:920-1414 I:i:253-377,398-452,454-486,666-689''')
setnode(12,'''G:d:1371-1375 G:ui:1408-1409,1420-1421,1484-1487,1555-1567 ST:di:74-80 TR:di:1416-1484''')
setnode(13,'''G:d:1371-1375 G:ui:1508-1526,1564-1567,1634-1665,1694-1705 G:i:2630-2923,2925-3372,3477-3626,3628-3672 I:i:253-289,318-350,375-377,454-486 renderer/cursor:i:34-68 C:i:130-154,181-203 font/shape:d:19-58,70-94 font/shaper/run:di:13-51,270-304 Grid:i:379-464 font/CodepointResolver:i:327-349 font/shaper/harfbuzz:i:131-154,229-260 font/shaper/coretext:i:316-320,356-385,505-544 font/shaper/noop:i:79-118 font/shaper/web_canvas:i:81-103,183-203''')
setnode(8,'''S:u:477-484,597-605,631-637 T:u:116-122,151-164,572-580 G:di:1371-1710''');union(8,9,10,11,12,13)
setnode(14,'''G:di:1712-2067 G:i:1016-1072,3677-3691 M:i:56-60,78-117,128-137,200-243,378-387 Mf:i:29-56,67-131 renderer/metal/RenderPass:i:124,212-229 Layer:i:50-89,96-123 O:i:217-225,265-298,439-449 Of:i:24-90 renderer/opengl/RenderPass:i:62,131-144 I:i:76-191 apprt/surface:i:186-207 A:i:164-167,273-274,293,532-542,605-612 S:ui:1017,1154,1779-1787 apprt/gtk/class/application:ui:692-699,772,2877-2882 apprt/gtk/App:ui:61-68 apprt/gtk/class/surface:ui:835-838 Gtk:i:149-205,307-365,390-429,451''')
setnode(17,'''MSG:d:45-46 S:ui:2577-2579,2618,2640-2649 IO:ui:524-528,561-564 T:i:290,301-303,404,474-479,485-494 G:di:2249-2304 O:i:227-236''')
setnode(16,'''T:d:27,37-64,69-80 T:di:200,231-257,290-444,462-494,519-586,596-652,654-688 G:i:946-956,1074-1086,1136-1175,1186-1190,1273-1312 G:d:1371-1375,1716-1719''');union(16,17)
setnode(18,'''S:i:597-604,633-636,717-719 IO:ui:254,314-322,335-341,346-349,702-716,750-754 termio/stream_handler:di:114-119 T:ui:231-237,474-479,485-494,537-542,567-580 ST:di:13-20,67-80 G:ui:1371-1375,1420-1427,1484-1500,1555-1567''')
setnode(19,'''S:di:922-929 apprt/embedded:u:1001-1006,1988-1992 G:di:1712-1743 G:i:1794-1806,1907-1909 M:ui:148-160 Mf:i:122-131 Of:i:51-58''')
setnode(20,'''S:i:829,833-838,847-855 T:i:175-189,200,220-234,253-257,722-731 G:i:841-874,914-943,958-974 renderer/DisplayLink:i:128-140''')
setnode(15,'''S:d:92-102 S:i:477-484,592-605,631-637,753-759 T:d:23-80 T:di:116-173,191-257,495-497,749-857 G:u:946-974''');union(15,16,18,19,20)
setnode(2,'''S:u:44-45,92-93,574-590,631 R:du:17-19,35-42 G:di:51-3693''');union(2,3,4,5,6,8,14)
setnode(1,'''S:d:92-102 S:i:574-605,631-637,717-719,753-759 R:d:17-23,35-45''');union(1,2,15)
# Canonical disjoint ranges, taking the union of roles when coalescing.
for i in range(1,21):
 segs=[]
 for path,start,end,role in sorted(rows[i],key=lambda x:x[:3]):
  if segs and path==segs[-1][0] and start<=segs[-1][2]+1:
   old=segs[-1]; old[2]=max(end,old[2]); old[3]|=role
  else:segs.append([path,start,end,set(role)])
 for path,start,end,role in segs:
  diag['mappings'].append(dict(node=N(i),path=path,startLine=start,endLine=end,role=[v for k,v in rs.items() if k in role]))
out={'diagrams':[diag],'notes':''}
D=P('/tmp/d3work')
(D/'candidate.json').write_text(json.dumps(out,separators=(',',':')))
# Bounds-check and read all selected intervals numbered per original file.
readrows=collections.defaultdict(set)
for m in diag['mappings']:readrows[m['path']].update(range(m['startLine'],m['endLine']+1))
for path,sel in readrows.items():
 lines=P(path).read_text().splitlines(); assert sel and min(sel)>=1 and max(sel)<=len(lines),(path,max(sel))
 dst=D/'review'/path;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_text('\n'.join(f'{i:6}\t{lines[i-1]}' for i in sorted(sel))+'\n')
print(len(diag['mappings']),len(readrows),'files;',sum(map(len,readrows.values())),'unique lines')
