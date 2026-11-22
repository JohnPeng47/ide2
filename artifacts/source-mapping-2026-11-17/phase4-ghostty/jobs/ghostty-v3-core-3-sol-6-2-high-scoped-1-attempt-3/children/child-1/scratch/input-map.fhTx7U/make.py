import collections, hashlib, json, pathlib, re, subprocess
home = pathlib.Path(__file__).parent
commit = 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == commit
scope = {p[0]: p[1:] for line in (home/'scope.txt').read_text().splitlines() if (p := line.split())}
nodes = [f'n{i}' for i in range(24, 36)]
assert set(scope) == set(nodes)
allowed_scopes = {'structure','entity','behavior','relationship','guarantee','subsystem'}
roles = {'D':'declaration','U':'use','I':'implementation'}
files, source = {}, {}
entries, referrals = collections.defaultdict(list), {}
notes = ('d1 n24–n35 only, as assigned. n25: a non-consuming binding can perform an action and still fall through to encode the key. '
         'n29–n31: text pastes use mode 2004 framing or newline conversion; clipboard pastes can instead emit a mode 5522 MIME-list event, while direct text input uses the text path. '
         'n33: the readonly guard intercepts the three write-message variants at Surface.queueIo, not direct writes in Termio (e.g. the prompt-redraw form-feed in clearScreen). '
         'n35: Ghostty submits the write to libxev on the POSIX PTY master or Windows PTY input pipe; libxev internals are outside the permitted source scope.')
for line in (home/'ranges.txt').read_text().splitlines():
    p = line.split()
    if not p: continue
    if p[0] == '@':
        _, alias, path = p
        assert not pathlib.PurePosixPath(path).is_absolute()
        assert all(not re.search(f'(^|/){d}(/|$)',path) for d in ('test','Tests','tests','testdata','build','dist','deps','docs','examples','node_modules','scripts','vendor'))
        assert not re.search(r'(^|/)(?:\.agents|\.github|example|flatpak|images|nix|po|snap)/|\.mdx?$|(?:\.spec\.|\.test\.)',path)
        assert pathlib.Path(path).is_file()
        files[alias] = path
        source[path] = subprocess.check_output(['git','show',f'{commit}:{path}'], text=True).splitlines()
        assert source[path] == pathlib.Path(path).read_text().splitlines()
    elif p[0] in nodes:
        n, *refs = p
        referrals[n] = [ref.removeprefix('+') for ref in refs]
    else:
        alias, *triples = p
        for lines, role in zip(triples[::2], triples[1::2], strict=True):
            start, _, end = lines.partition('-')
            lo, hi = int(start), int(end or start)
            path = files[alias]
            assert 1 <= lo <= hi <= len(source[path]), (n,path,lo,hi)
            assert role and set(role) <= roles.keys()
            entries[n].append((path, lo, hi, role))

def expanded(n):
    yield from entries[n]
    for ref in referrals[n]:
        yield from expanded(ref)

mappings = []
report = []
for n in nodes:
    assert scope[n] and set(scope[n]) <= allowed_scopes and entries[n]
    by_path = collections.defaultdict(lambda: collections.defaultdict(set))
    for path, lo, hi, role in expanded(n):
        for ln in range(lo, hi+1):
            by_path[path][ln].update(role)
    for path, line_roles in sorted(by_path.items()):
        def group_key(item):
            return item[1][0] - item[0], ''.join(sorted(item[1][1]))
        import itertools
        for (_, role), group in itertools.groupby(enumerate(sorted(line_roles.items())), group_key):
            lines = [item[0] for _, item in group]
            lo, hi = lines[0], lines[-1]
            mappings.append({'node':n,'path':path,'startLine':lo,'endLine':hi,'role':[roles[r] for r in roles if r in role]})
            report.append(f'{n} {path}:{lo}–{hi} {role}\n' + '\n'.join(f'{i:6} {source[path][i-1]}' for i in lines))

res = {'diagrams':[{'diagramId':'d1', 'nodes':[{'node':n,'scope':scope[n]} for n in nodes], 'mappings':mappings}], 'notes':notes}
candidate = json.dumps(res,indent=2,ensure_ascii=False)+'\n'
(home/'candidate.json').write_text(candidate)
(home/'numbered.txt').write_text('\n\n'.join(report)+'\n')
print(len(mappings),'ranges;', len(candidate.encode()),'bytes;', 'sha256',hashlib.sha256(candidate.encode()).hexdigest())
