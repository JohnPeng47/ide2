from pathlib import Path
from collections import defaultdict
from itertools import groupby
import json, subprocess
root = Path(__file__).parent
files = dict(line.split() for line in (root/'aliases').read_text().splitlines())
scope = {line.split()[0]:line.split()[1:] for line in (root/'scope').read_text().splitlines()}
valid = set(subprocess.check_output(['git','ls-files'],text=True).splitlines())
roles = {'D':'declaration','U':'use','I':'implementation'}
known = {}; counts = {}; ranges = []
for line in (root/'compact').read_text().splitlines():
    node,*tokens = line.split(); n = defaultdict(lambda: defaultdict(set)); known[node]=n
    for tok in tokens:
        if tok.startswith('+'):
            for child in tok[1:].split(','):
                for path,lines in known[child].items():
                    for i,r in lines.items(): n[path][i].update(r)
        else:
            alias, rest = tok.split(':',1); path=files[alias]; assert path in valid; assert '/build/' not in path and '/tests/' not in path
            if path not in counts: counts[path] = len(Path(path).read_text().splitlines())
            for part in rest.split(','):
                bounds,rs=part.split(':'); bounds=bounds.split('-'); a,b=int(bounds[0]),int(bounds[-1]);
                assert 1<=a<=b<=counts[path],(tok,counts[path]); assert set(rs)<=roles.keys() and rs
                for i in range(a,b+1): n[path][i].update(rs)
assert set(known)==set(scope)
for node in scope:
    for path,lines in known[node].items():
        for (r,_),g in groupby(enumerate(sorted(lines)),lambda a:(tuple(k for k in roles if k in lines[a[1]]),a[1]-a[0])):
            group=list(g)
            ranges.append(dict(node=node,path=path,startLine=group[0][1],endLine=group[-1][1],role=[roles[key] for key in r]))
notes='d3 n18: Terminal snapshot and OSC 8 hover lookup are under the shared mutex; regex link lookup at generic.zig:1569–1579 is outside the mutex and reads state.mouse directly. d3 n19: Surface.draw passes true; Metal honors it. OpenGL ignores the sync flag and queues exported frames for GTK compositing.'
(root/'d3.json').write_text(json.dumps(dict(diagramId='d3',nodes=[dict(node=node,scope=s) for node,s in scope.items()],mappings=ranges),indent=2)+'\n')
print(len(scope),'nodes,',len(ranges),'deduplicated ranges,',len(counts),'files')
print(notes)
