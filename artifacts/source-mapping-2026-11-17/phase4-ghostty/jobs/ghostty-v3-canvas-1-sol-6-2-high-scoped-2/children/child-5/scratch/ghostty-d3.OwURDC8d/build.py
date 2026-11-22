import collections,json,pathlib,re,subprocess,hashlib,fnmatch
scratch = pathlib.Path(__file__).resolve().parent
scopes = {k:v for k,*v in (line.split() for line in (scratch/'scopes').read_text().splitlines())}
assert list(scopes)==[f'n{x}' for x in range(1,21)]
roles={'D':'declaration','U':'use','I':'implementation'}
paths={}
ranges=collections.defaultdict(list)
for line in (scratch/'ranges').read_text().splitlines():
    n,p,*groups=line.split()
    if n=='@': paths[p],=groups;continue
    p=paths.get(p,p)
    for group in groups:
        bounds,rr=group.split(':')
        for bound in bounds.split(','):
            ss=bound.split('-');s,e=int(ss[0]),int(ss[-1]);ranges[n].append((p,s,e,rr))
# Descendant coverage limited to each parent's own responsibilities; setup/delegation
# ranges retained alongside child implementations. Avoid duplication within a node.
parents={'n8':('n9','n10','n11','n12','n13'),'n16':('n17',),'n15':('n16','n17','n18','n19','n20'),'n2':('n3','n4','n5','n6','n7','n8','n14'),'n1':('n2','n15')}
for n, children in parents.items():
    for c in children:
        for p,s,e,r in ranges[c]:
            if n=='n8' and ((c=='n13' and (p.startswith('src/font/') or p.endswith(('Metal.zig','OpenGL.zig')))) or (c=='n13' and p.endswith('generic.zig') and s>=1800 and e<=2010)):
                continue
            ranges[n].append((p,s,e,r))
files={}
tracked=set(subprocess.check_output(['git','ls-files','-z']).decode().split('\0'))
result=[]
for n in scopes:
    by_file=collections.defaultdict(dict)
    for p,s,e,r in ranges[n]:
        pp=pathlib.PurePosixPath(p)
        assert p in tracked and not pp.is_absolute() and not any(fnmatch.fnmatch(part,'*LICENSE*') or part in ('deps','Tests','tests','test','build','dist','docs','scripts','vendor','examples','fixtures','benchmarks') for part in pp.parts) and not p.endswith(('.md','.mdx')), p
        if p not in files: files[p]=pathlib.Path(p).read_text().splitlines()
        assert 1<=s<=e<=len(files[p]), (p,s,e,len(files[p]))
        for i in range(s,e+1): by_file[p].setdefault(i,set()).update(r)
    assert by_file,n
    for p,lines in sorted(by_file.items()):
        spans=[]
        for i,rr in sorted(lines.items()):
            # Preserve gaps; coalesce adjacent selected lines, carrying all
            # relative roles from the construct(s) in the resulting range.
            if spans and i==spans[-1][1]+1:
                spans[-1][1]=i;spans[-1][2].update(rr)
            else: spans.append([i,i,rr.copy()])
        for s,e,r in spans:
            result.append(dict(node=n,path=p,startLine=s,endLine=e,role=[roles[k] for k in roles if k in r]))
notes=('Renderer assignment only (d3). d3/n11: the locked block copies the mouse value and uses it for OSC 8 handling, but the subsequent regex-link call reads state.mouse.point and state.mouse.mods again after releasing the terminal mutex. d3/n19: the explicit embedded draw API and Metal layer callback both request a synchronous draw. GTK/OpenGL does not use that main-thread path; the renderer thread owns the active GL context and GTK composites the exported frame on the main thread. No validate_source_mappings tool was available in the subagent session; the subset was checked locally for references, roles, bounds, exclusions and overlaps.')
obj=dict(diagrams=[dict(diagramId='d3',nodes=[dict(node=n,scope=v) for n,v in scopes.items()],mappings=result)],notes=notes)
encoded=json.dumps(obj,separators=(',',':'))+'\n'
(scratch/'d3.json').write_text(encoded)
print(f'{len(result)} ranges; {len(files)} files; {len(encoded)} bytes; SHA-256 (local only) {hashlib.sha256(encoded.encode()).hexdigest()}')
