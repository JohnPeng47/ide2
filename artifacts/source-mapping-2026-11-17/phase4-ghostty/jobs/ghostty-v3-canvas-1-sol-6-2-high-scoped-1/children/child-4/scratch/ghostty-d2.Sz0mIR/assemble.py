from pathlib import Path
import re, collections, json, subprocess
base=Path(__file__).parent
path_alias=dict(line.split(' ',1) for line in (base/'aliases').read_text().splitlines())
S={'structure','entity','behavior','relationship','guarantee','subsystem'}
scope={}
for line in (base/'scopes').read_text().splitlines():
    n,*tags=line.split(); assert tags and set(tags)<=S and len(set(tags))==len(tags); scope[int(n)]=tags
paths=set(subprocess.check_output(['git','ls-files'],text=True).splitlines()); roles={'D':'declaration','U':'use','I':'implementation'}
rng={}; source={}
for row in (base/'ranges').read_text().splitlines():
    if row.startswith('#') or not row.strip(): continue
    n,text=row.split(' ',1); n=int(n); assert n not in rng
    parts=[]
    for sect in text.split('; '):
        if sect.startswith('+'):
            for child in sect[1:].split(','):
                m=re.fullmatch(r'(\d+)(?:\[([^\]]+)\])?',child); assert m,child
                num,keys=m.groups()
                subset={path_alias[key] for key in keys.split('|')} if keys else None
                parts.extend(item for item in rng[int(num)] if subset is None or item[0] in subset)
            continue
        key,values=sect.split(':'); path=path_alias[key]; assert path in paths,path
        if path not in source: source[path]=Path(path).read_text().splitlines()
        for val in values.split(','):
            m=re.fullmatch(r'(\d+)(?:-(\d+))?([DUI]+)',val); assert m,(n,val)
            a,b,r=m.groups(); a,b=int(a),int(b or a); assert 1<=a<=b<=len(source[path]),(n,path,a,b)
            parts.append((path,a,b,r))
    rng[n]=parts
assert set(rng)==set(scope)==set(range(1,30))
result={'diagrams':[{'diagramId':'d2','nodes':[],'mappings':[]}],'notes':'d2 n22–n24: output enters with the renderer-state mutex held. On queue backpressure some handler publishers temporarily release and reacquire it; when the inspector is active the parser uses next(byte) rather than nextSlice. d2 n24: the demand handoff is a bounded scheduling heuristic. d2 n28: the lock prevents the child’s redraw from being parsed between the PTY resize and successful emulation resize; there is no PTY rollback if Terminal.resize fails.'}
obj=result['diagrams'][0]
for n in sorted(scope):
    node=f'n{n}'; obj['nodes'].append({'node':node,'scope':scope[n]})
    # Merge overlaps, union their roles, and keep disjoint source locations separate.
    merged=[]
    for path,a,b,role in sorted(rng[n]):
        tags=set(role)
        if merged and merged[-1][0]==path and a<=merged[-1][2]:
            _,g,h,r=merged[-1]; merged[-1]=(path,g,max(h,b),r|tags)
        else:
            merged.append((path,a,b,tags))
    for path,a,b,tag in merged:
        obj['mappings'].append({'node':node,'path':path,'startLine':a,'endLine':b,'role':[v for k,v in roles.items() if k in tag]})
    assert merged
(base/'d2.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
print('scope records:',len(obj['nodes']),'merged mappings:',len(obj['mappings']),'source files:',len(source))
