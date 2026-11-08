import pathlib,json,re,hashlib,collections
ROOT=pathlib.Path.cwd(); SID='623e7e34-acab-4056-9fad-cdcbdbc863ce'
SESSION=pathlib.Path('/home/john/.claude/projects/-home-john--herdr-worktrees-new-diagram-claude-diagram-ai-modal-design-6xhqax')/SID
SCRATCH=pathlib.Path('/tmp/claude-1000/-home-john--herdr-worktrees-new-diagram-claude-diagram-ai-modal-design-6xhqax')/SID/'scratchpad'
OUT=ROOT/'artifacts/shopify-tiered-contexts-2026-11-06'
FN=r'shopify-\d{4}(?:-q[1-4])?-(?:annual-filing|earnings-transcript)\.txt'
REF=re.compile('('+FN+r'):(\d+)(?:[-–](\d+))?')
files={p.name:p.read_text().splitlines() for p in (ROOT/'corpus/shopify').glob('shopify-*.txt')}
selected=collections.defaultdict(dict); events=[]; invalid=[]
priority={'low':0,'mid':1,'high':2}
policies={
 'allocation-eras':{'low':[], 'mid':['A7b']},
 'payments-buyer':{'high':['M1','M2','M2a','M4','M5','M6','M7','M9','M9a','M9b','M10','M11','M12','M14','B2'], 'low':[]},
 'merchants-ecosystem':{'high':['F1','F2','F2a','F2b','F2c','F2d','F2e','F2f','F3','F3a','F3b','N1','R2','R2a','R2b','E1','E3','E3a','E3b'], 'low':['E1a']},
 'channels-global':{'high':['S1','S2b','S2c','S2d','S4','S5','G1','G1b','G1c','G2','G3','G3b','G3c','G4','G4b','G4c','G4d'], 'low':['S6','S4b']},
 'fulfillment-ai':{'high':['L1','L1a','L1b','L2','L2a','L3','L4','L4a','L5','L5a','L7','I1','I2','I2a','I3','I3a','I3b','I4','I5','I5a'], 'low':['L6','I6','I6a','I6b']}
}
def add(fn,a,b,tier,origin):
 if fn not in files or a<1 or b<a or b>len(files[fn]): invalid.append([fn,a,b,origin]);return
 eid=len(events);events.append({'file':fn,'startLine':a,'endLine':b,'tier':tier,'origin':origin})
 for n in range(a,b+1):
  row=selected[fn].setdefault(n,{'tier':tier,'events':[]})
  if priority[tier]>priority[row['tier']]:row['tier']=tier
  row['events'].append(eid)
# Importance is assigned by audited claim, not recency or source type. Shared evidence takes highest importance.
for p in sorted(SCRATCH.glob('audit-*.md')):
 domain=p.stem.removeprefix('audit-'); section=''; code=''
 for ln,line in enumerate(p.read_text().splitlines(),1):
  if line.startswith('#'):
   section=line.lstrip('# ').strip(); m=re.match(r'([A-Z]\d+[a-z]?)\b',section); code=m[1] if m else ''
  policy=policies[domain]
  tier=('mid' if code in policy['mid'] else 'high') if domain=='allocation-eras' else ('high' if code in policy['high'] else 'low' if code in policy['low'] else 'mid')
  for m in REF.finditer(line):add(m[1],int(m[2]),int(m[3] or m[2]),tier,{'kind':'audit-citation','ledger':p.name,'ledgerLine':ln,'section':section})
# Recover line-addressed observations without rerunning the previous agent's commands.
for p in [SESSION.with_suffix('.jsonl'),*sorted(SESSION.glob('subagents/*.jsonl'))]:
 calls={}
 for raw in p.open():
  d=json.loads(raw);blocks=d.get('message',{}).get('content',[])
  if not isinstance(blocks,list):continue
  for b in blocks:
   if b.get('type')=='tool_use':calls[b['id']]=b
   if b.get('type')!='tool_result' or b.get('is_error'):continue
   call=calls.get(b.get('tool_use_id'),{}); inp=call.get('input',{}); name=call.get('name',''); cmd=inp.get('command','')
   origin={'kind':'tool-observation','sessionFile':p.name,'toolCallId':b.get('tool_use_id'),'tool':name}
   if name=='Read':
    fp=inp.get('file_path','');fn=pathlib.Path(fp).name
    if '/corpus/shopify/' in fp and fn in files:
     a=inp.get('offset',1);add(fn,a,min(len(files[fn]),a+inp.get('limit',len(files[fn]))-1),'low',origin)
   if name!='Bash':continue
   # Literal sed spans only: dynamic ranges and mere file enumeration are not claimed as reads.
   for m in re.finditer(r"sed\s+-n\s+['\"]?(\d+)(?:,(\d+))?p['\"]?\s+(?:\$C/)?("+FN+r')',cmd):
    add(m[3],int(m[1]),int(m[2] or m[1]),'low',origin)
   result=b.get('content','')
   if not isinstance(result,str):result='\n'.join(x.get('text','') for x in result if isinstance(x,dict))
   for m in REF.finditer(result):add(m[1],int(m[2]),int(m[3] or m[2]),'low',origin)
# Add nearby already observed lines to each cited claim so table rows and sentence fragments retain local context.
for fn,rows in selected.items():
 cited=[(n,row['tier']) for n,row in rows.items() if any(events[e]['origin']['kind']=='audit-citation' for e in row['events'])]
 for n,tier in cited:
  for k in range(max(1,n-2),min(len(files[fn]),n+2)+1):
   if k in rows and priority[rows[k]['tier']]<priority[tier]:rows[k]['tier']=tier
ranges=[]
for fn,rows in sorted(selected.items()):
 for n,row in sorted(rows.items()):
  if ranges and ranges[-1]['file']==fn and ranges[-1]['tier']==row['tier'] and ranges[-1]['endLine']==n-1:
   ranges[-1]['endLine']=n;ranges[-1]['eventIds'].update(row['events'])
  else:ranges.append({'file':fn,'startLine':n,'endLine':n,'tier':row['tier'],'eventIds':set(row['events'])})
for r in ranges:r['eventIds']=sorted(r['eventIds']);r['path']='corpus/shopify/'+r['file']
report={'schemaVersion':1,'group':'Shopify strategy corpus — importance tiers — 2026-11-06','sourcePane':'w3M:p3J','sourceSessionId':SID,'sourceCompletion':'Herdr idle observed before reading output; original session ended at usage limit after writing ten diagrams and SHOPIFY.txt. Its parser check remained unfinished.',
 'scope':'Deduplicated union of audit-cited primary text ranges, literal sed ranges, explicit corpus Read ranges, and line-addressed search results recovered from the main session and five audit subagents. Unnumbered/truncated snippets and dynamically generated ranges are not exhaustively recoverable. No entire file is inferred from a search or file listing.',
 'tierRules':{'high':'Evidence necessary to evaluate the core flywheel, GMV monetization/net take, capital allocation and FCF attribution, cohort and disclosure limitations, logistics costs and exit, international confounds, and AI causality/materiality.','mid':'Operating scale, financial reference tables and product, merchant, channel, buyer and partner mechanisms supporting or qualifying the core conclusion.','low':'Observed surrounding narrative, chronology, discovery/search hits not promoted by an audited claim, and secondary product history.'},
 'assignment':'Partition of unique source lines. Shared evidence is assigned once to its highest claim importance. Up to two adjacent already observed lines inherit importance for local context. Tier names express importance, not credibility. Audits, diagrams, model answers and grades are excluded from model inputs.',
 'limitations':['The selection follows the original agent and may inherit its coverage gaps.','PDF-only cohort charts cannot be represented as sourceRange text. Original pixel estimates and causal conclusions are excluded; independent evals using these contexts alone cannot reproduce that visual analysis.','A search hit pins its complete original line, so it can contain more text than a clipped terminal result. Literal sed ranges preserve full original lines, including lines suppressed by downstream filters.','No model is selected or eval launched; capability/cost routing can be configured per tier in a later eval.'],
 'claimPolicies':policies,'events':events,'ranges':ranges,'files':{fn:{'sha256':hashlib.sha256((ROOT/'corpus/shopify'/fn).read_bytes()).hexdigest(),'lines':len(files[fn])} for fn in selected},'excludedNonRangeCandidates':{'reason':'filename:0 search-count output is not a 1-based source line','items':invalid}}
(OUT/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
for tier in priority:
 rs=[r for r in ranges if r['tier']==tier]; size=sum(len(('\n'.join(files[r['file']][r['startLine']-1:r['endLine']])).encode()) for r in rs)
 print(tier,'ranges',len(rs),'lines',sum(r['endLine']-r['startLine']+1 for r in rs),'bytes',size)
print('events',len(events),'files',len(selected),'invalid',len(invalid));print(invalid[:10])
