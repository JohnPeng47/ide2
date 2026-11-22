"""Deterministic summary of judge outputs. No model calls.
Usage: python3 -I analyze.py <experiment directory>"""
import json, sys, statistics as st, itertools
from pathlib import Path

d = Path(sys.argv[1])
plan = json.loads((d / 'plan.json').read_text())
rows = []
retries = {r['key']: r for r in plan.get('retries', [])}
for base in plan['jobs']:
    job = retries.get(base['key'] + '#2', base)
    jd = d / 'jobs' / base['key'] / ('attempt-2' if job is not base else '')
    s = jd / 'status.json'
    if not s.exists(): continue
    status = json.loads(s.read_text())
    if status['status'] != 'finished':
        rows.append({**job, 'status': status['status'], 'error': status.get('error')}); continue
    out = json.loads((jd / 'judge.json').read_text())
    base = job['caseId'].removesuffix('-swapped')
    rows.append({**job, 'status': 'finished', 'pair': base, 'swapped': job['caseId'].endswith('-swapped'),
                 'reported': status['reportedScore'], 'score': status['score'], 'rescore': status['rescore'],
                 'anchors': out['anchors'], 'usage': status.get('usage') or {}})

def overlap(r1, r2): return any(a[0] <= b[1] and b[0] <= a[1] for a in r1 for b in r2)
def top(row):
    ps = row['anchors']['pairs']
    return [(p['b'], p['a']) if row['swapped'] else (p['a'], p['b']) for p in ps]
def agreement(x, y):
    """Share of top-level anchors that both judgements draw (A and B ranges overlap)."""
    tx, ty = top(x), top(y)
    if not tx and not ty: return 1.0
    used, hits = set(), 0
    for a, b in tx:
        for i, (a2, b2) in enumerate(ty):
            if i not in used and overlap(a, a2) and overlap(b, b2): used.add(i); hits += 1; break
    return 2 * hits / (len(tx) + len(ty))

fin = [r for r in rows if r['status'] == 'finished']
models = sorted({r['model'] for r in fin})
pairs = list(dict.fromkeys(r['pair'] for r in fin))
summary = {'experimentId': plan['experimentId'], 'finished': len(fin), 'failed': [r['key'] for r in rows if r['status'] != 'finished'], 'pairs': {}, 'models': {}}
for p in pairs:
    entry = {}
    for m in models:
        rs = [r for r in fin if r['pair'] == p and r['model'] == m]
        if not rs: continue
        sc = [r['score'] for r in rs]
        ab = [r['score'] for r in rs if not r['swapped']]; ba = [r['score'] for r in rs if r['swapped']]
        within = [agreement(x, y) for x, y in itertools.combinations(rs, 2)]
        entry[m] = {'scores': [round(x, 3) for x in sc], 'mean': round(st.mean(sc), 3), 'sd': round(st.pstdev(sc), 3) if len(sc) > 1 else None,
                    'swapDelta': round(st.mean(ba) - st.mean(ab), 3) if ab and ba else None,
                    'maxArithmeticError': round(max(abs(r['reported'] - r['score']) for r in rs), 3),
                    'anchorAgreementWithin': round(st.mean(within), 2) if within else None,
                    'topAnchors': [r['rescore']['pairs'] for r in rs], 'rangeIssues': sum(len(r['rescore']['rangeIssues']) for r in rs)}
    if len(models) == 2 and all(m in entry for m in models):
        xs = [r for r in fin if r['pair'] == p and r['model'] == models[0]]; ys = [r for r in fin if r['pair'] == p and r['model'] == models[1]]
        entry['anchorAgreementAcross'] = round(st.mean(agreement(x, y) for x in xs for y in ys), 2)
        entry['meanGap'] = round(entry[models[0]]['mean'] - entry[models[1]]['mean'], 3)
    summary['pairs'][p] = entry
for m in models:
    rs = [r for r in fin if r['model'] == m]
    u = [r['usage'] for r in rs]
    summary['models'][m] = {'calls': len(rs), 'meanSd': round(st.mean([e[m]['sd'] for e in summary['pairs'].values() if m in e and e[m]['sd'] is not None] or [0]), 3),
        'meanAbsArithmeticError': round(st.mean(abs(r['reported'] - r['score']) for r in rs), 4),
        'tokens': {k: sum(x.get(k, 0) for x in u) for k in ('input', 'output', 'cacheRead', 'totalTokens') if any(k in x for x in u)},
        'cost': round(sum((x.get('cost') if isinstance(x.get('cost'), (int, float)) else 0) for x in u), 4)}
(d / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=1))
