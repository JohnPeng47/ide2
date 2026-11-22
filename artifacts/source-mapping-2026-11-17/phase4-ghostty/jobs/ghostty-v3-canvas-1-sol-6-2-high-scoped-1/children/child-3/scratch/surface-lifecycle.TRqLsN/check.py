import hashlib, json, re, subprocess, sys
from collections import defaultdict
from pathlib import Path
p=Path(sys.argv[1]); root=Path.cwd()
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
tracked=set(subprocess.check_output(['git','ls-files','-z']).decode().split('\0'))
paths = dict(s.split(' ',1) for s in (p/'paths').read_text().splitlines()); scopes=dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',y='subsystem',t='structure')
roles=dict(D='declaration',U='use',I='implementation'); contents={}
d = dict(diagramId='d1',nodes=[],mappings=[])
with (p/'numbered-verification.txt').open('w') as f:
    for s in (p/'map').read_text().splitlines():
        n, scope, *groups = s.split(); n='n'+n
        d['nodes'].append(dict(node=n,scope=list(dict.fromkeys(scopes[c] for c in scope))))
        seen=defaultdict(set)
        for group in groups:
            alias, ranges = group.split(':'); path=paths[alias]; assert path in tracked
            if path not in contents: contents[path] = (root/path).read_text().splitlines()
            lines=contents[path]
            for item in ranges.split(','):
                m=re.fullmatch(r'(\d+)(?:-(\d+))?([DUI]+)',item); assert m, (n,path,item)
                a, b = int(m[1]), int(m[2] or m[1]); assert 0<a<=b<=len(lines),(n,path,item,len(lines))
                rr=set(range(a,b+1)); assert not seen[path] & rr,(n,path,item,seen[path] & rr); seen[path] |= rr
                print(f'{n} {path}:{a}-{b}',file=f)
                for i in range(a,b+1): print(f'{i:5}  {lines[i-1]}',file=f)
                d['mappings'].append(dict(node=n,path=path,startLine=a,endLine=b,role=[roles[c] for c in m[3]]))
assert [x['node'] for x in d['nodes']]==['n'+str(i) for i in range(22,49)]
candidate=dict(diagrams=[d],notes='d1 n31: the shared lock protects the snapshot, but the later regex-link call reads state.mouse directly outside the lock. d1 n32: fairness is a bounded attempt, not a strict scheduling guarantee. d1 n40: non-Darwin also requires a nonzero exit code. d1 n41: readonly still requires confirmation on the close path; the core key handler closes a held surface on a key event that encodes to a write. d1 n43: embedded closure depends on the host; macOS undo can retain surfaces, so final release is not necessarily synchronous.')
raw=json.dumps(candidate,separators=(',',':')); (p/'candidate.json').write_text(raw)
print(len(d['nodes']),len(d['mappings']),len(contents),hashlib.sha256(raw.encode()).hexdigest())
