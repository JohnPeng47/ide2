import fnmatch, json, pathlib, re, subprocess, sys
root = pathlib.Path(sys.argv[1]); here = pathlib.Path(__file__).parent
assert subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip() == 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
scopes={int(i):fields for row in (here/'scope').read_text().splitlines() if row for i,*fields in [row.split()]}
assert set(scopes) == set(range(1,30))
for s in scopes.values(): assert s and set(s)<=set('structure entity behavior relationship guarantee subsystem'.split())
prefix='src/terminal/'
paths = {k:prefix+v+'.zig' for k,v in dict(T='Terminal', S='Screen', SS='ScreenSet', P='page', L='PageList', C='compress/Page', M='mem', H='hyperlink', Y='style', B='bitmap_allocator', HM='hash_map', Z='size', SEL='Selection', SG='SelectionGesture', SEARCH='search/terminal', SNAP='snapshot/snapshot', GC='c/grid_ref_tracked', CT='c/terminal', K='kitty/graphics_storage', KEY='kitty/key', A='ansi', MOD='modes', TAB='Tabstops', VT='stream_terminal', R='render', RC='ref_counted_set', KT='kitty', KG='kitty/graphics').items()}
paths.update(DS='src/datastruct/main.zig',DLL='src/datastruct/intrusive_linked_list.zig',IO='src/termio/Termio.zig',SH='src/termio/stream_handler.zig')
roles = dict(d='declaration',u='use',i='implementation')
records={}; texts={}; exclude={'docs','test','tests','Tests','build','dist','examples','scripts','deps','vendor','benchmark','benchmarks','fixtures','example'}
for row in (here/'ranges').read_text().splitlines():
    key,items=row.split(' ',1)
    n=int(key); records[n]=[]
    for item in items.split(';'):
        for parent in re.findall(r'\+(\d+)',item): records[n].extend(records[int(parent)])
        item=re.sub(r'\+\d+','',item).strip()
        if not item: continue
        p, span, r = item.split(); p=paths[p]
        a,b=map(int,span.partition('-')[::2]) if '-' in span else (int(span),int(span))
        assert not exclude.intersection(pathlib.PurePosixPath(p).parts) and p.endswith('.zig')
        if p not in texts: texts[p]=(root/p).read_text().splitlines()
        assert 1<=a<=b<=len(texts[p]) and r and set(r)<=roles.keys(), (n,p,a,b)
        assert not any(re.match(r'^test\b',line) for line in texts[p][a-1:b]), (n,p,a,b)
        records[n].append((p,a,b,set(r)))
assert records.keys()==scopes.keys()
output=[]
for n,data in sorted(records.items()):
    combined=[]
    for p,a,b,r in sorted(data,key=lambda x:x[:3]):
        if combined and combined[-1][0]==p and (a<=combined[-1][2] or (a==combined[-1][2]+1 and r==combined[-1][3])):
            last=combined.pop(); combined.append((p,last[1],max(last[2],b),last[3]|r))
        else: combined.append((p,a,b,r))
    assert combined
    for p,a,b,r in combined:
        output.append(dict(node=f'n{n}',path=p,startLine=a,endLine=b,role=[v for k,v in roles.items() if k in r]))
with (here/'candidate.json').open('w') as f:
    json.dump(dict(diagrams=[dict(diagramId='d5',nodes=[dict(node=f'n{n}',scope=s) for n,s in sorted(scopes.items())],mappings=output)],notes='d5/n7: the generation changes when an initialized slot is removed, including the remove-then-reinitialize replacement path; an in-place primary reset is not a new ScreenSet generation. d5/n18: an anchor whose original content is discarded can be remapped and marked garbage; the viewport is repaired as a live navigation anchor. d5/n19: history and active rows can share a boundary page. d5/n22: compression keeps the virtual address range, not the original physical contents. No unresolved d5 nodes.'),f,separators=(',',':'))
with (here/'verification.txt').open('w') as f:
    for p in sorted(texts):
        lines=set()
        for m in output:
            if m['path']==p: lines.update(range(m['startLine'],m['endLine']+1))
        print('\n--- '+p+' ---',file=f)
        for i in sorted(lines): print(f'{i:5d} {texts[p][i-1]}',file=f)
print(f'{len(scopes)} nodes, {len(output)} mappings, {len(texts)} files')

with (here/'compact.txt').open('w') as f:
    print('d5 — Terminal',file=f)
    print('d=declaration u=use i=implementation; +N includes the ranges of node nN before deduplication.',file=f)
    print('\n'.join(f'{k}={v}' for k,v in sorted(paths.items())),file=f)
    for row in (here/'ranges').read_text().splitlines():
        n,items=row.split(' ',1)
        print(f'n{n} [{", ".join(scopes[int(n)])}]: {items}',file=f)
