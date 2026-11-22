from pathlib import Path
from collections import defaultdict
import json, subprocess
here=Path(__file__).parent
files={}
for line in '''S Surface.zig
A App.zig
RMain renderer.zig
IO termio/Termio.zig
B termio/backend.zig
E termio/Exec.zig
P pty.zig
C Command.zig
F os/flatpak.zig
SH termio/stream_handler.zig
TS terminal/stream.zig
TMain terminal/main.zig
T terminal/Terminal.zig
ST renderer/State.zig
G renderer/generic.zig
R terminal/render.zig
MB termio/mailbox.zig
MSG termio/message.zig
Size renderer/size.zig
IT termio/Thread.zig
RT renderer/Thread.zig
FS font/SharedGridSet.zig
FG font/SharedGrid.zig
RO renderer/Options.zig
M renderer/Metal.zig
GL renderer/OpenGL.zig
Emb apprt/embedded.zig
Header @include/ghostty.h
ML renderer/metal/IOSurfaceLayer.zig
MF renderer/metal/Frame.zig
GF renderer/opengl/Frame.zig
GTKRender apprt/gtk/class/render_surface.zig
GTK apprt/gtk/class/surface.zig
DevM renderer/metal/Device.zig
DevGL renderer/opengl/Device.zig'''.splitlines():
    a,p=line.split(); files[a]=p.lstrip('@') if p.startswith('@') else 'src/'+p
roles=dict(D='declaration',U='use',I='implementation')
nodes=[dict(node=n, scope=s) for n,*s in (line.split() for line in (here/'scopes').read_text().splitlines())]
assert [x['node'] for x in nodes]==[f'n{i}' for i in range(22,38)]
assert all(x['scope'] and set(x['scope']) <= set('structure entity behavior relationship guarantee subsystem'.split()) for x in nodes)
by=defaultdict(list)
pin='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
sources={}
for text in (here/'ranges').read_text().splitlines():
    if not text or text.startswith('#'): continue
    n,a,s,e,r=text.split(); p=files[a]; s,e=int(s),int(e)
    if p not in sources:
        blob=subprocess.check_output(['git','show',f'{pin}:{p}'])
        assert blob==Path(p).read_bytes()
        sources[p]=blob.decode().splitlines()
    assert 1<=s<=e<=len(sources[p]),(n,p,s,e,len(sources[p]))
    assert r and set(r)<=set(roles)
    by[n,p].append((s,e,set(r)))
merged={}
for k,spans in by.items():
    for s,e,r in sorted(spans):
        output=merged.setdefault(k,[])
        if output and s <= output[-1][1]+1:
            lo,hi,rr=output.pop(); output.append((lo,max(hi,e),r|rr))
        else:
            output.append((s,e,r))
notes=('Subagent surface-workers: assigned d1 n22–n37 only. '
       'd1 n25 and n30: the one Terminal claim applies to this Surface’s emulation state; the renderer has a buffered terminal.RenderState, not another Terminal. '
       'd1 n31: State documents a shared mutex contract, and the main snapshot takes it; generic.zig:1569–1579 nevertheless rereads state.mouse for regex links after leaving the critical section. '
       'd1 n32: this is a bounded fairness handoff (futex wait with timeout), not strict starvation freedom. '
       'd1 n37: embedded C API delegates to Surface.draw; the Metal layer also calls drawFrame(true) directly. OpenGL ignores the sync flag for UI presentation and instead exports a frame for the runtime to present; this is not a cross-backend main-thread draw guarantee. '
       'validate_source_mappings was not exposed as a tool or shell command; checked the subset locally against the pinned Git blobs.')
entries=[dict(node=n,path=p,startLine=s,endLine=e,role=[v for k,v in roles.items() if k in r]) for (n,p),spans in sorted(merged.items(),key=lambda v:(int(v[0][0][1:]),v[0][1])) for s,e,r in spans]
assert set(e['node'] for e in entries)=={x['node'] for x in nodes}
subset=dict(diagrams=[dict(diagramId='d1',nodes=nodes,mappings=entries)],notes=notes)
(here/'candidate.json').write_text(json.dumps(subset,ensure_ascii=False,indent=1)+'\n')
verified=defaultdict(set)
for e in entries:
    verified[e['path']].update(range(e['startLine'],e['endLine']+1))
with (here/'verify.txt').open('w') as out:
    for p,lines in sorted(verified.items()):
        print('\n'+p,file=out)
        prev=0
        for i in sorted(lines):
            if prev and prev!=i-1: print(' ...',file=out)
            print(f'{i:5d} {sources[p][i-1]}',file=out)
            prev=i
for n in nodes:
    nid=n['node']; print(nid,','.join(n['scope']))
    for (mapped,p),r in sorted(merged.items(),key=lambda x:x[0][1]):
        if mapped==nid:
            a=next(a for a,name in files.items() if name==p)
            print(f'  {a}: '+', '.join(f'{s}-{e}({"".join(k for k in roles if k in chars)})' for s,e,chars in r))
print('Ranges',len(entries),'unique lines',sum(map(len,verified.values())))
