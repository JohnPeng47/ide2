"""Compare Phase 3 with the matching Phase 2 Sol/medium and Sol/high samples; no model calls.
Named-function metric reproduces sym-original.py: named fn declaration START lies
inside a selected range. It does not prove whole-function or semantic coverage.
"""
import collections
from datetime import datetime
import json
from pathlib import Path
import re
import statistics
import subprocess

here = Path(__file__).resolve().parent
plan = json.loads((here/'plan.json').read_text())
previous = here.parent/'phase2-ghostty'
p2 = json.loads((previous/'plan.json').read_text())
case_ids = {c['key'] for c in plan['cases']}
case = json.loads((here/(plan['cases'][0]['key']+'-input.json')).read_text())
repo, commit = case['repo']['repositoryPath'], case['repo']['commit']

def git(*args):
    return subprocess.check_output(['git', '-C', repo, *args], text=True)

definitions = collections.defaultdict(list)
for filename in git('ls-tree', '-r', '--name-only', commit, 'src').splitlines():
    if filename.endswith('.zig'):
        for index, line in enumerate(git('show', commit+':'+filename).splitlines(), 1):
            match = re.match(r'\s*(?:pub\s+)?(?:inline\s+)?fn\s+(\w+)\s*\(', line)
            if match:
                definitions[match[1]].append((filename, index))

rows = []
for phase, directory, jobs in [('phase-2', previous, [j for j in p2['jobs'] if j['caseId'] in case_ids and j['effort'] in ['medium','high']]), ('phase-3', here, plan['jobs'])]:
    for job in jobs:
        folder = directory/'jobs'/job['key']
        receipt = folder/'status.json'
        if not receipt.exists():
            continue
        status = json.loads(receipt.read_text())
        if status['status'] != 'finished':
            rows.append({'phase': phase, 'key': job['key'], 'status': status['status']})
            continue
        inp = json.loads((directory/(job['caseId']+'-input.json')).read_text())
        mapping = json.loads((folder/'mapping.json').read_text())
        response = json.loads((folder/'response.json').read_text())
        by = collections.defaultdict(list)
        for diagram in mapping['diagrams']:
            for item in diagram['mappings']:
                by[diagram['diagramId'], item['node']].append(item)
        named = hit = 0
        misses = []
        for diagram in inp['diagrams']:
            for node in diagram['nodes']:
                identifiers = set(re.findall(r'\b([a-z]\w*)\(\)?', node['label'])) | set(re.findall(r'\b[a-z]\w*Callback\b', node['label']))
                for symbol in sorted(identifiers):
                    if symbol not in definitions or len(definitions[symbol]) > 3:
                        continue
                    named += 1
                    found = any(m['path']==p and m['startLine']<=line<=m['endLine'] for p,line in definitions[symbol] for m in by[diagram['diagramId'],node['ref']])
                    hit += found
                    if not found:
                        misses.append(f"{diagram['diagramId']}/{node['ref']} {symbol}")
        run_file = here.parents[2]/'.diagrams-local/canvas-domain-model/eval-runs'/(job['runId']+'.json')
        run = json.loads(run_file.read_text())
        cell = run['cells'][0]
        elapsed = (datetime.fromisoformat(cell['completedAt'].replace('Z','+00:00'))-datetime.fromisoformat(cell['startedAt'].replace('Z','+00:00'))).total_seconds()
        ranges = [m for diagram in mapping['diagrams'] for m in diagram['mappings']]
        # Match the original script's upper-median convention exactly.
        sizes = sorted(m['endLine']-m['startLine']+1 for m in ranges)
        unique = collections.defaultdict(set)
        for m in ranges:
            unique[m['path']].update(range(m['startLine'],m['endLine']+1))
        rows.append({'phase':phase,'key':job['key'],'caseId':job['caseId'],'condition':job.get('conditionId','sol-'+job['effort']+'_baseline'),'sample':job['number'],'status':'finished',
            'nodes':sum(len(d['nodes']) for d in inp['diagrams']),'mappedNodes':len(by),'ranges':len(ranges),'sourceLines':sum(sizes),'uniqueSourceLines':sum(map(len,unique.values())),
            'files':len(unique),'medianRangeLines':sizes[len(sizes)//2] if sizes else 0,'rangesAtMost10Lines':sum(n<=10 for n in sizes),'namedFunctions':named,'definitionStartsCovered':hit,'definitionStartMisses':misses,
            'children':response.get('accounting',{}).get('children',0),'elapsedSeconds':elapsed,'usage':response.get('usage'),
            'reportedModelCost':response.get('accounting',{}).get('totalCost'), 'runId':job['runId']})
groups = collections.defaultdict(list)
for row in rows:
    if row['status']=='finished':
        groups[row['phase'],row['condition']].append(row)
summary=[]
for (phase,condition),items in groups.items():
    summary.append({'phase':phase,'condition':condition,'completed':len(items),'mappedNodes':sum(x['mappedNodes'] for x in items),'nodes':sum(x['nodes'] for x in items),
        'definitionStartsCovered':sum(x['definitionStartsCovered'] for x in items),'namedFunctions':sum(x['namedFunctions'] for x in items),
        'meanSourceLines':statistics.mean(x['sourceLines'] for x in items),'meanUniqueSourceLines':statistics.mean(x['uniqueSourceLines'] for x in items),'meanFiles':statistics.mean(x['files'] for x in items),
        'meanElapsedSeconds':statistics.mean(x['elapsedSeconds'] for x in items),'meanRanges':statistics.mean(x['ranges'] for x in items),'children':sum(x['children'] for x in items),
        'totalTokens':sum(x['usage'].get('totalTokens',x['usage'].get('input_tokens',0)+x['usage'].get('output_tokens',0)) for x in items if x.get('usage'))})
result={'commit':commit,'definitionMetric':'Original sym.py heuristic: declaration start in range; not whole-function or semantic validation.','costMetric':'SDK-reported cost only, not measured Codex allowance. Missing baseline cost remains unknown.','summary':summary,'samples':rows}
(here/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(summary,indent=2))
