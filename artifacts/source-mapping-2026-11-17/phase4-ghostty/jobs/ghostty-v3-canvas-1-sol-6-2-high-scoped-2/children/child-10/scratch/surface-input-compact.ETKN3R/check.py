from pathlib import Path
import json, re, subprocess,collections
p=Path(__file__).parent
expected={f'n{i}' for i in [*range(11,22),*range(38,42),*range(44,49)]}
scope=dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',x='subsystem')
roles=dict(d='declaration',u='use',i='implementation')
a={}; records={}; unions={}; data={}; read=collections.defaultdict(set)
assert subprocess.check_output(['git','rev-parse','HEAD']).decode().strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
for line in (p/'candidate.txt').read_text().splitlines():
    if not line: continue
    if '=' in line:
        alias, path=line.split('=',1); a[alias]=path
        assert Path(path).is_file()
        assert not set(Path(path).parts).intersection({'deps','build','dist','docs','scripts','vendor','test','tests','Tests','examples','fixtures','.agents','.github','nix','images'})
        assert not any(x in path for x in ('.spec.','.test.','.md','LICENSE'))
        data[path]=Path(path).read_text().splitlines()
        continue
    n,s,*entries=line.split(); assert n in expected and n not in records and len(set(s))==len(s)
    records[n]=([scope[c] for c in s],[]); unions[n]=[]
    for ent in entries:
        if ent.startswith('+'):
            unions[n].append(ent[1:]); continue
        alias,start,end,r=re.fullmatch(r'([A-Z]+):(\d+)-(\d+):([dui]+)',ent).groups(); path=a[alias]; start,end=int(start),int(end)
        assert 1<=start<=end<=len(data[path]) and len(set(r))==len(r)
        read[path].update(range(start,end+1)); records[n][1].append((path,start,end,set(roles[c] for c in r)))
assert set(records)==expected

def collect(n, ancestor=()):
    assert n not in ancestor
    rv=records[n][1][:]
    for c in unions[n]: rv.extend(collect(c,(*ancestor,n)))
    return rv

def merge(n):
    out=[]
    byfile=collections.defaultdict(list)
    for path,s,e,r in collect(n): byfile[path].append((s,e,r))
    for path,blocks in byfile.items():
        merged=[]
        for s,e,r in sorted(blocks, key=lambda x:x[:2]):
            if merged and s <= merged[-1][1]:
                ps,pe,pr=merged[-1]; merged[-1]=(ps,max(e,pe),pr|r)
            else: merged.append((s,e,r))
        for s,e,r in merged:
            out.append(dict(node=n,path=path,startLine=s,endLine=e,role=[v for v in roles.values() if v in r]))
    return out
(p/'subset.json').write_text(json.dumps({'diagrams':[{'diagramId':'d1','nodes':[dict(node=n,scope=s) for n,(s,_) in records.items()],'mappings':[row for n in records for row in merge(n)]}],'notes':''},indent=2))
with (p/'verified-ranges.txt').open('w') as f:
    for path,nums in read.items():
        print('====',path,'====',file=f)
        for i in sorted(nums): print(i,data[path][i-1],sep='\t',file=f)
print(f'Verified {len(records)} nodes, {sum(len(m) for _,m in records.values())} explicit ranges; subsets only (no validate_source_mappings tool exposed).')
