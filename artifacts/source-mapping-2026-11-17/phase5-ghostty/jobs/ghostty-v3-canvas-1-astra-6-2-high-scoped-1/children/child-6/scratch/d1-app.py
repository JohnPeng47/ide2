import collections,json,os
# Assign scopes first. n1 contains app/host/session coordination anchors only; parent aggregates.
scopes=['subsystem relationship','entity structure behavior relationship subsystem','structure behavior relationship guarantee','structure behavior relationship subsystem','entity behavior relationship guarantee','structure behavior relationship guarantee','structure behavior relationship guarantee','entity behavior relationship guarantee']
D={'diagramId':'d1','nodes':[{'node':f'n{i}','scope':s.split()} for i,s in enumerate(scopes,1)],'mappings':[]}
r=collections.defaultdict(lambda:collections.defaultdict(dict)); rs={'d':'declaration','u':'use','i':'implementation'}
def add(n,path,*spec):
 for token in ' '.join(spec).split():
  tag,rng=token.split(':'); v=list(map(int,rng.split('-'))); lo,hi=v[0],v[-1]; assert 1<=lo<=hi<=sum(1 for l in open(path));
  for idx in range(lo,hi+1): r[n][path].setdefault(idx,set()).update(tag)
a='src/App.zig';s='src/Surface.zig';g='src/renderer/generic.zig';f='src/font/SharedGridSet.zig';e='src/apprt/embedded.zig';h='src/apprt/gtk/class/surface.zig';t='src/apprt/gtk/class/application.zig';b='src/apprt/surface.zig';sw='macos/Sources/Ghostty/Ghostty.App.swift'
add(3,a,'d:22 d:27-28 d:45-47 i:128 di:199-260 di:313-316 di:544-550');add(3,s,'u:3466 u:3471-3473');add(3,e,'u:518-520 u:641-645 i:670-672');add(3,h,'u:1963-1970 u:3557-3570');add(3,'src/apprt/gtk/Surface.zig','i:25-29');add(3,b,'u:238-246');
add(5,a,'di:161-167 di:272-306 di:531-550');add(5,s,'di:1017-1241');add(5,t,'u:500 u:569-576');add(5,e,'u:1730-1736');
add(4,a,'d:49-51 i:129 d:562-594 di:596-613');add(4,b,'di:186-207');add(4,s,'i:573 u:585 u:711-721');add(4,'src/termio/Termio.zig','i:342 i:389-399');add(4,'src/termio/Exec.zig','ui:274-315');add(4,'src/datastruct/blocking_queue.zig','d:29-34 d:56-72 i:99-168');add(4,'src/apprt/gtk/App.zig','ui:56-59');add(4,t,'i:1322-1325');add(4,e,'ui:269-271');add(4,sw,'u:58-62 ui:119-122 ui:526-534');
add(6,a,'d:53-55 i:119-131 i:141-146');add(6,f,'d:1-10 d:38-48 di:52-86 di:88-154 di:411-431 d:433-438 d:468-472');add(6,s,'d:81-84 ui:528-534 u:580-585 i:627 u:870-871 ui:2535-2572');add(6,'src/renderer/message.zig','d:29-43');add(6,'src/renderer/Thread.zig','ui:397-400');add(6,g,'i:818-821 i:1317-1322');
add(7,a,'d:57-58 i:131 ui:148-151');add(7,s,'ui:564-570 ui:580-588');add(7,'src/renderer.zig','d:35-45');add(7,'src/renderer/Options.zig','d:7-9');add(7,g,'ui:712-721');add(7,'src/renderer/Metal.zig','d:20 d:44-45 ui:56-71 i:131-146');add(7,'src/renderer/OpenGL.zig','d:15 d:47-48 ui:52-73 i:84-96');add(7,'src/renderer/metal/Device.zig','di:34-66');add(7,'src/renderer/opengl/Device.zig','di:37-74 di:102-105');
add(8,a,'di:136-159');add(8,e,'ui:634-646');add(8,'src/apprt/gtk/Surface.zig','i:12-17');add(8,h,'ui:1963-1978');add(8,s,'di:829-879');add(8,f,'i:64-86');add(8,'src/renderer/metal/Device.zig','i:63-66');add(8,'src/renderer/opengl/Device.zig','i:102-105');
add(2,a,'d:1-4 d:22-74 di:76-613');add(2,e,'ui:1714-1728 ui:1743-1748');
add(1,'src/apprt.zig','d:1-10 d:39-53');add(1,a,'d:22-28 d:45-58 i:136-151 i:199-206 i:531-550');add(1,s,'d:1-16 d:74-84 d:92-108 d:133-147 di:477-484 i:564-590 i:592-611 i:623-649 i:711-725 ui:746-767 di:829-885');add(1,e,'ui:518-520 ui:615-624 ui:634-646');
# Merge by line; preserve roles without duplicating lines; no propagation into n1 (parent's job).
def inherit(n,child):
 for path,lines in r[child].items():
  for line,roles in lines.items():r[n][path].setdefault(line,set()).update(roles)
inherit(4,5)
for n in range(3,9):inherit(2,n)
for n in range(1,9):
 for path,lines in sorted(r[n].items()):
  # Merge touching blocks and retain all applicable roles for the combined range.
  for idx in sorted(lines):
   if not D['mappings'] or (m:=D['mappings'][-1])['node']!=f'n{n}' or m['path']!=path or m['endLine']!=idx-1:
    D['mappings'].append({'node':f'n{n}','path':path,'startLine':idx,'endLine':idx,'role':[]})
   m=D['mappings'][-1];m['endLine']=idx;m['role']=sorted(set(m['role']).union(rs[k] for k in lines[idx]))
json.dump({'diagrams':[D],'notes':'d1 n8: App.deinit invokes each registered runtime surface’s deinit first. The GTK wrapper deinit is a no-op; GTK releases the core surface during GObject finalization. Embedded deinit removes the runtime surface and calls core_surface.deinit.'},open('/tmp/d1-app.json','w'),ensure_ascii=False,separators=(',',':'))
print(len(D['mappings']))
