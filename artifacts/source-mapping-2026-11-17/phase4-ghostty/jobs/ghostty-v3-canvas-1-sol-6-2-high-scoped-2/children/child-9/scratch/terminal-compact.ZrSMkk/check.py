import json, re, subprocess
from pathlib import Path
from itertools import groupby
p=Path(__file__).parent
aliases=dict(l.split() for l in (p/'aliases').read_text().splitlines())
rows=[l.split() for l in (p/'records').read_text().splitlines()]
lengths={a:len(Path(path).read_bytes().split(b'\n'))-1 for a,path in aliases.items()}
base_names=set(subprocess.check_output(['git','ls-files'],text=True).splitlines())
assert all(path in base_names and path.startswith('src/') and 'test' not in path and 'build/' not in path for path in aliases.values())
map_scope=dict(zip('sebrgx','structure entity behavior relationship guarantee subsystem'.split()))
map_role=dict(zip('dui','declaration use implementation'.split()))
assert [(a,b) for a,b,*_ in rows]==[tuple(l.split()) for l in (p/'scope').read_text().splitlines()]
assert [a for a, *_ in rows]==[f'n{i}' for i in range(1,30)]
local={}
for node,scope,*ranges in rows:
    local[node]={}
    for t in ranges:
        if t.startswith('+'): continue
        a,s,e,role=re.fullmatch(r'(\w+):(\d+)(?:-(\d+))?:([dui]+)',t).groups()
        lo,hi=int(s),int(e or s)
        assert 1<=lo<=hi<=lengths[a],(node,t)
        for l in range(lo,hi+1):
            d=local[node].setdefault(a,{})
            assert l not in d,(node,t,l)
            d[l]=set(role)
mappings=[]
for node,scope,*ranges in reversed(rows):
    for t in ranges:
        if not t.startswith('+'): continue
        assert int(t[2:])>int(node[1:])
        for a,v in local[t[1:]].items():
            d=local[node].setdefault(a,{})
            for l,r in v.items(): d.setdefault(l,set()).update(r)
    for a,v in sorted(local[node].items()):
        for (role,_), g in groupby(enumerate(sorted(v.items())),key=lambda x:(tuple(r for r in 'dui' if r in x[1][1]),x[1][0]-x[0])):
            lines=[x[1][0] for x in g]
            mappings.append(dict(node=node,path=aliases[a],startLine=lines[0],endLine=lines[-1],role=[map_role[r] for r in role]))
c=dict(diagrams=[dict(diagramId='d5',nodes=[dict(node=n,scope=[map_scope[s] for s in sc]) for n,sc,*_ in rows],mappings=sorted(mappings,key=lambda x:(int(x['node'][1:]),x['path'],x['startLine'])))],notes='')
(p/'candidate.json').write_text(json.dumps(c))
print(f'Checked {len(rows)} nodes with {len(mappings)} nonoverlapping expanded ranges.')
