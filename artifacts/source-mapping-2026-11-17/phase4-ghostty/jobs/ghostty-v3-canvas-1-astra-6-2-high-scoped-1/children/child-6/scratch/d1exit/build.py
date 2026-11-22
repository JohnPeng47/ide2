import json,pathlib,collections
p=pathlib.Path('/tmp/d1exit')
paths=dict(S='src/Surface.zig',Q='src/terminal/search/Thread.zig',I='src/inspector/Inspector.zig',R='src/renderer/Thread.zig',T='src/termio/Thread.zig',O='src/termio/Termio.zig',E='src/termio/Exec.zig',B='src/termio/backend.zig',G='src/renderer/generic.zig',F='src/font/SharedGridSet.zig',H='src/terminal/SelectionGesture.zig',A='src/App.zig',M='src/apprt/surface.zig',K='src/apprt/gtk/Surface.zig',W='src/apprt/gtk/class/surface.zig',J='src/apprt/gtk/class/application.zig',V='src/apprt/gtk/class/surface_child_exited.zig',X='src/apprt/gtk/class/split_tree.zig',L='src/apprt/embedded.zig',MA='macos/Sources/Ghostty/Ghostty.App.swift',MS='macos/Sources/Ghostty/Ghostty.Surface.swift',MV='macos/Sources/Ghostty/Surface View/SurfaceView_AppKit.swift',MB='macos/Sources/Features/Terminal/BaseTerminalController.swift',MC='macos/Sources/Features/Terminal/TerminalController.swift')
d={}
native='J:789:u J:3052-3060:ui W:1526-1539:ui V:69-84:i V:89-110:i MA:768-769:u MA:1854-1872:ui'
d[38]='S:138-139:d S:184-185:d S:209-227:di S:830-831:ui S:860-863:ui S:931-956:di S:971-991:di S:1225-1239:ui S:1485-1600:di S:4941:d S:5059-5159:ui Q:118-131:i Q:134-142:di Q:160-254:i Q:257-268:ui I:1-4:d I:58-66:di T:325:i O:740-754:ui R:417-435:i'
d[40]='S:309:d S:390:i S:1297-1331:di S:1377-1454:di '+native
d[41]='S:335:d S:416:i S:1297:d S:1368-1375:i S:881-885:ui'
d[39]='S:156-157:d E:274-315:ui M:187-207:ui A:273:d A:293:u A:532-550:ui S:1017:d S:1141:u S:1297-1375:di S:1377-1454:di S:881-885:ui S:309:d S:390:i S:335:d S:416:i '+native
d[43]='S:881-885:ui K:36-39:ui W:1517-1524:ui X:499-508:ui X:786-834:ui X:838-841:d X:860-871:i W:1963-1981:ui L:678-685:ui MA:79:u MA:291-296:ui MB:184-188:ui MB:658-664:ui MC:695-721:i MB:469-495:ui MB:518:d MB:528-538:ui MV:181:d MV:395:ui MS:28-45:ui L:1859-1861:ui L:291-294:ui L:634-646:ui S:829:d'
d[42]=d[43].replace('S:881-885:ui','S:881-885:di')+' S:993-1013:di'
d[45]='S:829-845:di S:214-226:di Q:142:d Q:162:u Q:172-192:i Q:462-471:i R:200:d R:228-233:ui R:253-257:i R:722-731:i T:236:d T:267-279:ui T:473-482:i'
d[46]='S:829:d S:840-845:ui T:236:d T:267-279:ui T:473-482:i O:427-429:ui B:50-54:ui E:196-230:di E:1105-1133:di E:1161-1216:i E:1254-1258:i'
d[47]='S:829:d S:847-858:ui G:841-874:di R:177-189:di T:127-133:di O:354-365:di'
d[48]='S:829:d S:857:ui S:865-876:ui H:172-179:i S:442-445:i F:413-431:di'
d[44]='S:829-879:di I:64-66:i '+' '.join(dict.fromkeys(a for n in (45,46,47,48) for a in d[n].split() if not (a.startswith('S:') and int(a.split(':')[1].split('-')[0]) in range(829,880))))
role=dict(d='declaration',i='implementation',u='use'); scope=dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',y='subsystem'); sc={t[0]:t[1:] for t in (l.split() for l in (p/'scopes').read_text().splitlines())}; nodes=[];maps=[]
with (p/'verified-lines').open('w') as out:
 for n,txt in sorted(d.items()):
  node='n'+str(n); nodes.append(dict(node=node,scope=[scope[c] for c in sc[node]])); taken=set()
  for tok in txt.split():
   alias,rg,rr=tok.split(':'); f=paths[alias]; lr=list(map(int,rg.split('-'))); lo,hi=lr[0],lr[-1]; lines=pathlib.Path(f).read_text().splitlines(); assert 1<=lo<=hi<=len(lines); assert not any((f,j) in taken for j in range(lo,hi+1)); taken.update((f,j) for j in range(lo,hi+1)); maps.append(dict(node=node,path=f,startLine=lo,endLine=hi,role=[role[r] for r in rr])); print(node, f,file=out);print('\n'.join(f'{j:6d} {lines[j-1]}' for j in range(lo,hi+1)),file=out)
notes='d1/n40: short runtime is <= the configured threshold; non-Darwin exit code 0 bypasses the abnormal-exit path. d1/n43: close is a request, not synchronous core destruction. Embedded runtime can decline if callback absent; confirmation, references and undo can delay finalization.'
(p/'d1exit.json').write_text(json.dumps(dict(diagrams=[dict(diagramId='d1',nodes=nodes,mappings=maps)],notes=notes)))
for n in sorted(d): print(n,d[n]);
