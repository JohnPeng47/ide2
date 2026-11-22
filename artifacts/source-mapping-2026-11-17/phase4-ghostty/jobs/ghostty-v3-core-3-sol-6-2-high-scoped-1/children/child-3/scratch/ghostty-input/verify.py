import collections, fnmatch, json, pathlib, subprocess
file=pathlib.Path('/tmp/ghostty-input/candidate.json')
c=json.loads(file.read_text()); assert len(c['diagrams'])==1
v=c['diagrams'][0]; assert v['diagramId']=='d1'
assert {i['node'] for i in v['nodes']}=={f'n{i}' for i in range(24,36)}
assert len(v['nodes'])==12
for i in v['nodes']:
 assert i['scope'] and len(set(i['scope']))==len(i['scope'])
 assert set(i['scope'])<=set('structure entity behavior relationship guarantee subsystem'.split())
commit='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()==commit
assert not subprocess.check_output(['git','status','--porcelain'])
forbidden=set('.agents .github .husky .pi deps example flatpak images nix po scripts snap vendor Tests __fixtures__ __tests__ benchmark benchmarks build dist docs examples fixtures node_modules test tests'.split())
lengths={}; last=collections.defaultdict(int); ids=set()
for m in sorted(v['mappings'],key=lambda x:(x['node'],x['path'],x['startLine'])):
 p=m['path']; start=m['startLine']; end=m['endLine']; key=(m['node'],p)
 assert m['node'] in {i['node'] for i in v['nodes']}; ids.add(m['node'])
 assert m['role'] and len(set(m['role']))==len(m['role']) and set(m['role'])<=set('declaration use implementation'.split())
 f=pathlib.PurePosixPath(p); assert not f.is_absolute() and not any(x in forbidden or x=='..' for x in f.parts[:-1])
 assert not any(fnmatch.fnmatch(f.name,k) for k in ('*.md','*.mdx','*-LICENSE','LICENSE*','CODEX-LICENSE','*.spec.*','*.test.*','flake.lock','package-lock.json'))
 if p not in lengths:
  data=subprocess.check_output(['git','show',f'{commit}:{p}']); assert pathlib.Path(p).read_bytes()==data
  lengths[p]=len(data.splitlines())
 assert last[key]<start<=end<=lengths[p],m
 last[key]=end
assert ids=={i['node'] for i in v['nodes']}
print(f'Checked {len(v["mappings"])} mappings across {len(ids)} nodes and {len(lengths)} tracked files.')
