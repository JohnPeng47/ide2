import json,subprocess,pathlib,collections
root=pathlib.Path(__file__).resolve().parents[2]
import os
os.chdir(root)
audit_dir=pathlib.Path(__file__).resolve().parent
files=subprocess.check_output(['rg','--files','src','domain','application','infrastructure'],text=True).splitlines()
files=[p for p in files if pathlib.Path(p).suffix in {'.ts','.tsx','.js','.jsx','.mjs','.cjs','.css'} and '/__tests__/' not in p and not any(t in p for t in ['.test.','.spec.']) and not p.endswith('.d.ts')]
texts={p:(root/p).read_text().splitlines() for p in files}
diagrams=json.loads((audit_dir/'saved-mappings.json').read_text())
def metrics(keys):
 keys=set(keys)
 return {'files':len({p for p,l in keys}),'lines':len(keys),'existingFiles':len({p for p,l in keys if p in texts})}
allraw=set();allcurrent=set();allpaths=set();reports=[]
for d in diagrams:
 r=d['revision']; mapped=collections.defaultdict(set)
 for m in r['mappings']:mapped[m['evidenceId']].add(m['sourceRangeId'])
 raw=set();current=set();paths=set();ranges=[]
 for eid,ids in mapped.items():
  e=r['evidence'][eid]
  for s in e['sourceRanges']:
   if s['id'] not in ids:continue
   p=s['path'];a=s['startLine'];b=s['endLine'];old=s['originalLines'];now=texts.get(p,[])
   raw.update((p,l) for l in range(a,b+1));paths.add(p)
   matches=[i for i in range(len(now)-len(old)+1) if now[i:i+len(old)]==old] if old else []
   status='unchanged' if now[a-1:b]==old else 'relocated' if len(matches)==1 else 'stale'
   start=a if status=='unchanged' else matches[0]+1 if status=='relocated' else None
   if start:current.update((p,l) for l in range(start,start+len(old)))
   ranges.append({'symbol':s.get('symbol',e['label']),'path':p,'oldStart':a,'oldEnd':b,'currentStart':start,'status':status})
 allraw|=raw;allcurrent|=current;allpaths|=paths
 reports.append({'name':d['representation']['name'],'id':d['representation']['id'],'mappings':len(r['mappings']),'entities':len(mapped),'raw':metrics(raw),'verified':metrics(current),'paths':sorted(paths),'statuses':dict(collections.Counter(x['status'] for x in ranges)),'ranges':ranges})
byarea=collections.defaultdict(list)
for p,ls in texts.items():byarea['/'.join(p.split('/')[:2])].append(p)
areas=[]
for a,ps in byarea.items():
 keys={(p,l) for p in ps for l in range(1,len(texts[p])+1)}
 areas.append({'area':a,'files':len(ps),'lines':len(keys),'mappedFiles':len(set(ps)&allpaths),'verifiedLines':len(keys&allcurrent),'rawLines':len(keys&allraw)})
report={'scope':'production TS/JS/CSS in src, domain, application, infrastructure; exclude tests and declaration-only files','files':len(texts),'lines':sum(map(len,texts.values())),'nonblank':sum(bool(l.strip()) for ls in texts.values() for l in ls),'diagrams':reports,'unionRaw':metrics(allraw),'unionVerified':metrics(allcurrent),'referencedPaths':len(allpaths),'mappedFiles':len(allpaths & texts.keys()),'missingPaths':sorted(allpaths-texts.keys()),'mappedFileLines':sum(len(texts.get(p,[])) for p in allpaths),'areas':sorted(areas,key=lambda x:-x['lines']),'largestUnmapped':[{'path':p,'lines':len(ls)} for p,ls in sorted(texts.items(),key=lambda x:-len(x[1])) if p not in allpaths][:25]}
json.dump(report,open(audit_dir/'metrics.json','w'),indent=2)
print(json.dumps({**report,'diagrams':[{k:v for k,v in x.items() if k not in ['ranges','paths']} for x in reports]},indent=2))
print('STALE RANGES')
for d in reports:
 print(d['name'])
 for r in d['ranges']:
  if r['status']=='stale':print(r)
