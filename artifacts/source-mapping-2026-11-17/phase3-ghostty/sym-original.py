import json,re,subprocess,collections,sys
G='/home/john/softwarez/ghostty';R='ea8b12a8'
files=subprocess.run(['git','-C',G,'ls-tree','-r','--name-only',R,'src'],capture_output=True,text=True).stdout.split()
src={}
def get(p):
  if p not in src: src[p]=subprocess.run(['git','-C',G,'show',f'{R}:{p}'],capture_output=True,text=True).stdout.split('\n')
  return src[p]
# index fn definitions across src/*.zig
defs=collections.defaultdict(list)
for p in files:
  if not p.endswith('.zig'): continue
  for i,l in enumerate(get(p),1):
    m=re.match(r'\s*(?:pub\s+)?(?:inline\s+)?fn\s+(\w+)\s*\(',l)
    if m: defs[m.group(1)].append((p,i))
for case,job in [('ghostty-v3-core-1','ghostty-v3-core-1-high-1'),('ghostty-v3-core-2','ghostty-v3-core-2-high-1'),('ghostty-v3-canvas-1','ghostty-v3-canvas-1-high-1'),('ghostty-v3-canvas-2','ghostty-v3-canvas-2-high-1')]:
  inp=json.load(open(f'{case}-input.json'));m=json.load(open(f'jobs/{job}/mapping.json'))
  by=collections.defaultdict(list)
  for d in m['diagrams']:
    for x in d['mappings']: by[(d['diagramId'],x['node'])].append(x)
  rs=[x for d in m['diagrams'] for x in d['mappings']]
  sizes=[x['endLine']-x['startLine']+1 for x in rs]
  named=hit=0;miss=[]
  for d in inp['diagrams']:
    for n in d['nodes']:
      ids=set(re.findall(r'\b([a-z]\w*)\(\)?',n['label']))|set(re.findall(r'\b[a-z]\w*Callback\b',n['label']))
      for s in ids:
        if s not in defs or len(defs[s])>3: continue
        named+=1
        ok=any(x['path']==p and x['startLine']<=i<=x['endLine'] for p,i in defs[s] for x in by[(d['diagramId'],n['ref'])])
        hit+=ok
        if not ok: miss.append(f"{d['diagramId']}/{n['ref']} {s}")
  print(job, 'ranges',len(rs),'median',sorted(sizes)[len(sizes)//2],'<=10 lines',sum(s<=10 for s in sizes),'| named fns',named,'def in range',hit)
  print('   misses:',', '.join(miss[:14]))
