import sys, json, re, subprocess, os, fnmatch
from pathlib import Path
root=Path.cwd(); folder=Path(__file__).parent
commit='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==commit
files=set(subprocess.check_output(['git','ls-tree','-r','--name-only',commit],text=True).splitlines())
sc={'S':'structure','E':'entity','B':'behavior','R':'relationship','G':'guarantee','Y':'subsystem'}
ro={'D':'declaration','U':'use','I':'implementation'}
fmap={}; data={}; defs={}
excluded={'deps','docs','examples','example','benchmark','benchmarks','build','dist','test','tests','Tests','node_modules','fixtures','__fixtures__','__tests__','scripts','.agents','.github','.husky','.pi','vendor','nix','images','flatpak','po','snap'}
assert set(sc)==set('SEBRGY')
for row in (folder/'branch.txt').read_text().splitlines():
    if not row or row.startswith('#'): continue
    head,*tail=row.split()
    if '=' in head:
        fmap.update(word.split('=',1) for word in [head,*tail]); continue
    if re.fullmatch(r'n\d+',head):
        node=head; assert node not in defs and len(tail)==1 and tail[0]
        defs[node]=[sc[k] for k in tail[0]]; data[node]={}; continue
    if head=='+':
        for dep in tail:
            for path, d in data[dep].items():
                for n,v in d.items(): data[node].setdefault(path,{}).setdefault(n,set()).update(v)
        continue
    path=fmap.get(head,head)
    path=path[1:] if path.startswith('@') else 'src/'+path
    assert path in files and not (set(Path(path).parts[:-1]) & excluded), path
    name=Path(path).name
    assert not any(fnmatch.fnmatch(name, pattern) for pattern in ('*-LICENSE','LICENSE*','*.md','*.mdx','AGENTS.md','CODEX-LICENSE','*.spec.*','*.test.*','flake.lock','package-lock.json'))
    src=(root/path).read_bytes()
    assert src==subprocess.check_output(['git','show',commit+':'+path]), path
    lines=len(src.splitlines()); assert len(tail)%2==0
    for ran, roles in zip(tail[::2],tail[1::2]):
        ends=list(map(int,ran.split('-'))); a,b=ends[0],ends[-1]
        assert 1<=a<=b<=lines, (path,ran,lines)
        rr={ro[k] for k in roles}; assert rr
        for n in range(a,b+1): data[node].setdefault(path,{}).setdefault(n,set()).update(rr)
assert set(defs)=={f'n{i}' for i in range(66,78)}
nodes=[]; mappings=[]
for n in sorted(defs,key=lambda n:int(n[1:])):
    nodes.append(dict(node=n,scope=defs[n])); assert data[n]
    for path,points in sorted(data[n].items()):
        lo=hi=0; role=None
        def emit():
            if lo: mappings.append(dict(node=n,path=path,startLine=lo,endLine=hi,role=[x for x in ro.values() if x in role]))
        for line,rs in sorted(points.items()):
            if line==hi+1 and rs==role: hi=line; continue
            emit(); lo=hi=line; role=rs
        emit()
notes=('Assigned renderer branch only (d1/n66–n77). n72: the terminal snapshot and preedit copy are under the demand lock; styles and GPU-cell preparation run after release. The regex-link call still reads state.mouse.point/mods directly outside the lock (generic.zig:1571–1576), rather than using critical.mouse. n77: Surface.draw is an explicit embedded API; Metal additionally wires CALayer bounds-change display to a synchronous draw. GTK/OpenGL instead uses the render-thread EGL context and GTK snapshot; do not infer a GTK main-thread GL draw. validate_source_mappings was unavailable; local checks verified tracked files against the pinned commit, exclusions, ID and enum values, and inclusive bounds.')
obj=dict(diagrams=[dict(diagramId='d1',nodes=nodes,mappings=mappings)],notes=notes)
(folder/'candidate.json').write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'{len(nodes)} nodes, {len(mappings)} normalized mappings, {len(set(m["path"] for m in mappings))} files')
