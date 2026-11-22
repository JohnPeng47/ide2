import hashlib,json,pathlib,re,subprocess
folder=pathlib.Path(__file__).parent
paths={
'E':'src/termio/Exec.zig','X':'src/termio.zig','B':'src/termio/backend.zig','T':'src/termio/Termio.zig','H':'src/termio/Thread.zig','O':'src/termio/Options.zig','S':'src/Surface.zig','P':'src/pty.zig','C':'src/Command.zig','F':'src/os/flatpak.zig','OS':'src/os/main.zig','OP':'src/os/pipe.zig','AS':'src/apprt/surface.zig','A':'src/App.zig','TE':'src/terminal/Terminal.zig','R':'src/renderer/size.zig','SH':'src/termio/stream_handler.zig','RS':'src/renderer/State.zig','G':'src/renderer/generic.zig','FD':'src/lib/compat/fd.zig'}
roles={'D':'declaration','U':'use','I':'implementation'}
allowed={'structure','entity','behavior','relationship','guarantee','subsystem'}
nodes={}
tracked=set(subprocess.check_output(['git','ls-files'],text=True).splitlines())
for row in (folder/'spec').read_text().splitlines():
    prefix, *parts=row.split('; ')
    m=re.fullmatch(r'(n\d+) \[([a-z,]+)\](?: (\+n\d+(?:,\+n\d+)*))?',prefix)
    n,scope,parents=m.groups(); scope=scope.split(','); assert scope and set(scope)<=allowed
    spans=[]
    for part in parts:
        short, ranges=part.split(':'); path=paths[short]; assert path in tracked
        for item in ranges.split(','):
            match=re.fullmatch(r'(\d+)(?:-(\d+))? ([DUI]+)',item)
            l,r,role=match.groups(); l=int(l);r=int(r or l)
            file=pathlib.Path(path).read_text().splitlines(); assert 1<=l<=r<=len(file),(path,l,r)
            spans.append((path,l,r,role))
    nodes[n]=(scope,parents.split(',') if parents else [],spans)
assert list(nodes)==[f'n{i}' for i in range(1,27)]
def expand(n,seen):
    assert n not in seen
    _,parents,spans=nodes[n]
    return spans+[s for parent in parents for s in expand(parent[1:],seen|{n})]
def mappings(n):
    from itertools import groupby
    all_lines={}
    for p,l,r,role in expand(n,set()):
        for i in range(l,r+1): all_lines.setdefault(p,{}).setdefault(i,set()).update(role)
    for p,lines in sorted(all_lines.items()):
        for _, group in groupby(enumerate(sorted(lines.items())),lambda x: (x[1][0]-x[0],','.join(sorted(x[1][1])))):
            g=list(group); l,s=g[0][1];r=g[-1][1][0]
            yield {'node':n,'path':p,'startLine':l,'endLine':r,'role':[name for key,name in roles.items() if key in s]}
notes='d4 only (Exec subagent assignment). n7: the .fork_exec tag also stores Windows Command; Command.start selects CreateProcessW on Windows, not fork/exec. n19: read_thread_pipe stores the quit pipe write end; the reader receives the read end and the PTY read FD separately. This excludes excluded dependency source for xev; the queue submission and completion are mapped at the in-repository boundary.'
data={'diagrams':[{'diagramId':'d4','nodes':[{'node':n,'scope':val[0]} for n,val in nodes.items()],'mappings':[entry for n in nodes for entry in mappings(n)]}],'notes':notes}
output=json.dumps(data,indent=2)+'\n'; (folder/'d4.json').write_text(output)
print('Verified local files/bounds; node count',len(nodes),'mapping count',len(data['diagrams'][0]['mappings']))
