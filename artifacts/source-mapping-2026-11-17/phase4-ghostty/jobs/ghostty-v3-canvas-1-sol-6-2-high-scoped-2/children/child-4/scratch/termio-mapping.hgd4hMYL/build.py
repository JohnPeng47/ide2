import json, pathlib, subprocess
p=pathlib.Path(__file__).parent
paths=dict(io='src/termio/Termio.zig',mod='src/termio.zig',su='src/Surface.zig',bk='src/termio/backend.zig',ex='src/termio/Exec.zig',th='src/termio/Thread.zig',mb='src/termio/mailbox.zig',msg='src/termio/message.zig',sh='src/termio/stream_handler.zig',st='src/terminal/stream.zig',pa='src/terminal/Parser.zig',t='src/terminal/Terminal.zig',ss='src/terminal/ScreenSet.zig',sf='src/apprt/surface.zig',a='src/App.zig',rs='src/renderer/State.zig',rt='src/renderer/Thread.zig',gz='src/renderer/size.zig',tm='src/terminal/main.zig',apc='src/terminal/apc.zig',dcs='src/terminal/dcs.zig',cw='src/terminal/kitty/clipboard_write.zig',cg='src/terminal/kitty/clipboard_grants.zig',emb='src/apprt/embedded.zig',ga='src/apprt/gtk/App.zig',gc='src/apprt/gtk/class/application.zig',mac='macos/Sources/Ghostty/Ghostty.App.swift',sc='src/terminal/Screen.zig',pl='src/terminal/PageList.zig',opt='src/termio/Options.zig',gen='src/renderer/generic.zig',pty='src/pty.zig')
role=dict(d='declaration',u='use',i='implementation')
scopes={'structure','entity','behavior','relationship','guarantee','subsystem'}
ns=[]
ms=[]
seen=set()
source={path:pathlib.Path(path).read_text().splitlines() for path in paths.values()}
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
assert not subprocess.check_output(['git','status','--porcelain'])
for record in (p/'scopes').read_text().splitlines():
    n,*scope=record.split()
    assert scope and set(scope)<=scopes and len(set(scope))==len(scope)
    ns.append(dict(node='n'+n,scope=scope))
assert {v['node'] for v in ns}=={f'n{i}' for i in range(1,30)} and len(ns)==29
for record in (p/'ranges').read_text().splitlines():
    n,name,span,r=record.split()
    path=paths[name]
    a,b=map(int,span.split('-'))
    assert 1<=int(n)<=29 and 1<=a<=b<=len(source[path]) and r
    for line in range(a,b+1):
        assert (n,path,line) not in seen, (n,path,line)
        seen.add((n,path,line))
    ms.append(dict(node='n'+n,path=path,startLine=a,endLine=b,role=[role[c] for c in r]))
assert {v['node'] for v in ms}=={v['node'] for v in ns}
notes="d2 only (Termio subagent assignment). d2/n23: nextSlice is the normal path; an active inspector uses the byte-at-a-time next path instead. d2/n24: the renderer handoff is a bounded scheduling heuristic, not an unconditional wait. d2/n28: the mutex prevents interleaving during resize; the new dimensions are guaranteed on success, not if Terminal.resize fails after the PTY resize. validate_source_mappings was unavailable; the candidate was checked locally for the pinned commit, node and enum coverage, file existence, line bounds, and per-node overlaps."
result=dict(diagrams=[dict(diagramId='d2',nodes=ns,mappings=ms)],notes=notes)
compact='{"diagrams":[{"diagramId":"d2","nodes":[\n'+',\n'.join(json.dumps(n,separators=(',',':')) for n in ns)+'\n],"mappings":[\n'+',\n'.join(json.dumps(m,separators=(',',':')) for m in ms)+'\n]}],"notes":'+json.dumps(notes)+'}\n'
assert json.loads(compact)==result
(p/'candidate.json').write_text(compact)
print(len(ms), len(compact), p/'candidate.json')
