from collections import defaultdict
import hashlib, json, re, subprocess
from pathlib import Path
s=Path('/tmp/ghostty-d4-scopes-kerh8ebv').read_text().splitlines()
scopes={p[0]:p[1:] for l in s if (p:=l.split())}
allowed_scopes=set('structure entity behavior relationship guarantee subsystem'.split())
assert list(scopes)==[f'n{i}' for i in range(1,27)]
assert all(v and len(v)==len(set(v)) and set(v)<=allowed_scopes for v in scopes.values())
commit='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==commit
aliases={}
ranges={}
roles={'D':'declaration','U':'use','I':'implementation'}
for l in Path('/tmp/ghostty-d4-kerh8ebv.ranges').read_text().splitlines():
    if l.startswith('#') or not l: continue
    node,tail=l.split(' ',1)
    if node not in scopes:
        aliases[node]=tail
        continue
    ranges[node]=[]
    for r in tail.split('; '):
        prefix,ln,role=r.split()
        a,b=(ln.split('-',1) if '-' in ln else [ln,ln])
        assert role and len(role)==len(set(role)) and set(role)<=roles.keys()
        ranges[node].append((aliases[prefix],int(a),int(b),role))
assert ranges.keys()==scopes.keys()
lengths={}
for path in aliases.values():
    pinned=subprocess.check_output(['git','show',f'{commit}:{path}'])
    assert Path(path).read_bytes()==pinned
    lengths[path]=len(pinned.splitlines())
children={'n1':['n2','n12'],'n2':[f'n{i}' for i in [3,9,10,11]],'n3':[f'n{i}' for i in range(4,9)],'n12':['n13'],'n13':['n14','n16','n18','n19'],'n14':['n15'],'n16':['n17'],'n19':['n20','n26'],'n20':['n21','n23','n24'],'n21':['n22'],'n24':['n25']}
def all_ranges(node):
    yield from ranges[node]
    for child in children.get(node,[]):
        yield from all_ranges(child)
outputs=[]
for node in scopes:
    covered=defaultdict(lambda:defaultdict(set))
    for path,a,b,role in all_ranges(node):
        assert 1<=a<=b<=lengths[path],(node,path,a,b)
        for i in range(a,b+1): covered[path][i].update(role)
    for path,lines in sorted(covered.items()):
        a=b=None
        current=None
        def emit():
            outputs.append(dict(node=node,path=path,startLine=a,endLine=b,role=[roles[k] for k in roles if k in current]))
        for i,role in sorted(lines.items()):
            if a is None:
                a=b=i; current=role
            elif i==b+1 and role==current:
                b=i
            else:
                emit()
                a=b=i; current=role
        if a is not None: emit()
result={'diagrams':[{'diagramId':'d4','nodes':[dict(node=n,scope=s) for n,s in scopes.items()],'mappings':outputs}],'notes':''}
p=Path('/tmp/ghostty-d4-kerh8ebv.json')
p.write_text(json.dumps(result,separators=(',',':'))+'\n')
print(p, len(scopes),len(outputs),len(p.read_bytes()))
