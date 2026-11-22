import collections as c, json, pathlib as p, subprocess as sp
scratch = p.Path(__file__).parent
paths = dict(s.split('|') for s in (scratch/'paths').read_text().splitlines())
scopes = {int(n): s for n,*s in map(str.split,(scratch/'scopes').read_text().splitlines())}
entries = c.defaultdict(list)
for n,k,*specs in map(str.split,(scratch/'ranges').read_text().splitlines()):
    for spec in specs:
        lines, r = spec.split(':')
        bounds = list(map(int, lines.split('-')))
        entries[int(n)].append((paths[k], bounds[0], bounds[-1], r))
entries[44] += [x for n in range(45,49) for x in entries[n]]
# Parent covers the Core Surface branches; the lead can add routes from other assignments.
entries[11] += [x for n in [*range(12,22),*range(38,42),44] for x in entries[n]]
roles = {'d':'declaration','u':'use','i':'implementation'}
assert entries.keys() == scopes.keys()
notes = ('d1 n13: Surface owns the DerivedConfig value and arena-backed resources, but the title field is assigned as config.title (not duplicated); the label does not establish independent ownership of every referent. '
         'd1 n19: The readonly guard applies to writes through Surface.queueIo, not terminal-generated protocol output on independent Termio paths. '
         'd1 n40: An exit at or below the threshold holds the surface only if classified abnormal; non-Darwin zero status is exempt. '
         'd1 n41: For non-abnormal exit, wait_after_command prevents automatic close; otherwise close is requested. Readonly requires confirmation even after child exit. '
         'd1 n48: The actual order is mouse gesture release before Termio deinit, then keyboard, font grid deref, then preedit, mutex and config; this node is not a literal release order.')
out = []
cache = {}
for n in sorted(entries):
    by_path = c.defaultdict(list)
    for path,a,b,r in entries[n]:
        if path not in cache:
            data = sp.check_output(['git','show',f'HEAD:{path}'])
            assert p.Path(path).read_bytes() == data
            cache[path] = data.decode().splitlines()
        assert 1<=a<=b<=len(cache[path]),(n,path,a,b)
        assert r and set(r)<=roles.keys()
        by_path[path].append((a,b,set(r)))
    for path, rr in sorted(by_path.items()):
        merged = []
        for a,b,r in sorted(rr, key=lambda x: (x[0],x[1])):
            if merged and (a <= merged[-1][1] or (a == merged[-1][1]+1 and r == merged[-1][2])):
                pa,pb,pr = merged[-1]
                merged[-1] = (pa,max(pb,b), pr|r)
            else:
                merged.append((a,b,r))
        for a,b,r in merged:
            out.append(dict(node=f'n{n}',path=path,startLine=a,endLine=b,role=[desc for key,desc in roles.items() if key in r]))
obj={'diagrams':[{'diagramId':'d1','nodes':[{'node':f'n{n}','scope':scopes[n]} for n in sorted(scopes)],'mappings':out}],'notes':notes}
(scratch/'surface-input.json').write_text(json.dumps(obj, separators=(',',':'))+'\n')
with (scratch/'range-boundaries').open('w') as output:
    for m in out:
        a,b,path=m['startLine'],m['endLine'],m['path']
        print(m['node'],path,f'{a}: {cache[path][a-1]}',f'{b}: {cache[path][b-1]}',file=output)
print(len(scopes),'nodes;',len(out),'unique ranges within nodes;',len(cache),'pinned files')
