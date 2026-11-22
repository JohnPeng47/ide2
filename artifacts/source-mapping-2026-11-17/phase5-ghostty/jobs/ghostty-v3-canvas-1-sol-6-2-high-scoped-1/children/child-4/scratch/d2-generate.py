import json,re,subprocess
from pathlib import Path
p={
'T':'src/termio/Termio.zig', 'M':'src/termio.zig', 'B':'src/termio/backend.zig', 'H':'src/termio/Thread.zig', 'MB':'src/termio/mailbox.zig', 'MSG':'src/termio/message.zig', 'E':'src/termio/Exec.zig', 'V':'src/termio/stream_handler.zig','OPT':'src/termio/Options.zig','C':'src/Command.zig','P':'src/pty.zig', 'S':'src/Surface.zig','ST':'src/terminal/stream.zig','TM':'src/terminal/main.zig','PS':'src/terminal/Parser.zig','PT':'src/terminal/parse_table.zig','O':'src/terminal/osc.zig','A':'src/terminal/apc.zig','D':'src/terminal/dcs.zig','KC':'src/terminal/kitty/clipboard.zig','KW':'src/terminal/kitty/clipboard_write.zig','KG':'src/terminal/kitty/clipboard_grants.zig','L':'src/terminal/Terminal.zig','SS':'src/terminal/ScreenSet.zig','SC':'src/terminal/Screen.zig','PL':'src/terminal/PageList.zig','MM':'src/terminal/modes.zig','AM':'src/apprt/surface.zig','APP':'src/App.zig','AR':'src/apprt.zig','GA':'src/apprt/gtk/App.zig','GAPP':'src/apprt/gtk/class/application.zig','EMB':'src/apprt/embedded.zig','MAC':'macos/Sources/Ghostty/Ghostty.App.swift','R':'src/renderer.zig','RZ':'src/renderer/size.zig','RS':'src/renderer/State.zig','RT':'src/renderer/Thread.zig','RM':'src/renderer/message.zig','RG':'src/renderer/generic.zig','GL':'src/renderer/OpenGL.zig','OC':'src/terminal/osc/parsers/kitty_clipboard_protocol.zig','AG':'src/terminal/apc/glyph.zig','AGR':'src/terminal/apc/glyph/request.zig','KGFX':'src/terminal/kitty/graphics.zig','KGC':'src/terminal/kitty/graphics_command.zig'}
scope=dict(zip('SEBHGX',['structure','entity','behavior','relationship','guarantee','subsystem']))
role=dict(zip('DUI',['declaration','use','implementation']))
scope_rows=[line.split() for line in Path('/tmp/d2-scopes.txt').read_text().splitlines() if line.strip()]
nodes=[dict(node='n'+i,scope=[scope[c] for c in s]) for i,s in scope_rows]
tracked=set(subprocess.check_output(['git','ls-files','-z']).decode().strip('\0').split('\0'))
cached={}
raw={}
for row in Path('/tmp/d2-data.txt').read_text().splitlines():
    i,*files=row.split(); i=int(i); raw[i]={}
    for spec in files:
        key,seq=spec.split(':'); path=p[key]
        assert path in tracked,path
        if path not in cached: cached[path]=Path(path).read_text().splitlines()
        for pair in seq.split(','):
            a,b,r=re.fullmatch(r'(\d+)(?:-(\d+))?([DUI]+)',pair).groups()
            a=int(a); b=int(b or a)
            assert 1<=a<=b<=len(cached[path]), (i,path,a,b)
            for l in range(a,b+1): raw[i].setdefault(path,{}).setdefault(l,set()).update(r)
children={1:[2,5,13,16,17,19,21,25],2:[3,4],5:[6,7],7:[8,9,10,11,12],13:[14,15],17:[18],19:[20],21:[22,23,24],25:[26,27,28,29]}
def get(i):
    d={f:{l:r.copy() for l,r in fr.items()} for f,fr in raw[i].items()}
    for child in children.get(i,[]):
        for f,fr in get(child).items():
            g=d.setdefault(f,{})
            for l,r in fr.items():g.setdefault(l,set()).update(r)
    return d
assert [int(n['node'][1:]) for n in nodes]==list(range(1,30))==list(raw)
mappings=[]
for i in range(1,30):
    for f,ranges in sorted(get(i).items()):
        current=None
        for l,r in sorted(ranges.items()):
            rr=[value for key,value in role.items() if key in r]
            if current and current['endLine']+1==l and current['role']==rr: current['endLine']=l
            else:
                current=dict(node='n'+str(i),path=f,startLine=l,endLine=l,role=rr)
                mappings.append(current)
notes='d2 n23: The ordinary parser path calls nextSlice after queueRender under the mutex; an active inspector uses next(byte) instead, and a contended mailbox can temporarily release and reacquire the mutex. d2 n28: The ordering prevents parsing a child redraw against obsolete dimensions on a successful resize. Terminal.resize can fail after the PTY has already been resized; the code does not roll the PTY back on that path.'
out=dict(diagrams=[dict(diagramId='d2',nodes=nodes,mappings=mappings)],notes=notes)
Path('/tmp/d2-candidate.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
print(f'{len(nodes)} d2 nodes; {len(mappings)} mappings; {len(cached)} source files')
