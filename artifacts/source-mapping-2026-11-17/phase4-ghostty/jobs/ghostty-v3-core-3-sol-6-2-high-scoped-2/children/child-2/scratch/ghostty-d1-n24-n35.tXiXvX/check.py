import json, subprocess, sys
from pathlib import Path
from collections import defaultdict
folder=Path(sys.argv[1])
tracked=set(subprocess.check_output(['git','ls-files','-z']).decode().split('\0'))
codeScope=dict(zip('sebrgu', ['structure', 'entity', 'behavior', 'relationship', 'guarantee', 'subsystem']))
codeRole=dict(zip('div', ['declaration','implementation','use']))
lines={}
scopes={}; mapping={}
for row in (folder/'mapping.txt').read_text().splitlines():
    first,*groups=map(str.strip,row.split('|')); node,scope=first.split()
    assert node not in scopes and scope and len(scope)==len(set(scope))
    scopes[node]=[codeScope[x] for x in scope]
    spans=mapping[node]=defaultdict(dict)
    for group in groups:
        tokens=group.split()
        if tokens[0]=='inherit':
            for ref in tokens[1:]:
                for path, data in mapping[ref].items():
                    for n,codes in data.items():
                        spans[path].setdefault(n,set()).update(codes)
        else:
            for token in tokens:
                path, rng, roles=token.split(':'); start,end=map(int,rng.split('-'))
                assert roles and set(roles)<=set(codeRole) and path in tracked
                assert Path(path).suffix in {'.zig','.swift'} and not any(x in Path(path).parts for x in {'deps','tests','test','Tests','build','docs','scripts','vendor','dist','benchmark'})
                if path not in lines:
                    lines[path]=Path(path).read_text().splitlines()
                assert 1<=start<=end<=len(lines[path]),token
                for n in range(start,end+1):
                    spans[path].setdefault(n,set()).update(roles)
assert set(scopes)=={f'n{i}' for i in range(24,36)}
records=[]
for node in sorted(scopes,key=lambda n:int(n[1:])):
    for path,spans in sorted(mapping[node].items()):
        batch=[]
        for n in sorted(spans):
            role=[codeRole[c] for c in codeRole if c in spans[n]]
            if batch and n==batch[-1]['endLine']+1 and role==batch[-1]['role']:
                batch[-1]['endLine']=n
            else:
                batch.append(dict(node=node,path=path,startLine=n,endLine=n,role=role))
        assert batch
        records.extend(batch)
(nodes:=sorted(scopes,key=lambda n:int(n[1:])))
result=dict(diagrams=[dict(diagramId='d1',nodes=[dict(node=node,scope=scopes[node]) for node in nodes],mappings=records)],notes=(folder/'notes.txt').read_text().strip())
(folder/'candidate.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'Checked {len(scopes)} assigned nodes, {len(records)} flattened ranges, {len(lines)} tracked source files')
