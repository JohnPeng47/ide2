import json, pathlib, subprocess, sys
from collections import defaultdict
scratch = pathlib.Path(__file__).parent
aliases, spec = (scratch/'worker.txt').read_text().split('\n%%\n')
aliases = dict(line.split(maxsplit=1) for line in aliases.splitlines())
scopes = dict(T='structure', E='entity', B='behavior', R='relationship', G='guarantee', S='subsystem')
roles = dict(d='declaration', u='use', i='implementation')
nodes, own, parents = {}, defaultdict(list), {}
for line in spec.splitlines():
    if line.startswith('n'):
        n, scope, *ps = line.split()
        nodes[n] = [scopes[s] for s in scope]
        parents[n] = [p.removeprefix('+') for p in ps]
    else:
        alias, ranges = line.strip().split(maxsplit=1)
        for entry in ranges.split(';'):
            interval, rs = entry.split()
            a, _, b = interval.partition('-')
            own[n].append((aliases[alias], int(a), int(b or a), rs))
assert list(nodes) == ['n'+str(i) for i in range(78,96)]
seen = set()
cache = {}
rev = 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
def expand(n):
    ls = defaultdict(set)
    for ch in parents[n]:
        for p,a,b,rs in expand(ch):
            for i in range(a,b+1): ls[p,i].update(rs)
    for p,a,b,rs in own[n]:
        if p not in cache:
            body = subprocess.check_output(['git','show',f'{rev}:{p}'])
            assert pathlib.Path(p).read_bytes() == body
            cache[p] = body.splitlines()
        assert 1 <= a <= b <= len(cache[p]), (n,p,a,b)
        assert all(r in roles for r in rs)
        for i in range(a,b+1): ls[p,i].update(rs)
        seen.add((p,a,b))
    out=[]
    for (p,i), rs in sorted(ls.items()):
        rs=''.join(r for r in roles if r in rs)
        if out and out[-1][0] == p and out[-1][2] == i-1 and out[-1][3] == rs:
            out[-1] = (p,out[-1][1],i,rs)
        else: out.append((p,i,i,rs))
    assert out
    return out
notes = ('d1/n83: The shared mutex guarantees ordering for a successful resize, not rollback if PTY resize succeeds but Terminal.resize fails. '
         'd1/n84: Surface.resize also posts directly to the renderer, so visual updates need not wait for the coalesced PTY/emulator resize. '
         'd1/n87: wait_after_command branches on the non-abnormal path; abnormal exit returns earlier, and closing a held fallback terminal requires a key that encodes bytes. '
         'd1/n89: Host confirmation or retained ownership (including macOS split undo) may delay or prevent destruction; embedded close is optional. '
         'd1/n95: The core calls runtime Surface.deinit first and expects zero font-grid entries; GTK runtime Surface.deinit is a no-op, with core teardown instead done in the GObject finalizer.')
result = {'diagrams':[{'diagramId':'d1','nodes':[{'node':n,'scope':s} for n,s in nodes.items()], 'mappings':[{'node':n, 'path':p, 'startLine':a,'endLine':b,'role':[roles[r] for r in rs]} for n in nodes for p,a,b,rs in expand(n)]}], 'notes':notes}
(scratch/'candidate.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'Checked {len(nodes)} nodes; {len(result["diagrams"][0]["mappings"])} normalized ranges, {len(cache)} pinned files')
