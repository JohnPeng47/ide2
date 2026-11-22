from pathlib import Path
import json,subprocess
p=dict(A='src/App.zig', S='src/Surface.zig', AP='src/apprt.zig', AS='src/apprt/surface.zig', MAIN='src/main_ghostty.zig', E='src/apprt/embedded.zig', GA='src/apprt/gtk/App.zig', G='src/apprt/gtk/class/surface.zig', GR='src/apprt/gtk/Surface.zig', GAPP='src/apprt/gtk/class/application.zig', GW='src/apprt/gtk/class/window.zig', GT='src/apprt/gtk/class/tab.zig', GS='src/apprt/gtk/class/split_tree.zig', GTK='src/apprt/gtk.zig', RUNTIME='src/apprt/runtime.zig', N='src/apprt/none.zig', B='src/apprt/browser.zig', SH='src/termio/stream_handler.zig', EX='src/termio/Exec.zig', T='src/termio/Termio.zig', TTH='src/termio/Thread.zig', TM='src/termio/message.zig', TMBOX='src/termio/mailbox.zig', R='src/renderer.zig', RG='src/renderer/generic.zig', RO='src/renderer/Options.zig', RT='src/renderer/Thread.zig', RM='src/renderer/Metal.zig', RGL='src/renderer/OpenGL.zig', RMD='src/renderer/metal/Device.zig', RGLD='src/renderer/opengl/Device.zig', RMES='src/renderer/message.zig', DQ='src/datastruct/blocking_queue.zig', FG='src/font/SharedGridSet.zig', F='src/font/SharedGrid.zig', MA='macos/Sources/Ghostty/Ghostty.App.swift', MS='macos/Sources/Ghostty/Ghostty.Surface.swift', MV='macos/Sources/Ghostty/Surface View/SurfaceView_AppKit.swift', MD='macos/Sources/App/AppDelegate.swift', MT='macos/Sources/Features/Terminal/TerminalController.swift', MB='macos/Sources/Features/Terminal/BaseTerminalController.swift')
rd=dict(d='declaration',u='use',i='implementation')
ns=[]; ms=[]; seen={}; files={}
for ln in Path('/tmp/d1app-map.txt').read_text().splitlines():
    tag,*rest=ln.split()
    if tag.startswith('n'):
        node=tag
        ns.append({'node':node,'scope':rest})
    else:
        path=p[tag]; chunks=list(map(int,rest[0].split('-'))); start,end=chunks[0],chunks[-1]; roles=[rd[v] for v in rest[1]]
        if path not in files: files[path]=subprocess.check_output(['git','show','ea8b12a8a9894b5259c441eadd8f6f0c65e215af:'+path]).splitlines()
        assert 1<=start<=end<=len(files[path]), (path,start,end)
        s=seen.setdefault((node,path),set()); r=set(range(start,end+1)); assert not s&r,(node,path,s&r);s.update(r)
        ms.append(dict(node=node,path=path,startLine=start,endLine=end,role=roles))
assert [x['node'] for x in ns]==['n'+str(i) for i in range(1,16)]
notes=('d1 n8: Core App calls the registered runtime deinit hooks before releasing shared state. GTK’s apprt.Surface.deinit is a no-op; GTK performs the real cleanup when destroying its windows and finalizing the surface widget. d1 n9: The browser branch is a placeholder in this commit: it defines App and Window, not an apprt.Surface implementation; the none implementation uses an empty Surface. d1 n13: Surface owns the DerivedConfig value and its arena/regex resources; not every member is deep-copied (title is assigned directly).')
Path('/tmp/d1app-mappings.json').write_text(json.dumps(dict(diagrams=[dict(diagramId='d1',nodes=ns,mappings=ms)],notes=notes),ensure_ascii=False,separators=(',',':'))+'\n')
print(len(ns),len(ms),len(files), '/tmp/d1app-mappings.json')
