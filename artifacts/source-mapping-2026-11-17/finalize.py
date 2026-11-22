import json,pathlib,statistics,collections,urllib.request,uuid,subprocess
D=pathlib.Path(__file__).parent
subprocess.run(['python',str(D/'analyze.py'),'--v2'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['python',str(D/'consistency.py')],check=True,stdout=subprocess.DEVNULL)
analysis=json.loads((D/'v2-analysis.json').read_text());plan=json.loads((D/'v2-plan.json').read_text())
assert analysis['statuses']=={'finished':72},analysis['statuses']
counts=collections.Counter((r['caseId'],r['effort']) for r in analysis['rows']);assert len(counts)==24 and set(counts.values())=={3}
store=D.parent.parent/'.diagrams-local/canvas-domain-model/eval-runs'
for j in plan['jobs']:
 r=json.loads((store/(j['runId']+'.json')).read_text());assert r['status']=='finished' and not r.get('error');assert r['request']['model']=='gpt-6-sol' and r['request']['effort']==j['effort'];assert r['prompts'][0]['version']==2;assert r['cells'][0]['output']['canvases'] and r['cells'][0]['historyArtifact']
base='http://localhost:5191/api/mapping/evals'
def api(route,body=None):
 req=urllib.request.Request(base+route,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=60))
ex=api('/experiments/'+plan['experimentId'])
ids=json.loads((D/'v2-ids.json').read_text());oldpilots={x['runId'] for x in ids.get('pilotAttempts',[])}
phases=[{**p,'name':'Initial trials'} if p['id']=='baseline-v1' else p for p in ex['phases']]
samples=[{**s,'phaseId':'baseline-v1'} if s['id'] in oldpilots else s for s in ex['samples']]
description='Completed: 72 prompt-v2 samples on four matched core diagrams and four canvases, gpt-6-sol low/medium/high × three samples per case. Same pinned inputs across efforts. Every final output passed source-range validation, mapping registration, immutable output persistence, reopening and API loading; ASCII, layout and edges preserved. Six original v1 trials and the setup-failed v2 pilot remain under Initial trials. Range validation feedback is part of each independent sample; deterministic replay did not regenerate model answers. Results comments distinguish coverage from semantic accuracy.'
if ex['description']!=description or ex['phases']!=phases or ex['samples']!=samples:
 design={k:ex[k] for k in ['name','tags','workflow','cases','conditions','comparisons']};design.update(description=description,phases=phases,samples=samples)
 ex=api('/experiments',{'requestId':str(uuid.uuid4()),'experimentId':ex['id'],'expectedRevision':ex['revision'],'experiment':design})
lines=['Completed all 72 final samples: four matched core diagrams and four canvases × Sol low/medium/high × three independent samples. All use prompt v2 and the same pinned repository commits and starting diagrams.','',
'Every final output passed node/reference and source-range bounds checks, registration through the native source-mapping operation, persistence, reopening, and output loading. Diagram ASCII, node geometry, layout, and edges were preserved. Source bindings are registered for all four repositories; representative app API source reads matched the pinned mapped ranges.','',
'Coverage below is the mean percentage of nodes directly mapped per sample. It excludes mappings inherited from an ancestor. This is completeness, not a correctness score.','',
'| Input | Effort | Samples | Direct coverage | With inheritance | Median runtime |',
'|---|---|---:|---:|---:|---:|']
for g in analysis['groups']:
 rs=[r for r in analysis['rows'] if r['caseId'].startswith(g['kind']+'-') and r['effort']==g['effort']]
 lines.append(f"| {g['kind']} | {g['effort']} | {len(rs)} | {100*statistics.mean(r['directCoverage'] for r in rs):.1f}% | {100*statistics.mean(r['resolvedCoverage'] for r in rs):.1f}% | {statistics.median(r['durationSeconds'] for r in rs)/60:.1f} min |")
lines+=['','Main observations:','',
'- Low effort is inconsistent: Mapping core mapped 129/67/129 nodes; Pi core 100/46/100; Mapping canvas 118/117/40 of 121; Pi canvas 110/108/20 of 110. Several sparse outputs offer little explanation for omissions.',
'- Medium is a strong next baseline for completeness. All 12 core samples map every node. Compare its canvas coverage and runtime with high in the table; higher effort does not itself establish greater semantic accuracy.',
'- Ancestor inheritance can conceal missing direct mappings. The inherited-coverage column is a UI convenience measure, not additional source evidence selected for those nodes.',
'- Independent samples often choose different line boundaries and multiple ranges for composite nodes. The saved consistency analysis measures source-line overlap; it is not a ground-truth accuracy test.',
'',f"Validation feedback: {sum(r['validationCalls'] for r in analysis['rows'])} candidate checks across the 72 samples; {sum(r['invalidCandidates'] for r in analysis['rows'])} rejected candidates were recorded within sessions before successful final submission. No final candidate has an unresolved validation error.",
'', 'Earlier attempts remain visible: the original v1 run had three low-effort source-range failures (17 out-of-bounds ranges total) and three successful medium outputs. A v2 pilot exposed a tool-availability configuration error. A later runner check incorrectly rejected changed explanatory notes despite identical validated mappings; its saved response was replayed after correcting that check, without another model call.',
'', 'Limitations: no hand-labelled mapping ground truth or independent semantic judge was used. Bounds-valid ranges may still support only part of a composite node, omit relevant code, or include unnecessary lines. The next quality evaluation should judge evidence support and range precision, not reward mapping every node.']
text='\n'.join(lines)
(D/'results-comment.txt').write_text(text+'\n')
comment_file=D/'results-comment-receipt.json'
if not comment_file.exists():
 request_file=D/'results-comment-request.json';request=json.loads(request_file.read_text()) if request_file.exists() else {'requestId':str(uuid.uuid4()),'text':text,'tags':['results','source-mapping']};request_file.write_text(json.dumps(request,indent=2)+'\n');receipt=api('/experiments/'+ex['id']+'/comments',request);comment_file.write_text(json.dumps(receipt,indent=2)+'\n')
else:receipt=json.loads(comment_file.read_text())
verification={'experimentId':ex['id'],'finishedSamples':72,'conditions':dict((f'{c}/{e}',n) for (c,e),n in counts.items()),'commentSaved':True,'sourceNavigation':json.loads((D/'source-navigation-check.json').read_text())}
(D/'completion.json').write_text(json.dumps(verification,indent=2)+'\n');print(text)
