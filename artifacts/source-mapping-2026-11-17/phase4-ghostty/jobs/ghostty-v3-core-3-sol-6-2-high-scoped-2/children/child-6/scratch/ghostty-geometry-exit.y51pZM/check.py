from pathlib import Path
from collections import defaultdict
import json, shlex, fnmatch, subprocess
scratch = Path(__file__).parent
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
tree=set(subprocess.check_output(['git','ls-files','-z'],text=True).split('\0'))
sm=dict(s='structure', e='entity', b='behavior', r='relationship', g='guarantee', u='subsystem')
rm=dict(d='declaration', v='use', i='implementation')
length={}; rows={}
for line in (scratch/'mapping.txt').read_text().splitlines():
    head,*blocks=line.split(' | ')
    node,scope=head.split()
    assert node not in rows and scope and set(scope)<=sm.keys() and len(set(scope))==len(scope)
    own=[]; inherited=[]
    for block in blocks:
        if block.startswith('inherit '):
            inherited += block.split()[1:]; continue
        for item in shlex.split(block):
            file,interval,roles=item.rsplit(':',2)
            assert file in tree and not any(x in {'Tests','test','tests','docs','build','examples','deps','vendor','fixtures','scripts'} for x in Path(file).parts)
            assert not any(fnmatch.fnmatch(Path(file).name,x) for x in ['*LICENSE*','*.md','*.mdx','*.spec.*','*.test.*'])
            if file not in length:
                length[file]=int(subprocess.check_output(['wc','-l',file],text=True).strip().split()[0])
            start,end=map(int,interval.split('-'))
            assert roles and set(roles)<=rm.keys() and 1<=start<=end<=length[file], item
            own.append((file,start,end,roles))
    rows[node]=(scope,inherited,own)
assert set(rows)=={f'n{n}' for n in range(78,96)}
def ranges(node):
    _, inherited, own=rows[node]
    out=own[:]
    for child in inherited:out.extend(ranges(child))
    return out
candidate={'diagramId':'d1','nodes':[],'mappings':[]}
for node,(scope,_,_) in rows.items():
    candidate['nodes'].append(dict(node=node,scope=[sm[c] for c in scope]))
    paths=defaultdict(lambda:defaultdict(set))
    for path,start,end,role in ranges(node):
        for i in range(start,end+1):paths[path][i].update(role)
    for path, lines in sorted(paths.items()):
        start=end=None; last=set()
        for i in [*sorted(lines),max(lines)+2]:
            role=lines.get(i,set())
            if end is not None and (end+1!=i or last!=role):
                candidate['mappings'].append(dict(node=node,path=path,startLine=start,endLine=end,role=[rm[c] for c in rm if c in last]))
                start=end=None
            if role:
                if start is None:start=i
                end=i; last=role
(scratch/'subset.json').write_text(json.dumps({'diagrams':[candidate],'notes':''},indent=2)+'\n')
print(f"Checked {len(rows)} nodes, {len(length)} tracked files, {len(candidate['mappings'])} non-overlapping expanded ranges")
